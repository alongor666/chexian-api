/**
 * DuckDB 数据库配置
 * Database Configuration
 */

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
  path: process.env.DUCKDB_PATH || ':memory:',
  dataPath: process.env.DATA_PATH || './data',
  readOnly: false,
  maxConnections: 10,
};

/**
 * DuckDB 初始化配置
 */
export const DUCKDB_INIT_OPTIONS = {
  allow_unsigned_extensions: false,
  max_memory: '4GB',
  threads: 4,
};
