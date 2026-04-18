/**
 * 路径配置
 * Path Configuration
 *
 * 使用 import.meta.url 计算稳定的绝对路径，不依赖 process.cwd()。
 * 解决从不同目录启动时 data/ 路径解析错误的问题。
 */

import path from 'path';
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

// ── 巡检报告 JSON 路径 ──

export function getPatrolReportPaths(domain: string): string[] {
  return [
    path.resolve(SERVER_ROOT, `../数据管理/patrol_reports/${domain}/latest.json`),
    path.resolve(getDataDir(), `patrol_reports/${domain}/latest.json`),
  ];
}

export function getPatrolNarrativePaths(domain: string): string[] {
  return [
    path.resolve(SERVER_ROOT, `../数据管理/patrol_reports/${domain}/report.md`),
    path.resolve(getDataDir(), `patrol_reports/${domain}/report.md`),
  ];
}

// ── 快照 JSON 路径（本地优先，VPS 回退）──

export function getSnapshotDirs(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/snapshots'),
    path.resolve(getDataDir(), 'snapshots'),
  ];
}

export function getSalesmanMappingPaths(): string[] {
  const warehousePath = path.resolve(
    SERVER_ROOT,
    '../数据管理/warehouse/dim/业务员归属与规划/salesman_organization_mapping.json'
  );
  const fallbackPath = path.resolve(getDataDir(), 'salesman_organization_mapping.json');
  return [warehousePath, fallbackPath];
}
