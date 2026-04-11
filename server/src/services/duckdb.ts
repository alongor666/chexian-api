/**
 * DuckDB 服务 (@duckdb/node-api) — 瘦主类
 *
 * 核心职责：初始化、连接管理、查询执行、类型转换。
 * 物化逻辑委托 → duckdb-materialization.ts
 * 域数据加载委托 → duckdb-domain-loaders.ts
 * 基础设施 → duckdb-infra.ts（QueryCache + ConnectionPool）
 */

import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import { createHash } from 'crypto';
import { statSync } from 'fs';
import { databaseConfig, DUCKDB_INIT_OPTIONS } from '../config/database.js';
import { getKpiPlanConfigPath } from '../config/paths.js';
import { AppError } from '../middleware/error.js';
import { sanitizeTableName, escapeSqlValue } from '../utils/security.js';
import { recordQueryMetric } from '../utils/request-context.js';
import { QueryCache, ConnectionPool } from './duckdb-infra.js';
import type { DuckDBQueryable } from './duckdb-types.js';
import * as materialization from './duckdb-materialization.js';
import * as domainLoaders from './duckdb-domain-loaders.js';

// ============================================
// Parquet 指纹缓存（按表名存储）
// ============================================

interface ParquetCacheEntry {
  fingerprint: string;
  fileSet: Set<string>;
  fileMtimes: Map<string, number>;
}

interface FingerprintResult {
  fingerprint: string;
  mtimes: Map<string, number>;
}

const parquetFingerprintCache = new Map<string, ParquetCacheEntry>();

/**
 * 计算文件路径列表的指纹：hash(排序后路径 + 各文件 mtime)
 * 同时返回每个文件的 mtimeMs 用于增量路径的精确比对
 * 若任何文件 stat 失败，返回 null（触发全量重建）
 */
function computeParquetFingerprint(filePaths: string[]): FingerprintResult | null {
  try {
    const sorted = [...filePaths].sort();
    const hash = createHash('sha256');
    const mtimes = new Map<string, number>();
    for (const p of sorted) {
      const mtime = statSync(p).mtimeMs;
      mtimes.set(p, mtime);
      hash.update(`${p}:${mtime}\n`);
    }
    return { fingerprint: hash.digest('hex'), mtimes };
  } catch {
    return null;
  }
}

// ============================================
// 慢查询监控阈值（毫秒）
// ============================================
const SLOW_QUERY_THRESHOLD_MS = 3000;

/**
 * DuckDB 服务构造参数
 *
 * 省略的字段从全局 databaseConfig / DUCKDB_INIT_OPTIONS 回退。
 * 测试场景传 `{ path: ':memory:' }` 即可获得隔离实例。
 */
export interface DuckDBServiceConfig {
  /** 数据库路径（默认 databaseConfig.path，测试用 ':memory:'） */
  path?: string;
  /** 最大连接数（默认 databaseConfig.maxConnections） */
  maxConnections?: number;
  /** 内存限制（默认 DUCKDB_INIT_OPTIONS.max_memory） */
  maxMemory?: string;
  /** 线程数（默认 DUCKDB_INIT_OPTIONS.threads） */
  threads?: number;
}

/**
 * DuckDB 服务类
 *
 * 增强功能：
 * - 连接池（复用连接，默认最大 10 个）
 * - 查询结果缓存（可选 TTL）
 * - 慢查询监控（>3s 告警）
 *
 * 使用方式：
 * - 生产：`duckdbService`（预创建单例）
 * - 测试：`createDuckDBService({ path: ':memory:' })`
 */
export class DuckDBService implements DuckDBQueryable {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;
  private connectionPool: ConnectionPool | null = null;
  private queryCache = new QueryCache();

  constructor(private readonly config?: DuckDBServiceConfig) {}

  /**
   * 初始化数据库连接
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const dbPath = this.config?.path ?? databaseConfig.path;
      const maxConn = this.config?.maxConnections ?? databaseConfig.maxConnections ?? 10;
      const maxMem = this.config?.maxMemory ?? DUCKDB_INIT_OPTIONS.max_memory;
      const threads = this.config?.threads ?? DUCKDB_INIT_OPTIONS.threads;

      this.instance = await DuckDBInstance.create(dbPath, {
        max_memory: maxMem,
        threads: String(threads),
      });
      this.connectionPool = new ConnectionPool(this.instance, maxConn);

      // 显式 SET 确保内存/线程配置生效（DuckDBInstance.create options 可能被忽略）
      const conn = await this.connectionPool.acquire();
      try {
        await conn.run(`SET memory_limit='${maxMem}'`);
        await conn.run(`SET threads=${threads}`);
      } finally {
        this.connectionPool.release(conn);
      }

      console.log(
        '[DuckDB] Database initialized:', dbPath,
        `(pool max: ${maxConn},`,
        `max_memory: ${maxMem},`,
        `threads: ${threads})`
      );
      this.isInitialized = true;

      // KPI 计划配置表（用于核心指标中的车驾意达成率，支持多层级扩展）
      await this.query(`
        CREATE TABLE IF NOT EXISTS KpiPlanConfig (
          plan_year INTEGER,
          business_line VARCHAR,
          level VARCHAR,
          level_key VARCHAR,
          plan_premium DOUBLE
        )
      `);

      await this.query(`
        CREATE TABLE IF NOT EXISTS UserAccount (
          id VARCHAR,
          username VARCHAR,
          display_name VARCHAR,
          password_hash VARCHAR,
          role VARCHAR,
          organization VARCHAR,
          allowed_routes VARCHAR,
          default_route VARCHAR,
          allowed_ips VARCHAR,
          special_features VARCHAR,
          active BOOLEAN,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        )
      `);

      // 迁移：已有表可能缺少 special_features 列
      try {
        await this.query(`ALTER TABLE UserAccount ADD COLUMN IF NOT EXISTS special_features VARCHAR`);
      } catch {
        // 列已存在或表刚创建，忽略
      }

      await this.query(`
        CREATE TABLE IF NOT EXISTS RoleConfig (
          role VARCHAR,
          name VARCHAR,
          data_scope VARCHAR,
          allowed_routes VARCHAR,
          default_route VARCHAR,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        )
      `);

      try {
        const fs = (await import('fs')).default;
        const planConfigPath = getKpiPlanConfigPath();
        if (fs.existsSync(planConfigPath)) {
          const raw = fs.readFileSync(planConfigPath, 'utf-8').replace(/\bNaN\b/g, 'null');
          const parsed = JSON.parse(raw);
          const rows: any[] = Array.isArray(parsed) ? parsed : [];
          if (rows.length > 0) {
            await this.query('DELETE FROM KpiPlanConfig');
            const values = rows
              .filter((r) => r && typeof r === 'object')
              .map((r) => {
                const planYear = Number(r.plan_year) || 0;
                const businessLine = String(r.business_line ?? '');
                const level = String(r.level ?? '');
                const levelKey = String(r.level_key ?? '');
                const planPremium = Number(r.plan_premium) || 0;
                return `(${planYear}, '${escapeSqlValue(businessLine)}', '${escapeSqlValue(level)}', '${escapeSqlValue(levelKey)}', ${planPremium})`;
              })
              .join(',\n');
            if (values) {
              await this.query(`INSERT INTO KpiPlanConfig VALUES\n${values}`);
            }
          }
        }
      } catch {
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(500, `Failed to initialize DuckDB: ${message}`);
    }
  }

  // ============================================
  // 连接管理
  // ============================================

  private async getConnection(): Promise<DuckDBConnection> {
    if (!this.connectionPool) {
      throw new AppError(500, 'DuckDB not initialized');
    }
    return await this.connectionPool.acquire();
  }

  private releaseConnection(conn: DuckDBConnection): void {
    if (this.connectionPool) {
      this.connectionPool.release(conn);
    } else {
      try { conn.closeSync(); } catch { /* ignore */ }
    }
  }

  // ============================================
  // 缓存
  // ============================================

  invalidateCache(options?: { silent?: boolean }): void {
    const size = this.queryCache.size;
    this.queryCache.invalidateAll();
    if (size > 0 && !options?.silent) {
      console.log(`[DuckDB] Cache invalidated (${size} entries cleared)`);
    }
  }

  /** @internal 测试用：获取缓存条目数 */
  get cacheSize(): number {
    return this.queryCache.size;
  }

  // ============================================
  // 查询执行
  // ============================================

  /**
   * 执行SQL查询（返回JSON格式）
   *
   * @param sql - SQL 查询
   * @param cacheTtlMs - 可选缓存 TTL（毫秒），0 表示不缓存
   */
  async query<T = any>(sql: string, cacheTtlMs: number = 0): Promise<T[]> {
    // 缓存查找
    if (cacheTtlMs > 0) {
      const cached = this.queryCache.get<T[]>(sql);
      if (cached) {
        recordQueryMetric(sql, 0, true);
        return cached;
      }
    }

    const conn = await this.getConnection();
    const startTime = Date.now();

    try {
      const reader = await conn.runAndReadAll(sql);
      const result = reader.getRowObjects();
      const duration = Date.now() - startTime;

      // 慢查询监控
      if (duration > SLOW_QUERY_THRESHOLD_MS) {
        console.warn(`[DuckDB] ⚠️ Slow query (${duration}ms): ${sql.substring(0, 200)}${sql.length > 200 ? '...' : ''}`);
      }

      // 转换BigInt为Number（避免JSON序列化错误）
      const converted = this.convertBigIntToNumber(result) as T[];

      // 写入缓存
      if (cacheTtlMs > 0) {
        this.queryCache.set(sql, converted, cacheTtlMs);
      }

      recordQueryMetric(sql, duration, false);

      return converted;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      recordQueryMetric(sql, duration, false);
      const errorId = Math.random().toString(36).slice(2, 10);
      console.error(`[DuckDB] [${errorId}] Query error (${duration}ms):`, message);
      console.error(`[DuckDB] [${errorId}] SQL:`, sql.slice(0, 500));
      throw new AppError(400,
        process.env.NODE_ENV === 'production'
          ? `查询执行失败 [${errorId}]`
          : `查询执行失败: ${message}`
      );
    } finally {
      this.releaseConnection(conn);
    }
  }

  /**
   * 转换 DuckDB 特殊类型为 JSON 可序列化的值
   * - BigInt → Number
   * - DuckDB DATE {days: N} → "YYYY-MM-DD" 字符串
   * - DuckDB TIMESTAMP {micros: N} → ISO 字符串
   */
  private convertBigIntToNumber(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'bigint') {
      return Number(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.convertBigIntToNumber(item));
    }

    if (typeof data === 'object') {
      const keys = Object.keys(data);

      // DuckDB DATE type: {days: number} → "YYYY-MM-DD"
      if (keys.length === 1 && keys[0] === 'days' && typeof data.days === 'number') {
        const ms = data.days * 86400000;
        return new Date(ms).toISOString().split('T')[0];
      }

      // DuckDB TIMESTAMP type: {micros: bigint|number} → ISO string
      if (keys.length === 1 && keys[0] === 'micros' && (typeof data.micros === 'bigint' || typeof data.micros === 'number')) {
        const ms = Number(data.micros) / 1000;
        return new Date(ms).toISOString();
      }

      const converted: any = {};
      for (const [key, value] of Object.entries(data)) {
        converted[key] = this.convertBigIntToNumber(value);
      }
      return converted;
    }

    return data;
  }

  // ============================================
  // 表/视图工具方法
  // ============================================

  /**
   * 按真实对象类型清理同名 relation（TABLE / VIEW）。
   */
  async dropRelationIfExists(relationName: string): Promise<void> {
    const safeRelationName = sanitizeTableName(relationName);
    const escapedRelationName = escapeSqlValue(safeRelationName);

    const rows = await this.query<{ table_type: string }>(`
      SELECT table_type
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = '${escapedRelationName}'
      LIMIT 1
    `);

    const tableType = (rows[0]?.table_type || '').toUpperCase();
    if (tableType === 'VIEW') {
      await this.query(`DROP VIEW IF EXISTS ${safeRelationName}`);
      return;
    }

    if (tableType) {
      await this.query(`DROP TABLE IF EXISTS ${safeRelationName}`);
    }
  }

  async hasRelation(relationName: string): Promise<boolean> {
    const safeRelationName = sanitizeTableName(relationName);
    const escapedRelationName = escapeSqlValue(safeRelationName);
    const rows = await this.query<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = '${escapedRelationName}'
    `);
    return (rows[0]?.cnt ?? 0) > 0;
  }

  async getTableSchema(tableName: string): Promise<any[]> {
    const safeTableName = sanitizeTableName(tableName);
    const sql = `DESCRIBE ${safeTableName}`;
    return this.query(sql);
  }

  // ============================================
  // Parquet 加载（核心，保留在主类）
  // ============================================

  async loadParquet(filePath: string, tableName: string = 'raw_parquet'): Promise<void> {
    const safeTableName = sanitizeTableName(tableName);
    const escapedPath = escapeSqlValue(filePath);

    await this.dropRelationIfExists(safeTableName);

    const sql = `
      CREATE OR REPLACE TABLE ${safeTableName} AS
      SELECT * FROM read_parquet('${escapedPath}')
    `;

    await this.query(sql);
    this.invalidateCache();
    console.log(`[DuckDB] Loaded Parquet file: ${filePath} -> ${safeTableName}`);
  }

  async loadMultipleParquet(filePaths: string[]): Promise<{ totalRows: number }> {
    if (filePaths.length === 0) {
      throw new AppError(400, 'No parquet files provided');
    }

    const TABLE_NAME = 'raw_parquet';
    const t0 = Date.now();

    // ── 指纹计算（失败则 fallback 到全量重建）──
    const fpResult = computeParquetFingerprint(filePaths);
    const cached = parquetFingerprintCache.get(TABLE_NAME);

    if (fpResult !== null && cached !== undefined && cached.fingerprint === fpResult.fingerprint) {
      // 缓存命中：文件集合和 mtime 完全一致，验证表存在后复用
      if (await this.hasRelation(TABLE_NAME)) {
        const totalResult = await this.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
        const totalRows = totalResult[0]?.cnt ?? 0;
        console.log(`[DuckDB] loadMultipleParquet cache HIT — skipping rebuild, ${totalRows} rows (${Date.now() - t0}ms)`);
        return { totalRows };
      }
      // 表不存在（内部状态异常），清除缓存 fallthrough 到全量重建
      parquetFingerprintCache.delete(TABLE_NAME);
    }

    // ── 判断是否可增量追加 ──
    const canIncremental =
      fpResult !== null &&
      cached !== undefined &&
      (await this.hasRelation(TABLE_NAME));

    if (canIncremental) {
      const filePathSet = new Set(filePaths);
      const newFiles = filePaths.filter((p) => !cached!.fileSet.has(p));
      const removedFiles = [...cached!.fileSet].filter((p) => !filePathSet.has(p));

      // 检查已有文件是否被修改（mtime 变化）
      const existingModified = [...cached!.fileSet]
        .filter((p) => filePathSet.has(p))
        .some((p) => cached!.fileMtimes.get(p) !== fpResult!.mtimes.get(p));

      if (removedFiles.length === 0 && newFiles.length > 0 && !existingModified) {
        // 仅新增文件且已有文件未变：INSERT INTO 增量加载
        const escapedNew = newFiles.map((p) => `'${escapeSqlValue(p)}'`).join(', ');
        try {
          await this.query(`
            INSERT INTO ${TABLE_NAME}
            SELECT * FROM read_parquet([${escapedNew}], union_by_name=true)
          `);
          this.invalidateCache();
          parquetFingerprintCache.set(TABLE_NAME, {
            fingerprint: fpResult!.fingerprint,
            fileSet: new Set(filePaths),
            fileMtimes: fpResult!.mtimes,
          });
          const totalResult = await this.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
          const totalRows = totalResult[0]?.cnt ?? 0;
          console.log(`[DuckDB] loadMultipleParquet incremental INSERT — +${newFiles.length} file(s), ${totalRows} rows (${Date.now() - t0}ms)`);
          return { totalRows };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[DuckDB] Incremental INSERT failed (${msg}), falling back to full rebuild`);
          // fall through to full rebuild below
        }
      }
    }

    // ── 全量重建（DROP + CREATE）──
    const escapedPaths = filePaths.map((p) => `'${escapeSqlValue(p)}'`).join(', ');

    await this.dropRelationIfExists('raw_parquet');

    try {
      await this.query(`
        CREATE TABLE ${TABLE_NAME} AS
        SELECT * FROM read_parquet([${escapedPaths}], union_by_name=true)
      `);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DuckDB] ⚠️ read_parquet failed: ${msg}`);
      console.error(`[DuckDB] Files: ${filePaths.join(', ')}`);
      parquetFingerprintCache.delete(TABLE_NAME);
      throw new AppError(500, `Parquet loading failed (schema incompatible or file corrupted): ${msg}`);
    }

    this.invalidateCache();

    // 更新指纹缓存（fpResult 为 null 时跳过缓存写入，保持下次仍走全量）
    if (fpResult !== null) {
      parquetFingerprintCache.set(TABLE_NAME, {
        fingerprint: fpResult.fingerprint,
        fileSet: new Set(filePaths),
        fileMtimes: fpResult.mtimes,
      });
    }

    const totalResult = await this.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
    const totalRows = totalResult[0]?.cnt ?? 0;
    const rebuildReason = cached === undefined ? 'cold start' : 'fingerprint changed';
    console.log(`[DuckDB] loadMultipleParquet full rebuild (${rebuildReason}) — ${filePaths.length} file(s), ${totalRows} rows (${Date.now() - t0}ms)`);

    return { totalRows };
  }

  // ============================================
  // 物化引擎代理 → duckdb-materialization.ts
  // ============================================

  async createPolicyFactView(sourceTable: string = 'raw_parquet'): Promise<void> {
    return materialization.createPolicyFactView(this, sourceTable);
  }

  /** @internal */ async materializeInBatches(
    tableName: string,
    cteSql: string,
    aggregateSql: string,
    viewFallbackSql: string,
    indexes: Array<{ name: string; column: string }> = [],
  ): Promise<'table' | 'view'> {
    return materialization.materializeInBatches(this, tableName, cteSql, aggregateSql, viewFallbackSql, indexes);
  }

  async dropAllDerivedTables(): Promise<void> {
    return materialization.dropAllDerivedTables(this);
  }

  async ensureAggregatesReady(): Promise<void> {
    return;
  }

  // ============================================
  // 域数据加载代理 → duckdb-domain-loaders.ts
  // ============================================

  async loadDimParquet(salesmanPath: string, planPath: string): Promise<void> {
    return domainLoaders.loadDimParquet(this, salesmanPath, planPath);
  }

  async loadPlateRegionDim(parquetPath: string): Promise<void> {
    return domainLoaders.loadPlateRegionDim(this, parquetPath);
  }

  async loadTeamMapping(jsonFilePath: string): Promise<void> {
    return domainLoaders.loadTeamMapping(this, jsonFilePath);
  }

  async buildAchievementView(planYear: number = 2026): Promise<void> {
    return domainLoaders.buildAchievementView(this, planYear);
  }

  async loadQuoteConversion(parquetPath: string): Promise<void> {
    return domainLoaders.loadQuoteConversion(this, parquetPath);
  }

  // loadRenewalFunnel removed — replaced by loadRenewalUniverse

  async loadClaimsDetail(parquetPath: string): Promise<void> {
    return domainLoaders.loadClaimsDetail(this, parquetPath);
  }

  async loadClaimsAgg(parquetPath: string): Promise<void> {
    return domainLoaders.loadClaimsAgg(this, parquetPath);
  }

  async createClaimsAggFromDetail(): Promise<void> {
    return domainLoaders.createClaimsAggFromDetail(this);
  }

  async loadCrossSell(parquetPath: string): Promise<void> {
    return domainLoaders.loadCrossSell(this, parquetPath);
  }

  async loadRepairDim(parquetPath: string): Promise<void> {
    return domainLoaders.loadRepairDim(this, parquetPath);
  }

  async loadBrandDim(parquetPath: string): Promise<void> {
    return domainLoaders.loadBrandDim(this, parquetPath);
  }

  async loadCustomerFlow(parquetPath: string): Promise<void> {
    return domainLoaders.loadCustomerFlow(this, parquetPath);
  }

  async loadRenewalUniverse(parquetPath: string): Promise<void> {
    return domainLoaders.loadRenewalUniverse(this, parquetPath);
  }

  // ============================================
  // 生命周期
  // ============================================

  async close(): Promise<void> {
    if (this.connectionPool) {
      await this.connectionPool.closeAll();
      this.connectionPool = null;
    }
    this.queryCache.invalidateAll();
    if (this.instance) {
      this.instance = null;
      this.isInitialized = false;
      console.log('[DuckDB] Database closed');
    }
  }
}

/**
 * 创建 DuckDB 服务实例
 *
 * 生产代码应直接使用下方 `duckdbService` 单例。
 * 此工厂函数供测试和特殊场景使用：
 *
 * ```ts
 * const db = createDuckDBService({ path: ':memory:' });
 * await db.init();
 * // ... run tests ...
 * await db.close();
 * ```
 */
export function createDuckDBService(config?: DuckDBServiceConfig): DuckDBService {
  return new DuckDBService(config);
}

/** 全局单例（生产用） */
export const duckdbService = new DuckDBService();

/** @internal 测试用：派生表名列表 */
export { DERIVED_RELATIONS } from './duckdb-materialization.js';
