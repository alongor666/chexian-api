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
  getClaimsDetailDirs,
  getCrossSellPaths,
  getRepairDimPaths,
  getBrandDimPaths,
  getCustomerFlowPaths,
  getNewEnergyClaimsPaths,
  getRenewalTrackerPaths,
  getValidationRootDir,
  getBranchValidationDimPath,
  getBranchValidationFactPath,
} from '../config/paths.js';
import { getDeploymentBranchCode } from '../config/sql-federation-policy.js';
import { inspectParquetSource, getParquetLoadRejectionReason, getParquetLoadWarning } from '../utils/parquet-source.js';
import { isValidParquetFile } from '../utils/security.js';
import * as materialization from './duckdb-materialization.js';
import * as domainLoaders from './duckdb-domain-loaders.js';
import { type LazyDomainLoadOptions, LazyDomainRegistry } from './lazy-domain-registry.js';
import { bumpDataVersionFromTimestamp } from './data-version.js';

// ============================================
// Types
// ============================================

interface ParquetFileInfo {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  /**
   * 省份子目录来源（current/<省>/）的省码（`^[A-Z]{2}$`）；顶层扁平文件为 undefined。
   * Phase B B1：装载层省份子目录发现。今天 current/ 扁平无子目录 → 全 undefined → 行为休眠。
   */
  branch?: string;
}

const RELOADABLE_FULL_SNAPSHOT_DOMAINS: Record<string, { lazyName: string; relation: string }> = {
  customer_flow: { lazyName: 'CustomerFlow', relation: 'CustomerFlow' },
  new_energy_claims: { lazyName: 'NewEnergyClaims', relation: 'NewEnergyClaims' },
};

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

    // Stage 1-5: 发现→GATED 省份闸→回退→去重→验证→检查来源
    let files = this.discoverParquetFiles();
    files = this.enforceProvinceSubdirGate(files);
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
    const files = candidateDirs.flatMap(dir => DataBootstrapper.discoverInDir(dir));
    console.log('[Bootstrap] Parquet search dirs (current/):', candidateDirs.filter(d => fs.existsSync(d)));
    return files;
  }

  /**
   * 发现单个 current/ 根目录下的 parquet：① 顶层扁平文件（branch=undefined）；
   * ② 省份子目录 current/<省>/ 内的 parquet（branch=子目录名）。
   *
   * Phase B B1（生死点）：DuckDB read_parquet 不自动递归子目录，故必须由 JS 端显式列出
   * 每个子目录文件。省份子目录通过 `fs.readdirSync` 枚举**实际存在**的目录（数据/配置驱动，
   * 天然处理 N 省），以 `^[A-Z]{2}$` 校验目录名——与 resolveBranchFactExtras（ADR G3/G4）、
   * getDeploymentBranchCode、fields.json branch_code 派生轴同源约束，**不硬编码 ['SC','SX'] 省常量**。
   *
   * 顶层文件发现**逐字节复刻现状谓词**（`name.endsWith('.parquet')` + `fs.statSync`，跟随 symlink，
   * 不引入 Dirent.isFile() 过滤）——省份子目录扫描是纯增量行为，与顶层互不影响（省码不以
   * `.parquet` 结尾，两遍扫描天然不相交）。今天 current/ 扁平无子目录 → 仅返回顶层文件 → 与现状等价。
   */
  static discoverInDir(dir: string): ParquetFileInfo[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir);
    const result: ParquetFileInfo[] = [];

    // Pass 1：顶层扁平 parquet（复刻现状语义与顺序；branch=undefined）
    for (const name of entries) {
      if (!name.endsWith('.parquet')) continue;
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      result.push({ name, path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
    }

    // Pass 2：省份子目录 current/<省>/（新增；仅 ^[A-Z]{2}$ 目录，省码不以 .parquet 结尾故与 Pass 1 不相交）
    for (const name of entries) {
      if (!/^[A-Z]{2}$/.test(name)) continue;
      const subDir = path.join(dir, name);
      let subStat: fs.Stats;
      try {
        subStat = fs.statSync(subDir);
      } catch {
        continue;
      }
      if (!subStat.isDirectory()) continue;
      for (const f of fs.readdirSync(subDir)) {
        if (!f.endsWith('.parquet')) continue;
        const fullPath = path.join(subDir, f);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue; // 子目录内仅取文件，排除 staging/ 等嵌套目录
        result.push({ name: f, path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs, branch: name });
      }
    }

    return result;
  }

  // ============================================
  // Stage 2b: GATED 省份子目录闸（fail-closed，防跨省数据误入 PolicyFact）
  // ============================================

  /**
   * Phase B B1 GATED 红线护栏（fail-closed）：PolicyFact 是核心 eager 关系，
   * current/<省>/ 子目录数据只有在多省 cutover 激活（BRANCH_RLS_ENABLED=true，RLS 注入按
   * branch_code 过滤可见性）时才允许装入；否则非基准省数据会被 SC 用户越权读到（跨省串读）。
   *
   * 两道 fail-closed 抛错（命中即拒绝启动，不静默装载/丢弃）：
   *   ① 非基准省子目录含 parquet 且多省闸未开 → 抛错（GATED：SX 应隔离在 validation/，绝不进 current/）。
   *   ② 同一 current/ 根下扁平顶层 parquet 与省份子目录 parquet 并存 → 抛错（迁移须一次性：
   *      B2 落盘子目录后顶层应清空，并存会双计同省）。
   *
   * 今天 current/ 扁平无子目录 → discoverInDir 返回 branch 全 undefined → 本闸两条均不触发 → 行为休眠。
   */
  private enforceProvinceSubdirGate(files: ParquetFileInfo[]): ParquetFileInfo[] {
    const subdirFiles = files.filter(f => f.branch !== undefined);
    if (subdirFiles.length === 0) return files; // 无省份子目录 → 休眠（含今天扁平布局）

    const flatFiles = files.filter(f => f.branch === undefined);
    if (flatFiles.length > 0) {
      throw new Error(
        `[Bootstrap] GATED 迁移态冲突：current/ 同时存在顶层扁平 parquet（${flatFiles.length} 个）` +
        `与省份子目录 parquet（${[...new Set(subdirFiles.map(f => f.branch))].join(',')}）。` +
        `子目录迁移须一次性——B2 落盘 current/<省>/ 后顶层须清空，否则同省数据双计。`
      );
    }

    const multiProvinceEnabled = process.env.BRANCH_RLS_ENABLED === 'true';
    const deploymentBranch = getDeploymentBranchCode();
    const nonBaselineBranches = [...new Set(subdirFiles.map(f => f.branch))].filter(b => b !== deploymentBranch);
    if (nonBaselineBranches.length > 0 && !multiProvinceEnabled) {
      throw new Error(
        `[Bootstrap] GATED fail-closed：current/ 发现非基准省子目录数据 [${nonBaselineBranches.join(',')}]` +
        `（部署基准省=${deploymentBranch}），但多省模式未激活（BRANCH_RLS_ENABLED!=true）。` +
        `非基准省数据严禁在 RLS 关闭时装入 PolicyFact（跨省串读风险）——应隔离在 validation/<省>/，` +
        `或先开启 BRANCH_RLS_ENABLED 完成 cutover。`
      );
    }

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

    // B1：分组键纳入 branch 维度，防 SC/SX 同起期（或同名）文件跨省互补误删/碰撞覆盖。
    // 扁平文件 branch=undefined → 键前缀恒 ''（`::…`），分组与现状逐字节等价。
    for (const f of files) {
      const branchPrefix = `${f.branch ?? ''}::`;
      const m = datePattern.exec(f.name);
      if (!m) {
        // 非匹配文件：键 = branch::文件名（跨省同名文件不再互相覆盖，P0 生死点）
        const nameKey = `${branchPrefix}${f.name}`;
        groups.set(nameKey, [f]);
        continue;
      }
      const startKey = `${branchPrefix}${m[1]}`;
      const existing = groups.get(startKey) ?? [];
      existing.push(f);
      groups.set(startKey, existing);
    }

    const result: ParquetFileInfo[] = [];
    for (const [key, group] of groups) {
      if (group.length <= 1) {
        result.push(...group);
        continue;
      }
      // 业务互补豁免：剔摩（非摩托）和限摩（仅摩托）按险类切分，时间重叠也无数据翻倍
      // 与 scripts/check-governance.mjs:checkParquetOverlapInCurrent 保持一致
      if (DataBootstrapper.allComplementary(group.map(f => f.name))) {
        console.log(`[Bootstrap] Parquet overlap (start=${key}): all complementary (剔摩/限摩), keeping ${group.length} files`);
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

  /**
   * 判断一组文件名是否两两互补（剔摩↔限摩）。
   * 互补对：一个含 _剔摩_ 一个含 _限摩_。
   * 整组所有 pair 互补时返回 true，应跳过去重保留全部。
   */
  static allComplementary(names: string[]): boolean {
    if (names.length < 2) return false;
    const isPairComplementary = (a: string, b: string) => {
      const aTuomo = /_剔摩_/.test(a);
      const aXianmo = /_限摩_/.test(a);
      const bTuomo = /_剔摩_/.test(b);
      const bXianmo = /_限摩_/.test(b);
      return (aTuomo && bXianmo) || (aXianmo && bTuomo);
    };
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        if (!isPairComplementary(names[i], names[j])) return false;
      }
    }
    return true;
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
  // ADR G3: 多省维度隔离副本探测（GATED 多省共存能力预备）
  // ============================================

  /**
   * 探测某维度域的非 SC 省份隔离副本（warehouse/validation/<省>/dim/<域>/latest.parquet）。
   *
   * 0a 期 validation 下无 dim 副本 → 返回空数组 → loader 单源 = 历史 SQL 逐字节一致（四川零变更）。
   * GATED 多省上线后 SX dim 副本就位 → 返回 [{branchCode:'SX', path}]，loader UNION ALL BY NAME + branch_code。
   * 省份码白名单 `^[A-Z]{2}$`（与 fields.json branch_code 派生字段、getDeploymentBranchCode 同源约束），
   * 排除 SC（SC 走 current/ 标准 dim 路径，作为基准源由调用方传入）。返回按 branchCode 升序确定性排序。
   */
  private resolveBranchDimExtras(domain: string): Array<{ branchCode: string; path: string }> {
    const validationRoot = getValidationRootDir();
    if (!fs.existsSync(validationRoot)) return [];
    const extras: Array<{ branchCode: string; path: string }> = [];
    for (const entry of fs.readdirSync(validationRoot)) {
      if (entry === 'SC' || !/^[A-Z]{2}$/.test(entry)) continue;
      const dimPath = getBranchValidationDimPath(entry, domain);
      if (fs.existsSync(dimPath)) {
        extras.push({ branchCode: entry, path: dimPath });
      }
    }
    return extras.sort((a, b) => a.branchCode.localeCompare(b.branchCode));
  }

  /**
   * 探测某派生域的非 SC 省份隔离副本（warehouse/validation/<省>/<域>/latest.parquet）（ADR G4）。
   *
   * 与 resolveBranchDimExtras 同逻辑，仅路径模板不同（派生域无 dim 子层）。G1 已落 SX 的
   * quotes_conversion/renewal_tracker → GATED 多省时 loader UNION ALL BY NAME 携真实 branch_code；
   * 0a 期缺者 → 空 → loader 单源 = 历史 selectWithBranchCode 等价（字节安全）。
   */
  private resolveBranchFactExtras(domain: string): Array<{ branchCode: string; path: string }> {
    const validationRoot = getValidationRootDir();
    if (!fs.existsSync(validationRoot)) return [];
    const extras: Array<{ branchCode: string; path: string }> = [];
    for (const entry of fs.readdirSync(validationRoot)) {
      if (entry === 'SC' || !/^[A-Z]{2}$/.test(entry)) continue;
      const factPath = getBranchValidationFactPath(entry, domain);
      if (fs.existsSync(factPath)) {
        extras.push({ branchCode: entry, path: factPath });
      }
    }
    return extras.sort((a, b) => a.branchCode.localeCompare(b.branchCode));
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
        // ADR G3 多省共存：探测 SX 等非 SC 省份的 dim 隔离副本（0a 期无 → 空 → 单源字节安全）
        const salesmanExtras = this.resolveBranchDimExtras('salesman');
        const planExtras = this.resolveBranchDimExtras('plan');
        await domainLoaders.loadDimParquet(this.db, salesmanDimPath, planDimPath, salesmanExtras, planExtras);
        console.log('[Bootstrap] Dim tables loaded (Parquet):', salesmanDimPath, planDimPath,
          salesmanExtras.length ? `+${salesmanExtras.length} branch(es)` : '(SC-only)');
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

    // ClaimsDetail（280k 行，按年度分区，必须惰性）
    this.lazyRegistry.register('ClaimsDetail', async () => {
      // 优先：分区目录（claims_*.parquet glob）
      const dir = getClaimsDetailDirs().find(d =>
        fs.existsSync(d) && fs.readdirSync(d).some(f => f.startsWith('claims_') && f.endsWith('.parquet'))
      );
      if (dir) {
        const globPath = `${dir.replace(/\\/g, '/')}/claims_*.parquet`;
        console.time('[Bootstrap:Lazy] ClaimsDetail (partitioned)');
        await domainLoaders.loadClaimsDetail(db, globPath);
        console.timeEnd('[Bootstrap:Lazy] ClaimsDetail (partitioned)');
        return;
      }
      // 回退：单文件 latest.parquet（旧架构兼容）
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
      await domainLoaders.loadCrossSell(db, p, this.resolveBranchFactExtras('cross_sell'));
      await materialization.createCrossSellRealtimeView(db);
      console.timeEnd('[Bootstrap:Lazy] CrossSell');
    });

    // RepairDim（1.3MB，仅维修页）
    this.lazyRegistry.register('RepairDim', async () => {
      const p = getRepairDimPaths().find(p => fs.existsSync(p));
      if (!p) return;
      // ADR G3 多省共存：探测 SX 等非 SC 省份维修隔离副本（0a 期无 → 空 → 单源字节安全）
      const extras = this.resolveBranchDimExtras('repair');
      await domainLoaders.loadRepairDim(db, p, extras);
    });

    // BrandDim（13MB，必须惰性）
    this.lazyRegistry.register('BrandDim', async () => {
      const p = getBrandDimPaths().find(p => fs.existsSync(p));
      if (!p) return;
      console.time('[Bootstrap:Lazy] BrandDim');
      await domainLoaders.loadBrandDim(db, p);
      console.timeEnd('[Bootstrap:Lazy] BrandDim');
    });

    // CustomerFlow（仅客户来源页；BACKLOG 86d10f 后改为从 PolicyFact 派生，不再读独立 parquet）
    this.lazyRegistry.register('CustomerFlow', async () => {
      await domainLoaders.loadCustomerFlow(db);
    });

    // NewEnergyClaims（新能源出险信息全量快照）
    this.lazyRegistry.register('NewEnergyClaims', async () => {
      const p = getNewEnergyClaimsPaths().find(p => fs.existsSync(p));
      if (!p) return;
      await domainLoaders.loadNewEnergyClaims(db, p, this.resolveBranchFactExtras('new_energy_claims'));
    });

    // QuoteConversion（仅报价转化页）
    this.lazyRegistry.register('QuoteConversion', async () => {
      const p = getQuoteConversionPaths().find(p => fs.existsSync(p));
      if (!p) return;
      await domainLoaders.loadQuoteConversion(db, p, this.resolveBranchFactExtras('quotes_conversion'));
    });

    // RenewalTracker（派生域，仅续保追踪页）
    this.lazyRegistry.register('RenewalTracker', async () => {
      const p = getRenewalTrackerPaths().find(p => fs.existsSync(p));
      if (!p) { console.warn('[Bootstrap:Lazy] RenewalTracker: no file found'); return; }
      console.time('[Bootstrap:Lazy] RenewalTracker');
      await domainLoaders.loadRenewalTracker(db, p, this.resolveBranchFactExtras('renewal_tracker'));
      console.timeEnd('[Bootstrap:Lazy] RenewalTracker');
    });

    console.log('[Bootstrap] Lazy domains registered: ClaimsDetail, ClaimsAgg, CrossSell, RepairDim, BrandDim, CustomerFlow, NewEnergyClaims, QuoteConversion, RenewalTracker');
  }

  // ============================================
  // 公共 API：供路由中间件使用
  // ============================================

  /**
   * 供路由中间件调用：确保指定域已加载（首次触发加载，含 15s 超时保护）。
   * 超时返回 503，失败返回 500，并发安全（Promise 锁）。
   */
  async ensureDomainLoaded(domain: string, options?: LazyDomainLoadOptions): Promise<void> {
    return this.lazyRegistry.ensureLoaded(domain, options);
  }

  /**
   * 供监控/健康检查：获取域当前加载状态
   * ('unloaded' | 'loading' | 'loaded' | 'failed' | 'unknown')
   */
  getDomainState(domain: string): string {
    return this.lazyRegistry.getState(domain);
  }

  /**
   * 数据发布后按域重载 full_snapshot 辅助域。
   * 不重建 PolicyFact / CrossSellDailyAgg 等无关关系，只重建对应 VIEW 并让缓存版本失效。
   */
  async reloadDomains(domainIds: string[]): Promise<Array<{ domain: string; lazyName: string; relation: string; rowCount: number | null; state: string }>> {
    const results = [];
    for (const domainId of domainIds) {
      const cfg = RELOADABLE_FULL_SNAPSHOT_DOMAINS[domainId];
      if (!cfg) {
        throw new Error(`Unsupported data reload domain: ${domainId}`);
      }
      await this.lazyRegistry.reload(cfg.lazyName);
      const rows = await this.db.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${cfg.relation}`);
      results.push({
        domain: domainId,
        lazyName: cfg.lazyName,
        relation: cfg.relation,
        rowCount: rows[0]?.cnt ?? null,
        state: this.lazyRegistry.getState(cfg.lazyName),
      });
    }
    this.db.invalidateCache();
    bumpDataVersionFromTimestamp();
    return results;
  }
}
