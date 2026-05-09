/** DuckDB 服务主类（≤110 行）— 详见各子模块：duckdb-infra / parquet-loader / type-converter / init-tables */
import { DuckDBInstance } from '@duckdb/node-api';
import { databaseConfig, DUCKDB_INIT_OPTIONS } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { sanitizeTableName, escapeSqlValue } from '../utils/security.js';
import { recordQueryMetric, getRequestContext } from '../utils/request-context.js';
import { QueryCache, ConnectionPool, dropRelationIfExists, hasRelation, getTableSchema } from './duckdb-infra.js';
import type { DuckDBQueryable } from './duckdb-types.js';
import { initDuckDBTables } from './duckdb-init-tables.js';
import { convertBigIntToNumber, SLOW_QUERY_THRESHOLD_MS } from './duckdb-type-converter.js';
import { loadMultipleParquet, computeParquetFingerprint } from './duckdb-parquet-loader.js';
import { setDataVersion, bumpDataVersionFromTimestamp } from './data-version.js';

/** 构造参数（省略字段从 databaseConfig / DUCKDB_INIT_OPTIONS 回退；测试传 `{ path: ':memory:' }`） */
export interface DuckDBServiceConfig {
  path?: string;
  maxConnections?: number;
  maxMemory?: string;
  threads?: number;
}

export class DuckDBService implements DuckDBQueryable {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;
  private connectionPool: ConnectionPool | null = null;
  private queryCache = new QueryCache();

  constructor(private readonly config?: DuckDBServiceConfig) {}

  async init(): Promise<void> {
    if (this.isInitialized) return;
    try {
      const dbPath = this.config?.path ?? databaseConfig.path;
      const maxConn = this.config?.maxConnections ?? databaseConfig.maxConnections ?? 10;
      const maxMem = this.config?.maxMemory ?? DUCKDB_INIT_OPTIONS.max_memory;
      const threads = this.config?.threads ?? DUCKDB_INIT_OPTIONS.threads;
      this.instance = await DuckDBInstance.create(dbPath, { max_memory: maxMem, threads: String(threads) });
      this.connectionPool = new ConnectionPool(this.instance, maxConn);
      await this.query(`SET memory_limit='${maxMem}'`); await this.query(`SET threads=${threads}`); // 显式 SET 确保生效
      console.log('[DuckDB] Database initialized:', dbPath, `(pool max: ${maxConn}, max_memory: ${maxMem}, threads: ${threads})`);
      this.isInitialized = true;
      await initDuckDBTables(this);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(500, `Failed to initialize DuckDB: ${message}`);
    }
  }

  invalidateCache(options?: { silent?: boolean }): void {
    // 仅清 DuckDB 内部 SQL cache。route-cache 由 dataVersion 后缀驱动，旧版本 key
    // 在 ETL 后自然不再被命中，由 LRU 淘汰，无需主动清空（避免日切 cold cliff）。
    const size = this.queryCache.size;
    this.queryCache.invalidateAll();
    if (size > 0 && !options?.silent) console.log(`[DuckDB] Query cache invalidated (${size} entries; route cache preserved, version-keyed)`);
  }

  get cacheSize(): number { return this.queryCache.size; }

  /** 连接池状态快照（供 /health 等观测端点使用，未初始化时返回 null） */
  getPoolStats(): { active: number; idle: number; waiting: number; maxSize: number } | null {
    return this.connectionPool?.stats() ?? null;
  }

  async query<T = any>(sql: string, cacheTtlMs: number = 0): Promise<T[]> {
    if (cacheTtlMs > 0) {
      const cached = this.queryCache.get<T[]>(sql);
      if (cached) { recordQueryMetric(sql, 0, true); return cached; }
    }
    if (!this.connectionPool) throw new AppError(500, 'DuckDB not initialized');
    const pool = this.connectionPool; // 捕获引用，防止 close() 期间置 null 导致 finally 空引用
    const conn = await pool.acquire();
    const startTime = Date.now();
    try {
      const reader = await conn.runAndReadAll(sql);
      const result = reader.getRowObjects();
      const duration = Date.now() - startTime;
      if (duration > SLOW_QUERY_THRESHOLD_MS) {
        const ctx = getRequestContext();
        console.warn(`[DuckDB] ⚠️ Slow query (${duration}ms) route=${ctx?.routeKey ?? 'unknown'} reqId=${ctx?.requestId ?? '-'}`);
      }
      const converted = convertBigIntToNumber(result) as T[];
      if (cacheTtlMs > 0) this.queryCache.set(sql, converted, cacheTtlMs);
      recordQueryMetric(sql, duration, false);
      return converted;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      recordQueryMetric(sql, duration, false);
      const ctx = getRequestContext();
      const errorId = ctx?.requestId ?? Math.random().toString(36).slice(2, 10);
      console.error(`[DuckDB] [${errorId}] Query error (${duration}ms):`, message);
      throw new AppError(400, process.env.NODE_ENV === 'production' ? `查询执行失败 [${errorId}]` : `查询执行失败: ${message}`);
    } finally {
      pool.release(conn);
    }
  }

  async loadParquet(filePath: string, tableName: string = 'raw_parquet'): Promise<void> {
    await this.dropRelationIfExists(sanitizeTableName(tableName));
    await this.query(`CREATE OR REPLACE TABLE ${sanitizeTableName(tableName)} AS SELECT * FROM read_parquet('${escapeSqlValue(filePath)}')`);
    this.invalidateCache();
    // 单文件路径也必须 bump dataVersion，否则旧 cache key 会继续命中重建前的结果。
    // 优先按文件指纹（mtime+size），stat 失败时退回到时间戳兜底。
    const fp = computeParquetFingerprint([filePath]);
    if (fp !== null) {
      setDataVersion(fp.fingerprint);
    } else {
      bumpDataVersionFromTimestamp();
    }
    console.log(`[DuckDB] Loaded Parquet file: ${filePath} -> ${sanitizeTableName(tableName)}`);
  }

  async loadMultipleParquet(filePaths: string[]): Promise<{ totalRows: number }> { return loadMultipleParquet(this, filePaths); }

  async hasRelation(name: string): Promise<boolean> { return hasRelation(this, name); }
  async dropRelationIfExists(name: string): Promise<void> { return dropRelationIfExists(this, name); }
  async getTableSchema(name: string): Promise<any[]> { return getTableSchema(this, name); }

  async close(): Promise<void> {
    if (this.connectionPool) { await this.connectionPool.closeAll(); this.connectionPool = null; }
    this.queryCache.invalidateAll();
    if (this.instance) { this.instance = null; this.isInitialized = false; console.log('[DuckDB] Database closed'); }
  }
}

/** 测试用工厂：`createDuckDBService({ path: ':memory:' })` */
export function createDuckDBService(config?: DuckDBServiceConfig): DuckDBService { return new DuckDBService(config); }
export const duckdbService = new DuckDBService(); // 全局单例（生产用）
export { DERIVED_RELATIONS } from './duckdb-materialization.js'; // @internal 测试用派生表名列表
