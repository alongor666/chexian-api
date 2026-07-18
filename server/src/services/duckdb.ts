/** DuckDB 服务主类（≤110 行）— 详见各子模块：duckdb-infra / parquet-loader / type-converter / init-tables */
import { DuckDBInstance } from '@duckdb/node-api';
import { databaseConfig, DUCKDB_INIT_OPTIONS } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { sanitizeTableName, escapeSqlValue } from '../utils/security.js';
import { recordQueryMetric, getRequestContext } from '../utils/request-context.js';
import { QueryCache, ConnectionPool, dropRelationIfExists, hasRelation, getTableSchema } from './duckdb-infra.js';
import type { DuckDBTransactionalQueryable } from './duckdb-types.js';
import { initDuckDBTables } from './duckdb-init-tables.js';
import { convertBigIntToNumber, SLOW_QUERY_THRESHOLD_MS } from './duckdb-type-converter.js';
import { loadMultipleParquet, computeParquetFingerprint, replaceTableFromSelect } from './duckdb-parquet-loader.js';
import { makeTimestampVersionToken } from './data-version.js';
import { classifyDuckDbError, isDuckDbOomMessage, markDuckDbOom } from './duckdb-error-classifier.js';

/** 构造参数（省略字段从 databaseConfig / DUCKDB_INIT_OPTIONS 回退；测试传 `{ path: ':memory:' }`） */
export interface DuckDBServiceConfig {
  path?: string;
  maxConnections?: number;
  maxMemory?: string;
  threads?: number;
  /**
   * 显式 spill 路径（larger-than-memory 临时盘）。
   *   - undefined：从 DUCKDB_INIT_OPTIONS.temp_directory 回退
   *   - 空串：保留 DuckDB 默认（cwd 下 .tmp/），与历史一致
   *   - 非空：init 时 `SET temp_directory='${此值}'`
   */
  tempDirectory?: string;
}

export class DuckDBService implements DuckDBTransactionalQueryable {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;
  private connectionPool: ConnectionPool | null = null;
  private queryCache = new QueryCache();
  private inflightQueries = new Map<string, Promise<any[]>>();
  private queryCacheEpoch = 0;

  constructor(private readonly config?: DuckDBServiceConfig) {}

  async init(): Promise<void> {
    if (this.isInitialized) return;
    try {
      const dbPath = this.config?.path ?? databaseConfig.path;
      const maxConn = this.config?.maxConnections ?? databaseConfig.maxConnections ?? 10;
      const maxMem = this.config?.maxMemory ?? DUCKDB_INIT_OPTIONS.max_memory;
      const threads = this.config?.threads ?? DUCKDB_INIT_OPTIONS.threads;
      const tempDir = this.config?.tempDirectory ?? DUCKDB_INIT_OPTIONS.temp_directory;
      this.instance = await DuckDBInstance.create(dbPath, { max_memory: maxMem, threads: String(threads) });
      this.connectionPool = new ConnectionPool(this.instance, maxConn);
      await this.query(`SET memory_limit='${maxMem}'`); await this.query(`SET threads=${threads}`); // 显式 SET 确保生效
      // 非空时显式 SET temp_directory（运维指向 SSD/大盘）；空时保持 DuckDB 默认（cwd 下 .tmp/）
      if (tempDir) await this.query(`SET temp_directory='${escapeSqlValue(tempDir)}'`);
      // 启动日志输出真实生效的 temp_directory（cost 立方体 OOM 诊断时需要可观测，B 阶段 PR-12 引入）
      const actualTempDir = (await this.query<{ temp_directory: string }>(`SELECT current_setting('temp_directory') AS temp_directory`))[0]?.temp_directory ?? '?';
      console.log('[DuckDB] Database initialized:', dbPath, `(pool max: ${maxConn}, max_memory: ${maxMem}, threads: ${threads}, temp_directory: ${actualTempDir})`);
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
    this.inflightQueries.clear();
    this.queryCacheEpoch++;
    if (size > 0 && !options?.silent) console.log(`[DuckDB] Query cache invalidated (${size} entries; route cache preserved, version-keyed)`);
  }

  get cacheSize(): number { return this.queryCache.size; }

  /** 连接池状态快照（供 /health 等观测端点使用，未初始化时返回 null） */
  getPoolStats(): {
    active: number;
    idle: number;
    waiting: number;
    maxSize: number;
    saturatedRecently: boolean;
  } | null {
    return this.connectionPool?.stats() ?? null;
  }

  async query<T = any>(sql: string, cacheTtlMs: number = 0): Promise<T[]> {
    if (cacheTtlMs > 0) {
      const cached = this.queryCache.get<T[]>(sql);
      if (cached) { recordQueryMetric(sql, 0, true); return cached; }
      const inflight = this.inflightQueries.get(sql) as Promise<T[]> | undefined;
      if (inflight) {
        const result = await inflight;
        recordQueryMetric(sql, 0, true);
        return result;
      }

      const promise = this.executeQuery(sql, cacheTtlMs, this.queryCacheEpoch);
      this.inflightQueries.set(sql, promise);
      try {
        return await promise;
      } finally {
        if (this.inflightQueries.get(sql) === promise) {
          this.inflightQueries.delete(sql);
        }
      }
    }
    return this.executeQuery(sql, cacheTtlMs, this.queryCacheEpoch);
  }

  private async executeQuery<T = any>(sql: string, cacheTtlMs: number = 0, cacheEpoch: number = this.queryCacheEpoch): Promise<T[]> {
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
      if (cacheTtlMs > 0 && cacheEpoch === this.queryCacheEpoch) this.queryCache.set(sql, converted, cacheTtlMs);
      recordQueryMetric(sql, duration, false);
      return converted;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      recordQueryMetric(sql, duration, false);
      const ctx = getRequestContext();
      const errorId = ctx?.requestId ?? Math.random().toString(36).slice(2, 10);
      console.error(`[DuckDB] [${errorId}] Query error (${duration}ms):`, message);
      // OOM 结构化标记：脱敏后消息里没有 OOM 字样，duckdb-cube 的降级判定
      // （isOutOfMemoryError）只能靠此标记识别——修复「生产脱敏杀死 OOM 降级」死代码
      // （哨兵 issue #608，cost 立方体 2026-06-25 起无限重试构建）。
      const oom = isDuckDbOomMessage(message);
      if (process.env.NODE_ENV === 'production') {
        // 生产仍屏蔽原始消息（防泄露），但叠加白名单安全分类，让 cx sql 用户可自助 debug。
        // classifyDuckDbError 只回传固定分类 + 用户自己引用的 schema 标识符，绝不带原始消息/数据值/完整 SQL。
        const category = classifyDuckDbError(message);
        const appError = new AppError(400, category ? `查询执行失败 [${errorId}]：${category}` : `查询执行失败 [${errorId}]`);
        if (oom) markDuckDbOom(appError);
        throw appError;
      }
      const devError = new AppError(400, `查询执行失败: ${message}`);
      if (oom) markDuckDbOom(devError);
      throw devError;
    } finally {
      pool.release(conn);
    }
  }

  /**
   * 在**单一连接**内以事务方式顺序执行多条写语句（BEGIN → … → COMMIT，出错 ROLLBACK）。
   *
   * 追加方法（非改已有 query 逻辑）：写路径若把「先 DELETE 再 INSERT 同主键」拆成多次
   * `query()` 调用，会各自 `pool.acquire()` 落到不同连接、无事务边界 —— 一旦中间步失败，
   * 表被留在半写状态（实测：setUserPasswordByUsername 的 DELETE/INSERT 拆连接后偶发
   * `Duplicate key … violates primary key`，账号被写坏到下次 reseed）。本方法保证这组语句
   * 要么全部提交、要么全部回滚，且都在同一连接顺序执行（DELETE 对 INSERT 立即可见）。
   *
   * 仅供内部写路径使用；不缓存、不返回行。出错时日志记原始错误（含 reqId），对外抛脱敏 AppError。
   */
  async transaction(statements: string[]): Promise<void> {
    if (!this.connectionPool) throw new AppError(500, 'DuckDB not initialized');
    if (statements.length === 0) return;
    const pool = this.connectionPool;
    const conn = await pool.acquire();
    const startTime = Date.now();
    try {
      await conn.run('BEGIN TRANSACTION');
      try {
        for (const sql of statements) {
          await conn.run(sql);
        }
        await conn.run('COMMIT');
      } catch (innerErr) {
        try { await conn.run('ROLLBACK'); } catch { /* rollback 失败不掩盖原错误 */ }
        throw innerErr;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const ctx = getRequestContext();
      const errorId = ctx?.requestId ?? Math.random().toString(36).slice(2, 10);
      console.error(`[DuckDB] [${errorId}] Transaction error (${Date.now() - startTime}ms):`, message);
      throw new AppError(
        process.env.NODE_ENV === 'production' ? 500 : 500,
        process.env.NODE_ENV === 'production' ? `事务执行失败 [${errorId}]` : `事务执行失败: ${message}`,
      );
    } finally {
      pool.release(conn);
    }
  }

  async loadParquet(filePath: string, tableName: string = 'raw_parquet'): Promise<{ versionToken: string }> {
    const safeTableName = sanitizeTableName(tableName);
    await replaceTableFromSelect(
      this,
      safeTableName,
      `SELECT * FROM read_parquet('${escapeSqlValue(filePath)}')`,
    );
    this.invalidateCache();
    // 单文件路径也必须让 dataVersion 前进，否则旧 cache key 会继续命中重建前的结果。
    // B311 延迟提交：这里只计算 token（优先文件指纹，stat 失败退回时间戳兜底），
    // 由编排方在 createPolicyFactView 物化完成后 setDataVersion(versionToken) 提交，
    // 避免版本 bump 同步唤醒监听者预热查询中间态视图。
    const fp = computeParquetFingerprint([filePath]);
    const versionToken = fp !== null ? fp.fingerprint : makeTimestampVersionToken();
    console.log(`[DuckDB] Loaded Parquet file: ${filePath} -> ${safeTableName}`);
    return { versionToken };
  }

  async loadMultipleParquet(filePaths: string[]): Promise<{ totalRows: number; versionToken: string }> { return loadMultipleParquet(this, filePaths); }

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
