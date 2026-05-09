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
  // 严苛边界：与 2 核 VPS 物理对齐（2 核 × THREADS=2 = 4 worker 槽，1:1 对齐）
  // 通过 DUCKDB_MAX_CONNECTIONS env 可在 VPS reload 时调参，无需重新部署
  maxConnections: dbEnv.DUCKDB_MAX_CONNECTIONS,
};

/**
 * DuckDB 初始化配置
 *
 * 通过环境变量适配不同运行环境：
 * - VPS (2核4G)：设置 DUCKDB_MAX_MEMORY=1.5GB  DUCKDB_THREADS=2
 * - Mac 本地开发：不设置，默认使用高性能配置
 */
export const DUCKDB_INIT_OPTIONS = {
  allow_unsigned_extensions: false,
  max_memory: dbEnv.DUCKDB_MAX_MEMORY,
  threads: dbEnv.DUCKDB_THREADS,
};
