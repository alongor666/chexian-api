/**
 * DataBootstrapper — 数据启动编排器
 *
 * 封装服务器启动时的 Parquet 发现→去重→验证→加载→维度加载 全流程。
 * 从 app.ts startServer() 提取，使入口文件只关注 Express 中间件与 HTTP 生命周期。
 *
 * Stage 11 变更（MAT-01）：辅助域改为惰性注册模式（LazyDomainRegistry），
 * 不在启动时加载，而是在路由首次被访问时按需加载。
 *
 * @see P1#7 架构优化计划
 * @see 04-02-PLAN.md — MAT-01 惰性域架构
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
  getRepairDimPaths,
  getBrandDimPaths,
  getCustomerFlowPaths,
  getRenewalUniversePaths,
} from '../config/paths.js';
import { inspectParquetSource, getParquetLoadRejectionReason, getParquetLoadWarning } from '../utils/parquet-source.js';
import { isValidParquetFile } from '../utils/security.js';
import * as materialization from './duckdb-materialization.js';
import * as domainLoaders from './duckdb-domain-loaders.js';
import { LazyDomainRegistry } from './lazy-domain-registry.js';

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
  getTableSchema(tableName: string): Promise<any[]>;
  hasRelation(relationName: string): Promise<boolean>;
  dropRelationIfExists(relationName: string): Promise<void>;
  invalidateCache(options?: { silent?: boolean }): void;
}

// ============================================
// DataBootstrapper
// ============================================

export class DataBootstrapper {
  /** 惰性域注册表 — 辅助域按需加载，启动时不占内存 */
  private readonly lazyRegistry = new LazyDomainRegistry();

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

    // Stage 6-9: 加载核心数据 → PolicyFact 视图 → 验证行数（Stage 7 CrossSell 预加载已移除）
    const rowCount = await this.loadCoreData(files);

    // Stage 10: 维度表（仍为 eager 模式：SalesmanDim + PlanFact + PlateRegionDim）
    await this.loadDimTables();

    // Stage 11: 注册惰性域（仅注册 loader 闭包，不加载数据）
    this.registerLazyDomains();

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
  // Stage 6-9: 核心数据加载（Stage 7 CrossSell 已移除）
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

    // Stage 8: 创建 PolicyFact 视图（不再依赖 CrossSellFact，per D-09 解耦）
    console.log('[Bootstrap] Creating PolicyFact view...');
    await materialization.createPolicyFactView(this.db, 'raw_parquet');
    console.log('[Bootstrap] PolicyFact view created');

    // Stage 9: 验证行数
    const countResult = await this.db.query<{ count: number }>('SELECT COUNT(*) as count FROM PolicyFact');
    const rowCount = countResult[0]?.count || 0;
    console.log(`[Bootstrap] PolicyFact row count: ${rowCount}`);
    return rowCount;
  }

  // ============================================
  // Stage 10: 维度表加载（Parquet 优先，JSON 回退）— 保持 eager
  // ============================================

  private async loadDimTables(): Promise<void> {
    let dimLoaded = false;

    // 策略 1：Parquet 维度表
    const salesmanDimPath = getSalesmanDimPaths().find(p => fs.existsSync(p));
    const planDimPath = getPlanDimPaths().find(p => fs.existsSync(p));
    if (salesmanDimPath && planDimPath) {
      try {
        await domainLoaders.loadDimParquet(this.db, salesmanDimPath, planDimPath);
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
          await domainLoaders.loadTeamMapping(this.db, mappingPath);
          console.log('[Bootstrap] Team mapping loaded (JSON fallback):', mappingPath);
          dimLoaded = true;
          break;
        } catch (err) {
          console.warn('[Bootstrap] Team mapping load failed:', mappingPath);
        }
      }
    }

    // PlateRegionDim：加入 eager 加载（7.8KB，微小，保持启动时加载）
    const plateRegionPath = getPlateRegionDimPaths().find(p => fs.existsSync(p));
    if (plateRegionPath) {
      try {
        await domainLoaders.loadPlateRegionDim(this.db, plateRegionPath);
      } catch (err) {
        console.warn('[Bootstrap] PlateRegionDim load failed (non-blocking):', err);
      }
    }

    if (!dimLoaded) {
      console.warn('[Bootstrap] Dim data unavailable. Run "python3 数据管理/warehouse/dim/generate_dim_tables.py" to generate.');
    }
  }

  // ============================================
  // Stage 11: 惰性域注册（仅注册 loader 闭包，不触发加载）
  // ============================================

  private registerLazyDomains(): void {
    const db = this.db;

    // ClaimsDetail（254k 行，必须惰性）
    this.lazyRegistry.register('ClaimsDetail', async () => {
      const p = getClaimsDetailPaths().find(p => fs.existsSync(p));
      if (!p) { console.warn('[Bootstrap:Lazy] ClaimsDetail: no file found'); return; }
      console.time('[Bootstrap:Lazy] ClaimsDetail');
      await domainLoaders.loadClaimsDetail(db, p);
      console.timeEnd('[Bootstrap:Lazy] ClaimsDetail');
    });

    // ClaimsAgg：唯一来源 = ClaimsDetail 动态聚合
    this.lazyRegistry.register('ClaimsAgg', async () => {
      await this.lazyRegistry.ensureLoaded('ClaimsDetail');
      console.time('[Bootstrap:Lazy] ClaimsAgg from ClaimsDetail');
      await domainLoaders.createClaimsAggFromDetail(db);
      console.timeEnd('[Bootstrap:Lazy] ClaimsAgg from ClaimsDetail');
    });

    // CrossSell（含 CrossSellDailyAgg 物化，per D-09 解耦）
    this.lazyRegistry.register('CrossSell', async () => {
      const p = getCrossSellPaths().find(p => fs.existsSync(p));
      if (!p) { console.warn('[Bootstrap:Lazy] CrossSell: no file found'); return; }
      console.time('[Bootstrap:Lazy] CrossSell');
      await domainLoaders.loadCrossSell(db, p);
      await materialization.createCrossSellRealtimeView(db);
      console.timeEnd('[Bootstrap:Lazy] CrossSell');
    });

    // RepairDim（1.3MB，仅维修页）
    this.lazyRegistry.register('RepairDim', async () => {
      const p = getRepairDimPaths().find(p => fs.existsSync(p));
      if (!p) return;
      await domainLoaders.loadRepairDim(db, p);
    });

    // BrandDim（13MB，必须惰性）
    this.lazyRegistry.register('BrandDim', async () => {
      const p = getBrandDimPaths().find(p => fs.existsSync(p));
      if (!p) return;
      console.time('[Bootstrap:Lazy] BrandDim');
      await domainLoaders.loadBrandDim(db, p);
      console.timeEnd('[Bootstrap:Lazy] BrandDim');
    });

    // CustomerFlow（仅客户来源页）
    this.lazyRegistry.register('CustomerFlow', async () => {
      const p = getCustomerFlowPaths().find(p => fs.existsSync(p));
      if (!p) return;
      await domainLoaders.loadCustomerFlow(db, p);
    });

    // RenewalUniverse（续保分析，数据量大）
    this.lazyRegistry.register('RenewalUniverse', async () => {
      const p = getRenewalUniversePaths().find(p => fs.existsSync(p));
      if (!p) return;
      console.time('[Bootstrap:Lazy] RenewalUniverse');
      await domainLoaders.loadRenewalUniverse(db, p);
      console.timeEnd('[Bootstrap:Lazy] RenewalUniverse');
    });

    // QuoteConversion（仅报价转化页）
    this.lazyRegistry.register('QuoteConversion', async () => {
      const p = getQuoteConversionPaths().find(p => fs.existsSync(p));
      if (!p) return;
      await domainLoaders.loadQuoteConversion(db, p);
    });

    console.log('[Bootstrap] Lazy domains registered: ClaimsDetail, ClaimsAgg, CrossSell, RepairDim, BrandDim, CustomerFlow, RenewalUniverse, QuoteConversion');
  }

  // ============================================
  // 公共 API：供路由中间件使用
  // ============================================

  /**
   * 供路由中间件调用：确保指定域已加载（首次触发加载，含 15s 超时保护）。
   * 超时返回 503，失败返回 500，并发安全（Promise 锁）。
   */
  async ensureDomainLoaded(domain: string): Promise<void> {
    return this.lazyRegistry.ensureLoaded(domain);
  }

  /**
   * 供监控/健康检查：获取域当前加载状态
   * ('unloaded' | 'loading' | 'loaded' | 'failed' | 'unknown')
   */
  getDomainState(domain: string): string {
    return this.lazyRegistry.getState(domain);
  }
}
