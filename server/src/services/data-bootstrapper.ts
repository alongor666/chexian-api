/**
 * DataBootstrapper — 数据启动编排器
 *
 * 封装服务器启动时的 Parquet 发现→去重→验证→加载→维度加载 全流程。
 * 从 app.ts startServer() 提取，使入口文件只关注 Express 中间件与 HTTP 生命周期。
 *
 * @see P1#7 架构优化计划
 */

import fs from 'fs';
import path from 'path';
import {
  getCandidateDataDirs,
  getDataDir,
  getSalesmanMappingPaths,
  getSalesmanDimPaths,
  getPlanDimPaths,
  getQuoteConversionPaths,
  getPlateRegionDimPaths,
  getClaimsDetailPaths,
  getCrossSellPaths,
  getClaimsBulkPaths,
  getClaimsAggPaths,
  getRepairDimPaths,
  getBrandDimPaths,
  getCustomerFlowPaths,
  getRenewalUniversePaths,
} from '../config/paths.js';
import { inspectParquetSource, getParquetLoadRejectionReason, getParquetLoadWarning } from '../utils/parquet-source.js';
import { isValidParquetFile } from '../utils/security.js';
import * as materialization from './duckdb-materialization.js';
import * as domainLoaders from './duckdb-domain-loaders.js';

// ============================================
// Types
// ============================================

interface ParquetFileInfo {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
}

/** bootstrap() 的返回结果，供 app.ts 注册当前数据文件 */
export interface BootstrapResult {
  rowCount: number;
  fileCount: number;
  totalSize: number;
  fileNames: string;
}

/**
 * DataBootstrapper 依赖的 DuckDB 服务接口（精简版）。
 * 代理方法已删除，bootstrapper 内部直接 import duckdb-materialization / duckdb-domain-loaders。
 */
export interface BootstrapDuckDB {
  loadParquet(filePath: string, tableName: string): Promise<void>;
  loadMultipleParquet(filePaths: string[]): Promise<{ totalRows: number }>;
  query<T = any>(sql: string, cacheTtlMs?: number): Promise<T[]>;
  hasRelation(relationName: string): Promise<boolean>;
  dropRelationIfExists(relationName: string): Promise<void>;
}

// ============================================
// DataBootstrapper
// ============================================

export class DataBootstrapper {
  constructor(private readonly db: BootstrapDuckDB) {}

  /**
   * 执行完整的数据启动流程。
   * @returns BootstrapResult（有数据时）或 null（无可用数据）
   */
  async bootstrap(): Promise<BootstrapResult | null> {
    this.logHealthCheck();

    // Stage 1-5: 发现→回退→去重→验证→检查来源
    let files = this.discoverParquetFiles();
    files = this.applyLegacyFallback(files);
    files = this.deduplicateOverlapping(files);
    files = await this.validateFiles(files);
    files = await this.inspectSources(files);

    this.logFilesSummary(files);

    if (files.length === 0) {
      console.warn('[Bootstrap] No data files available. Server will start without data.');
      return null;
    }

    // Stage 6-9: 加载核心数据 → CrossSell → PolicyFact 视图 → 验证行数
    const rowCount = await this.loadCoreData(files);

    // Stage 10-11: 维度表 + 辅助域
    await this.loadDimTables();
    await this.loadAuxiliaryDomains();

    return {
      rowCount,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      fileNames: files.map(f => f.name).join(' + '),
    };
  }

  // ============================================
  // Stage 1: 启动期健康检查（日志输出）
  // ============================================

  private logHealthCheck(): void {
    const candidateDirs = getCandidateDataDirs();
    const dimSalesmanCandidates = getSalesmanDimPaths();
    const dimPlanCandidates = getPlanDimPaths();
    const mappingCandidates = getSalesmanMappingPaths();

    console.log('[Bootstrap] Startup health check:');
    console.log('  - Parquet dirs:', candidateDirs.map(d => `${d}${fs.existsSync(d) ? ' [ok]' : ' [missing]'}`).join(' | '));
    console.log('  - Dim salesman:', dimSalesmanCandidates.map(p => `${p}${fs.existsSync(p) ? ' [ok]' : ' [missing]'}`).join(' | '));
    console.log('  - Dim plan:', dimPlanCandidates.map(p => `${p}${fs.existsSync(p) ? ' [ok]' : ' [missing]'}`).join(' | '));
    console.log('  - Team mapping:', mappingCandidates.map(p => `${p}${fs.existsSync(p) ? ' [ok]' : ' [missing]'}`).join(' | '));
  }

  // ============================================
  // Stage 2: Parquet 文件发现
  // ============================================

  private discoverParquetFiles(): ParquetFileInfo[] {
    const candidateDirs = getCandidateDataDirs();
    const files = candidateDirs.flatMap(dir => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.parquet'))
        .map(f => {
          const fullPath = path.join(dir, f);
          const stat = fs.statSync(fullPath);
          return { name: f, path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs };
        });
    });
    console.log('[Bootstrap] Parquet search dirs (current/):', candidateDirs.filter(d => fs.existsSync(d)));
    return files;
  }

  // ============================================
  // Stage 3: Legacy 回退（current/ 为空时扫描根目录）
  // ============================================

  private applyLegacyFallback(files: ParquetFileInfo[]): ParquetFileInfo[] {
    if (files.length > 0) {
      const realDataFiles = files.filter(f => !f.name.startsWith('test-data'));
      return realDataFiles.length > 0 ? realDataFiles : files.slice(0, 1);
    }

    const legacyDataDir = getDataDir();
    if (!fs.existsSync(legacyDataDir)) return [];

    const legacyFiles = fs.readdirSync(legacyDataDir)
      .filter(f => f.endsWith('.parquet'))
      .map(f => {
        const fullPath = path.join(legacyDataDir, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (legacyFiles.length === 0) return [];

    const realLegacyFiles = legacyFiles.filter(f => !f.name.startsWith('test-data'));
    const result = realLegacyFiles.length > 0 ? realLegacyFiles : legacyFiles.slice(0, 1);
    console.warn(`[Bootstrap] current/ has no parquet, fallback to ${legacyDataDir}`);
    return result;
  }

  // ============================================
  // Stage 4: 时间范围重叠去重
  // ============================================

  private deduplicateOverlapping(files: ParquetFileInfo[]): ParquetFileInfo[] {
    if (files.length <= 1) return files;

    const datePattern = /(\d{8})_(\d{8})\.parquet$/;
    const groups = new Map<string, ParquetFileInfo[]>();

    for (const f of files) {
      const m = datePattern.exec(f.name);
      if (!m) {
        groups.set(f.name, [f]);
        continue;
      }
      const startDate = m[1];
      const existing = groups.get(startDate) ?? [];
      existing.push(f);
      groups.set(startDate, existing);
    }

    const result: ParquetFileInfo[] = [];
    for (const [key, group] of groups) {
      if (group.length <= 1) {
        result.push(...group);
        continue;
      }
      group.sort((a, b) => {
        const aEnd = datePattern.exec(a.name)?.[2] ?? '';
        const bEnd = datePattern.exec(b.name)?.[2] ?? '';
        return bEnd.localeCompare(aEnd);
      });
      const kept = group[0];
      const skipped = group.slice(1);
      console.warn(`[Bootstrap] Parquet overlap (start=${key}): keeping ${kept.name}, skipping ${skipped.map(f => f.name).join(', ')}`);
      result.push(kept);
    }

    return result;
  }

  // ============================================
  // Stage 5a: Parquet 文件安全校验
  // ============================================

  private async validateFiles(files: ParquetFileInfo[]): Promise<ParquetFileInfo[]> {
    if (files.length === 0) return [];

    const valid: ParquetFileInfo[] = [];
    for (const file of files) {
      const validation = await isValidParquetFile(file.path);
      if (validation.valid) {
        valid.push(file);
      } else {
        console.warn(`[Bootstrap] Skip invalid parquet: ${file.path} (${validation.error || 'unknown'})`);
      }
    }
    return valid;
  }

  // ============================================
  // Stage 5b: Parquet 来源检查（拒绝非行级数据）
  // ============================================

  private async inspectSources(files: ParquetFileInfo[]): Promise<ParquetFileInfo[]> {
    if (files.length === 0) return [];

    const accepted: ParquetFileInfo[] = [];
    for (const file of files) {
      const inspection = await inspectParquetSource(file.path);
      const rejectionReason = getParquetLoadRejectionReason(inspection);
      if (rejectionReason) {
        console.warn(`[Bootstrap] Skip unsupported source: ${file.path} (${rejectionReason})`);
        continue;
      }
      const warning = getParquetLoadWarning(inspection);
      if (warning) {
        console.warn(`[Bootstrap] Source warning: ${file.path} (${warning})`);
      }
      accepted.push(file);
    }
    return accepted;
  }

  // ============================================
  // 日志：最终文件清单
  // ============================================

  private logFilesSummary(files: ParquetFileInfo[]): void {
    if (files.length === 0) return;
    console.log(`[Bootstrap] ${files.length} parquet file(s) to load:`);
    files.forEach((f, i) => console.log(`  [${i}] ${f.path} (${(f.size / 1024 / 1024).toFixed(1)} MB)`));
  }

  // ============================================
  // Stage 6-9: 核心数据加载
  // ============================================

  private async loadCoreData(files: ParquetFileInfo[]): Promise<number> {
    // Stage 6: 加载 Parquet 到 raw_parquet
    if (files.length > 1) {
      const { totalRows } = await this.db.loadMultipleParquet(files.map(f => f.path));
      console.log(`[Bootstrap] Multi-parquet loaded: ${files.length} files, ${totalRows} rows`);
    } else {
      await this.db.loadParquet(files[0].path, 'raw_parquet');
      console.log('[Bootstrap] Data loaded:', path.basename(files[0].path));
    }

    // Stage 7: 预加载 CrossSellFact（供 PolicyFact 视图 8 域模式使用）
    const crossSellPath = getCrossSellPaths().find(p => fs.existsSync(p));
    if (crossSellPath) {
      try {
        await this.db.loadCrossSell(crossSellPath);
      } catch (err) {
        console.warn('[Bootstrap] CrossSellFact pre-load failed (non-blocking):', err);
      }
    }

    // Stage 8: 创建 PolicyFact 视图
    console.log('[Bootstrap] Creating PolicyFact view...');
    await this.db.createPolicyFactView('raw_parquet');
    console.log('[Bootstrap] PolicyFact view created');

    // Stage 9: 验证行数
    const countResult = await this.db.query<{ count: number }>('SELECT COUNT(*) as count FROM PolicyFact');
    const rowCount = countResult[0]?.count || 0;
    console.log(`[Bootstrap] PolicyFact row count: ${rowCount}`);
    return rowCount;
  }

  // ============================================
  // Stage 10: 维度表加载（Parquet 优先，JSON 回退）
  // ============================================

  private async loadDimTables(): Promise<void> {
    let dimLoaded = false;

    // 策略 1：Parquet 维度表
    const salesmanDimPath = getSalesmanDimPaths().find(p => fs.existsSync(p));
    const planDimPath = getPlanDimPaths().find(p => fs.existsSync(p));
    if (salesmanDimPath && planDimPath) {
      try {
        await this.db.loadDimParquet(salesmanDimPath, planDimPath);
        console.log('[Bootstrap] Dim tables loaded (Parquet):', salesmanDimPath, planDimPath);
        dimLoaded = true;
      } catch (err) {
        console.warn('[Bootstrap] Dim Parquet load failed, falling back to JSON:', err);
      }
    }

    // 策略 2：JSON 映射文件（回退）
    if (!dimLoaded) {
      const teamMappingCandidates = getSalesmanMappingPaths();
      for (const mappingPath of teamMappingCandidates) {
        if (!fs.existsSync(mappingPath)) continue;
        try {
          await this.db.loadTeamMapping(mappingPath);
          console.log('[Bootstrap] Team mapping loaded (JSON fallback):', mappingPath);
          dimLoaded = true;
          break;
        } catch (err) {
          console.warn('[Bootstrap] Team mapping load failed:', mappingPath);
        }
      }
    }

    if (!dimLoaded) {
      console.warn('[Bootstrap] Dim data unavailable. Run "python3 数据管理/warehouse/dim/generate_dim_tables.py" to generate.');
    }
  }

  // ============================================
  // Stage 11: 辅助域加载（全部非阻塞）
  // ============================================

  private async loadAuxiliaryDomains(): Promise<void> {
    const loaders: Array<{ name: string; pathFn: () => string[]; loadFn: (p: string) => Promise<void> }> = [
      { name: 'PlateRegionDim', pathFn: getPlateRegionDimPaths, loadFn: p => this.db.loadPlateRegionDim(p) },
      { name: 'QuoteConversion', pathFn: getQuoteConversionPaths, loadFn: p => this.db.loadQuoteConversion(p) },
      { name: 'ClaimsDetail', pathFn: getClaimsDetailPaths, loadFn: p => this.db.loadClaimsDetail(p) },
      { name: 'RepairDim', pathFn: getRepairDimPaths, loadFn: p => this.db.loadRepairDim(p) },
      { name: 'BrandDim', pathFn: getBrandDimPaths, loadFn: p => this.db.loadBrandDim(p) },
      { name: 'CustomerFlow', pathFn: getCustomerFlowPaths, loadFn: p => this.db.loadCustomerFlow(p) },
      { name: 'RenewalUniverse', pathFn: getRenewalUniversePaths, loadFn: p => this.db.loadRenewalUniverse(p) },
    ];

    // 记录 ClaimsDetail 是否加载成功，供 ClaimsAgg 回退判断
    let claimsDetailLoaded = false;

    for (const { name, pathFn, loadFn } of loaders) {
      const filePath = pathFn().find(p => fs.existsSync(p));
      if (!filePath) continue;
      try {
        await loadFn(filePath);
        if (name === 'ClaimsDetail') claimsDetailLoaded = true;
      } catch (err) {
        console.warn(`[Bootstrap] ${name} load failed (non-blocking):`, err);
      }
    }

    // ClaimsAgg：claims_bulk 优先 → 旧 ClaimsAgg parquet 回退 → ClaimsDetail 聚合兜底
    const claimsBulkPath = getClaimsBulkPaths().find(p => fs.existsSync(p));
    const claimsAggPath = getClaimsAggPaths().find(p => fs.existsSync(p));
    if (claimsBulkPath) {
      try {
        await this.db.loadClaimsBulk(claimsBulkPath);
      } catch (err) {
        console.warn('[Bootstrap] ClaimsBulk load failed, trying fallbacks:', err);
        if (claimsAggPath) {
          try { await this.db.loadClaimsAgg(claimsAggPath); } catch (e) {
            console.warn('[Bootstrap] ClaimsAgg fallback also failed:', e);
          }
        } else if (claimsDetailLoaded) {
          try { await this.db.createClaimsAggFromDetail(); } catch (e) {
            console.warn('[Bootstrap] ClaimsAgg from ClaimsDetail fallback failed:', e);
          }
        }
      }
    } else if (claimsAggPath) {
      try {
        await this.db.loadClaimsAgg(claimsAggPath);
      } catch (err) {
        console.warn('[Bootstrap] ClaimsAgg load failed (non-blocking):', err);
      }
    } else if (claimsDetailLoaded) {
      try {
        await this.db.createClaimsAggFromDetail();
      } catch (err) {
        console.warn('[Bootstrap] ClaimsAgg from ClaimsDetail failed (non-blocking):', err);
      }
    }
  }
}
