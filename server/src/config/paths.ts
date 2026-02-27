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

/**
 * 获取业务员机构映射 JSON 的候选路径（按优先级）。
 * 1) 本地开发优先使用 warehouse 最新文件
 * 2) VPS/部署环境回退到 server/data/
 */
export function getSalesmanMappingPaths(): string[] {
  const warehousePath = path.resolve(
    SERVER_ROOT,
    '../数据管理/warehouse/dim/业务员归属与规划/salesman_organization_mapping.json'
  );
  const fallbackPath = path.resolve(getDataDir(), 'salesman_organization_mapping.json');
  return [warehousePath, fallbackPath];
}
