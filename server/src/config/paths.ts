/**
 * 路径配置
 * Path Configuration
 *
 * 使用 import.meta.url 计算稳定的绝对路径，不依赖 process.cwd()。
 * 解决从不同目录启动时 data/ 路径解析错误的问题。
 */

import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** server/ 目录的绝对路径（从 server/src/config/ 向上两级） */
export const SERVER_ROOT = path.resolve(__dirname, '..', '..');

/** 获取 server/data/ 目录的绝对路径 */
export function getDataDir(): string {
  return path.resolve(SERVER_ROOT, 'data');
}

/**
 * 获取所有候选 Parquet 数据目录（按优先级排序）。
 * 本地开发：warehouse 目录优先（最新数据直接可用，无需手动 cp）
 * VPS 部署：只有 server/data/，warehouse 目录不存在则自动跳过
 */
export function getCandidateDataDirs(): string[] {
  const warehouseCurrent = path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/policy/current');
  const serverDataCurrent = path.resolve(getDataDir(), 'current');
  return [warehouseCurrent, serverDataCurrent];
}


export function getKpiPlanConfigPath(): string {
  return path.resolve(SERVER_ROOT, '../数据管理/warehouse/dim/业务员归属与规划/kpi_plan_config.json');
}

/**
 * 固定成本参数 SSOT 文件路径（数据管理/config/fixed-cost-params.json）。
 * ⚠️ 该文件仅在开发/CI 全仓 checkout 下存在，不部署到 VPS（sync-vps 只推 parquet）。
 * 故仅供离线脚本 / 单测读取（如附加税费率漂移测试），生产运行时禁止依赖它。
 */
export function getFixedCostParamsPath(): string {
  return path.resolve(SERVER_ROOT, '../数据管理/config/fixed-cost-params.json');
}

// ── 赔案明细 Parquet 路径（分区目录 glob，本地优先，VPS 回退）──

export function getClaimsDetailDirs(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/claims_detail'),
    path.resolve(getDataDir(), 'fact/claims_detail'),
  ];
}

/** @deprecated 兼容旧代码，优先使用 getClaimsDetailDirs() */
export function getClaimsDetailPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/claims_detail/latest.parquet'),
    path.resolve(getDataDir(), 'fact/claims_detail/latest.parquet'),
  ];
}

// ── 多省维度隔离副本路径（ADR G3 · GATED 多省共存能力预备）──

/**
 * GATED 多省共存：维度/派生域隔离副本根目录候选（本地 warehouse 优先，VPS data/ 回退）（PR-2）。
 * - 候选 0：本地开发 `数据管理/warehouse/validation`（ETL 产物落此）。
 * - 候选 1：VPS 运行时 `server/data/validation`（sync-vps 推送目标；VPS 无 warehouse）。
 * 0a 期各省 SX premium/quotes/renewal 隔离产物落此（validation/<省>/…），绝不进 current/（ADR D5）。
 */
export function getValidationRootDirs(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/validation'),
    path.resolve(getDataDir(), 'validation'),
  ];
}

/**
 * validation 隔离区根目录：返回首个存在的候选（本地 warehouse 优先，VPS data/validation 回退）。
 * 两者皆不存在 → 默认返回首个候选（candidates[0]=warehouse），调用方（data-bootstrapper）existsSync
 * guard 兜底返回 [] → 与历史行为逐字节等价（字节安全）。维度副本镜像 SC 的 dim/<域> → validation/<省>/dim/<域>/。
 *
 * @param candidates 候选根目录列表（默认 getValidationRootDirs()）；可注入以确定性测试选择逻辑，
 *   不依赖真实机器的 warehouse/data 文件系统状态（生产调用方一律用默认）。
 */
export function getValidationRootDir(candidates: string[] = getValidationRootDirs()): string {
  return candidates.find((d) => existsSync(d)) ?? candidates[0];
}

/**
 * 某省某维度域的 validation 隔离副本路径（warehouse/validation/<省>/dim/<域>/latest.parquet）。
 * branchCode 由调用方（data-bootstrapper）以 `^[A-Z]{2}$` 校验；domain 为维度域名（salesman/plan/repair）。
 * 0a 期该路径通常不存在 → data-bootstrapper 探测后不传，loader 单源 = 字节安全。
 */
export function getBranchValidationDimPath(branchCode: string, domain: string): string {
  return path.resolve(getValidationRootDir(), branchCode, 'dim', domain, 'latest.parquet');
}

/**
 * 某省某派生域的 validation 隔离副本路径（warehouse/validation/<省>/<域>/latest.parquet）（ADR G4）。
 * 派生域（quotes_conversion/cross_sell/new_energy_claims/renewal_tracker）镜像 SC 的 fact/<域> 结构，
 * 但落隔离根 validation/<省>/<域>（无 dim 子层，与维度路径区分）。G1 已落 SX 的 quotes_conversion/renewal_tracker。
 * 0a 期缺者 → data-bootstrapper 探测后不传，loader 单源 = 字节安全。
 */
export function getBranchValidationFactPath(branchCode: string, domain: string): string {
  return path.resolve(getValidationRootDir(), branchCode, domain, 'latest.parquet');
}

/**
 * 某省赔案明细的 validation 隔离副本目录（warehouse/validation/<省>/claims_detail）（PR-1·ADR G4 扩展）。
 * 与派生域（getBranchValidationFactPath 返回单 latest.parquet）刻意不同：claims_detail 是 CDC 年度分区
 * 目录（claims_*.parquet glob），故返回**目录**，由 data-bootstrapper 探测目录内 claims_*.parquet 后拼 glob，
 * 传入 loadClaimsDetail 的 extraSources（保留 union_by_name 容忍分区 schema 漂移）。
 * 0a 期缺者 → 探测后不传，loadClaimsDetail 单源 = 字节安全。
 */
export function getBranchValidationClaimsDetailDir(branchCode: string): string {
  return path.resolve(getValidationRootDir(), branchCode, 'claims_detail');
}

// ── 维度表 Parquet 路径（本地优先，VPS 回退）──

export function getSalesmanDimPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/dim/salesman/latest.parquet'),
    path.resolve(getDataDir(), 'dim/salesman/latest.parquet'),
  ];
}

export function getPlanDimPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/dim/plan/latest.parquet'),
    path.resolve(getDataDir(), 'dim/plan/latest.parquet'),
  ];
}

/**
 * 获取业务员机构映射 JSON 的候选路径（按优先级）。
 * 1) 本地开发优先使用 warehouse 最新文件
 * 2) VPS/部署环境回退到 server/data/
 */
export function getUserStorePath(): string {
  return path.resolve(getDataDir(), 'user_store.json');
}

/**
 * PAT 持久层文件路径。DuckDB ApiToken 表是 :memory: 表，
 * PM2 reload 后必须从此文件重建，否则用户 token 全部失效。
 */
export function getApiTokenStorePath(): string {
  return path.resolve(getDataDir(), 'api_tokens.json');
}

/**
 * state.db SQLite 文件路径（v5 状态持久层迁移）。
 * 优先级：dbEnv.STATE_DB_PATH > server/data/state.db
 * 仅 STATE_STORE_BACKEND=sqlite 时被 init，否则文件不会被创建。
 */
export function getStateDbPath(stateDbPathEnv: string): string {
  if (stateDbPathEnv) {
    return path.isAbsolute(stateDbPathEnv)
      ? stateDbPathEnv
      : path.resolve(SERVER_ROOT, stateDbPathEnv);
  }
  return path.resolve(getDataDir(), 'state.db');
}

/**
 * 一次性迁移标记文件路径（v5 状态持久层迁移）。
 * 防止 import-from-json 脚本在 SQLite 已迁移后重复执行。
 * 每个 scope 独立 lock 文件：users / pat，避免 Phase 2 已部署的 lock 被 Phase 3 误改语义。
 * 内容：{ migrated_at, source_hash, scope } JSON。
 */
export function getStateMigrationLockPath(scope: 'users' | 'pat'): string {
  return path.resolve(getDataDir(), `.state-migration-${scope}.lock`);
}

/**
 * Phase 2 旧版无 scope 后缀的 lock 路径（仅 users 用过）。
 * codex P2 (PR #389) 修复：scope 命名重构后必须把旧锁也视为已迁移，
 * 否则在「旧锁存在 + state.db 丢失」场景下会用旧 user_store.json 覆盖运行期变更。
 * 仅 admin-import-users-from-json.ts 读，不写。
 */
export function getLegacyStateMigrationLockPath(): string {
  return path.resolve(getDataDir(), '.state-migration.lock');
}

// ── 报价转化 Parquet 路径（本地优先，VPS 回退）──

export function getQuoteConversionPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/quotes_conversion/latest.parquet'),
    path.resolve(getDataDir(), 'fact/quotes_conversion/latest.parquet'),
  ];
}

export function getPlateRegionDimPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/dim/plate_region/latest.parquet'),
    path.resolve(getDataDir(), 'dim/plate_region/latest.parquet'),
  ];
}

// ── 交叉销售 Parquet 路径 ──

export function getCrossSellPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/cross_sell/latest.parquet'),
    path.resolve(getDataDir(), 'fact/cross_sell/latest.parquet'),
  ];
}

// ── 维修资源 Parquet 路径 ──

export function getRepairDimPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/dim/repair/latest.parquet'),
    path.resolve(getDataDir(), 'dim/repair/latest.parquet'),
  ];
}

// ── 品牌维度 Parquet 路径 ──

export function getBrandDimPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/dim/brand/latest.parquet'),
    path.resolve(getDataDir(), 'dim/brand/latest.parquet'),
  ];
}

// ── 客户来源去向 Parquet 路径 ──

export function getCustomerFlowPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/customer_flow/latest.parquet'),
    path.resolve(getDataDir(), 'fact/customer_flow/latest.parquet'),
  ];
}

// ── 新能源出险信息 Parquet 路径 ──

export function getNewEnergyClaimsPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/new_energy_claims/latest.parquet'),
    path.resolve(getDataDir(), 'fact/new_energy_claims/latest.parquet'),
  ];
}

// ── 续保追踪派生域 Parquet 路径 ──

export function getRenewalTrackerPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/renewal_tracker/latest.parquet'),
    path.resolve(getDataDir(), 'fact/renewal_tracker/latest.parquet'),
  ];
}

// ── HTML 报告托管目录 ──────────────────────────────────────────────────────

/** HTML 报告托管目录：server/data/reports/，由 /api/reports/:filename 路由 serve */
export function getReportsDir(): string {
  return path.resolve(getDataDir(), 'reports');
}

/**
 * 静态报告根目录候选（B346 门户路由 /api/reports/portal/* 的取数源）。
 * - 候选 0：本地开发 `<repo>/public/reports`（diagnose-* skill 产物落此，Vite dev 同源）。
 * - 候选 1：VPS 运行时 `/var/www/chexian/frontend/dist/reports`（sync-vps 把 public/reports
 *   推到 frontendDist/reports 供 Nginx 静态托管；SERVER_ROOT=/var/www/chexian/server，
 *   故相对定位 `../frontend/dist/reports`，与 getCandidateDataDirs 同一「本地优先、VPS 回退」约定）。
 */
export function getStaticReportsRootDirs(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../public/reports'),
    path.resolve(SERVER_ROOT, '../frontend/dist/reports'),
  ];
}

/** 静态报告根目录：首个存在的候选；均不存在 → 候选 0（调用方 existsSync 兜 404）。 */
export function getStaticReportsRoot(): string {
  const candidates = getStaticReportsRootDirs();
  return candidates.find((d) => existsSync(d)) ?? candidates[0];
}

export function getSalesmanMappingPaths(): string[] {
  const warehousePath = path.resolve(
    SERVER_ROOT,
    '../数据管理/warehouse/dim/业务员归属与规划/salesman_organization_mapping.json'
  );
  const fallbackPath = path.resolve(getDataDir(), 'salesman_organization_mapping.json');
  return [warehousePath, fallbackPath];
}
