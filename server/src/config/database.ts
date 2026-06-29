/**
 * DuckDB 数据库配置
 * Database Configuration
 */

import { dbEnv } from './env.js';

export interface DatabaseConfig {
  /** 数据库文件路径（:memory: 表示内存数据库） */
  path: string;
  /** Parquet数据文件目录 */
  dataPath: string;
  /** 是否只读模式 */
  readOnly: boolean;
  /** 最大连接数 */
  maxConnections: number;
}

export const databaseConfig: DatabaseConfig = {
  path: dbEnv.DUCKDB_PATH,
  dataPath: dbEnv.DATA_PATH,
  readOnly: false,
  // 严苛边界：双重对齐 —— CPU 物理上限 ∩ 应用 fanout 下限
  // 默认 8 槽：覆盖 bundles 路由单请求 10 query 并发，仍比原 10 紧 20%
  // 通过 DUCKDB_MAX_CONNECTIONS env 可在 VPS reload 时调参，无需重新部署
  maxConnections: dbEnv.DUCKDB_MAX_CONNECTIONS,
};

/**
 * DuckDB 初始化配置
 *
 * 通过环境变量适配不同运行环境：
 * - VPS (4核4G)：设置 DUCKDB_MAX_MEMORY=1.5GB  DUCKDB_THREADS=2
 * - Mac 本地开发：不设置，默认使用高性能配置
 */
export const DUCKDB_INIT_OPTIONS = {
  allow_unsigned_extensions: false,
  max_memory: dbEnv.DUCKDB_MAX_MEMORY,
  threads: dbEnv.DUCKDB_THREADS,
  /**
   * 显式 spill 路径（空串=用 DuckDB cwd 下 .tmp/ 默认行为，与历史一致）。
   * 详见 env.ts DUCKDB_TEMP_DIR 注释；生产建议显式指向大盘避免根盘 spill 撑满。
   */
  temp_directory: dbEnv.DUCKDB_TEMP_DIR,
};
