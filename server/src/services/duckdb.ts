/**
 * DuckDB 服务 (@duckdb/node-api)
 *
 * 从 legacy duckdb 包迁移到 @duckdb/node-api (Neo)：
 * - NAPI 预编译二进制，不依赖 Node.js 版本（18/20/22/25+ 均可）
 * - Promise 原生支持，无需回调包装
 * - 已移除 queryArrow（死代码）和 apache-arrow 依赖
 */

import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import { databaseConfig } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { generateColumnMappingSQL, getColumnMapping } from './column-normalizer.js';
import { sanitizeTableName, escapeSqlValue } from '../utils/security.js';

// ============================================
// 查询缓存
// ============================================

interface CacheEntry<T = any> {
  data: T;
  expiry: number;
}

class QueryCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 100;

  get<T = any>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set(key: string, data: any, ttlMs: number): void {
    // 超过最大缓存条目数时清理最旧的
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expiry: Date.now() + ttlMs });
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ============================================
// 连接池
// ============================================

class ConnectionPool {
  private pool: DuckDBConnection[] = [];
  private activeCount = 0;
  private maxSize: number;
  private waitQueue: Array<(conn: DuckDBConnection) => void> = [];
  private instance: DuckDBInstance;

  constructor(instance: DuckDBInstance, maxSize: number = 10) {
    this.instance = instance;
    this.maxSize = maxSize;
  }

  async acquire(): Promise<DuckDBConnection> {
    // 优先从池中取
    if (this.pool.length > 0) {
      this.activeCount++;
      return this.pool.pop()!;
    }
    // 未达上限则新建
    if (this.activeCount < this.maxSize) {
      this.activeCount++;
      return await this.instance.connect();
    }
    // 达上限，排队等待
    return new Promise<DuckDBConnection>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(conn: DuckDBConnection): void {
    if (this.waitQueue.length > 0) {
      // 直接交给等待者
      const resolve = this.waitQueue.shift()!;
      resolve(conn);
    } else {
      // 归还到池中
      this.activeCount--;
      this.pool.push(conn);
    }
  }

  async closeAll(): Promise<void> {
    for (const conn of this.pool) {
      try { conn.closeSync(); } catch { /* ignore */ }
    }
    this.pool = [];
    this.activeCount = 0;
  }
}

// ============================================
// 慢查询监控阈值（毫秒）
// ============================================
const SLOW_QUERY_THRESHOLD_MS = 3000;

/**
 * DuckDB服务类（单例）
 *
 * 增强功能：
 * - 连接池（复用连接，默认最大 10 个）
 * - 查询结果缓存（可选 TTL）
 * - 慢查询监控（>3s 告警）
 */
class DuckDBService {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;
  private connectionPool: ConnectionPool | null = null;
  private queryCache = new QueryCache();

  /**
   * 初始化数据库连接
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.instance = await DuckDBInstance.create(databaseConfig.path);
      this.connectionPool = new ConnectionPool(this.instance, databaseConfig.maxConnections ?? 10);
      console.log('[DuckDB] Database initialized:', databaseConfig.path, `(pool max: ${databaseConfig.maxConnections ?? 10})`);
      this.isInitialized = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(500, `Failed to initialize DuckDB: ${message}`);
    }
  }

  /**
   * 获取数据库连接（从连接池获取）
   */
  private async getConnection(): Promise<DuckDBConnection> {
    if (!this.connectionPool) {
      throw new AppError(500, 'DuckDB not initialized');
    }

    return await this.connectionPool.acquire();
  }

  /**
   * 归还连接到连接池
   */
  private releaseConnection(conn: DuckDBConnection): void {
    if (this.connectionPool) {
      this.connectionPool.release(conn);
    } else {
      try { conn.closeSync(); } catch { /* ignore */ }
    }
  }

  /**
   * 使缓存失效（数据文件变更时调用）
   */
  invalidateCache(): void {
    const size = this.queryCache.size;
    this.queryCache.invalidateAll();
    if (size > 0) {
      console.log(`[DuckDB] Cache invalidated (${size} entries cleared)`);
    }
  }

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

      return converted;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      console.error(`[DuckDB] Query error (${duration}ms):`, message);
      throw new AppError(400, `Query failed: ${message}`);
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

  /**
   * 加载Parquet文件
   *
   * 安全修复：
   * 1. 表名验证（防止 SQL 注入）
   * 2. 文件路径转义（防止单引号注入）
   */
  async loadParquet(filePath: string, tableName: string = 'raw_parquet'): Promise<void> {
    // 1. 验证表名（防止 SQL 注入）
    const safeTableName = sanitizeTableName(tableName);

    // 2. 转义文件路径中的单引号
    const escapedPath = escapeSqlValue(filePath);

    const sql = `
      CREATE OR REPLACE TABLE ${safeTableName} AS
      SELECT * FROM read_parquet('${escapedPath}')
    `;

    await this.query(sql);
    this.invalidateCache();
    console.log(`[DuckDB] Loaded Parquet file: ${filePath} -> ${safeTableName}`);
  }

  /**
   * 创建PolicyFact视图（带列名映射和去重）
   *
   * @param sourceTable 源表名
   *
   * 安全修复：表名验证（防止 SQL 注入）
   */
  async createPolicyFactView(sourceTable: string = 'raw_parquet'): Promise<void> {
    // 1. 验证表名（防止 SQL 注入）
    const safeSourceTable = sanitizeTableName(sourceTable);

    // 获取表结构
    const schema = await this.getTableSchema(safeSourceTable);
    const actualColumns = schema.map((col: any) => col.column_name);

    console.log('[DuckDB] Actual columns:', actualColumns.slice(0, 5).join(', '), '...');

    // 检查是否需要列名映射（如果第一列是中文）
    const needsMapping = /[\u4e00-\u9fa5]/.test(actualColumns[0] || '');

    if (needsMapping) {
      console.log('[DuckDB] Chinese column names detected, creating normalized view...');

      // 获取列名映射
      const mapping = getColumnMapping(actualColumns);
      console.log('[DuckDB] Column mapping created:', Object.keys(mapping).length, 'fields');

      // 生成列名映射SQL（使用验证后的表名）
      const mappingSQL = generateColumnMappingSQL(safeSourceTable, actualColumns);
      await this.query(mappingSQL);

      console.log('[DuckDB] PolicyFact view created with column mapping');
    } else {
      // 英文列名，直接创建视图（使用验证后的表名）
      const sql = `
        CREATE OR REPLACE VIEW PolicyFact AS
        SELECT * FROM ${safeSourceTable}
      `;
      await this.query(sql);
      console.log('[DuckDB] PolicyFact view created (pass-through mode)');
    }

    // 创建 PolicyFactRenewal 视图（续保下钻模块使用）
    // 与 PolicyFact 结构相同，WHERE 条件由 renewal-drilldown.ts 动态生成
    await this.query(`
      CREATE OR REPLACE VIEW PolicyFactRenewal AS
      SELECT * FROM PolicyFact
    `);
    console.log('[DuckDB] PolicyFactRenewal view created');
  }

  /**
   * 获取表结构
   *
   * 安全修复：表名验证
   */
  async getTableSchema(tableName: string): Promise<any[]> {
    const safeTableName = sanitizeTableName(tableName);
    const sql = `DESCRIBE ${safeTableName}`;
    return this.query(sql);
  }

  /**
   * 加载团队映射 JSON 到 SalesmanTeamMapping 表
   *
   * 数据源：数据管理/warehouse/dim/业务员归属与规划/salesman_organization_mapping.json
   * 字段：business_no, salesman_name, full_name, team_name, organization, car_insurance_plan_2026
   * JOIN 键：full_name = PolicyFact.salesman_name（含工号前缀）
   */
  async loadTeamMapping(jsonFilePath: string): Promise<void> {
    const fs = (await import('fs')).default;

    let data: any;
    try {
      // JSON 中可能有 NaN（Python 生成），替换为 null 后解析
      const raw = fs.readFileSync(jsonFilePath, 'utf-8').replace(/\bNaN\b/g, 'null');
      data = JSON.parse(raw);
    } catch (err: any) {
      console.warn(`[DuckDB] Failed to read team mapping: ${err.message}`);
      return;
    }

    const rows: any[] = data.salesman_mapping || [];
    if (rows.length === 0) {
      console.warn('[DuckDB] No team mapping data found');
      return;
    }

    // 创建表
    await this.query(`
      CREATE OR REPLACE TABLE SalesmanTeamMapping (
        business_no VARCHAR,
        salesman_name VARCHAR,
        full_name VARCHAR,
        team_name VARCHAR,
        organization VARCHAR,
        car_insurance_plan_2026 DOUBLE
      )
    `);

    // 批量 INSERT（单条 SQL，234 行足够安全）
    const values = rows.map(r => {
      const esc = (s: any) => String(s ?? '').replace(/'/g, "''");
      return `('${esc(r.business_no)}', '${esc(r.salesman_name)}', '${esc(r.full_name)}', '${esc(r.team)}', '${esc(r.organization)}', ${Number(r.car_insurance_plan_2026) || 0})`;
    }).join(',\n      ');

    await this.query(`INSERT INTO SalesmanTeamMapping VALUES\n      ${values}`);

    // 创建 SalesmanPlanFact 视图（供 premiumPlan.ts / renewal-drilldown.ts 使用）
    await this.query(`
      CREATE OR REPLACE VIEW SalesmanPlanFact AS
      SELECT
        full_name AS salesman_name,
        team_name,
        organization AS org_name,
        2026 AS plan_year,
        car_insurance_plan_2026 AS plan_vehicle,
        car_insurance_plan_2026 AS plan_total
      FROM SalesmanTeamMapping
    `);

    console.log(`[DuckDB] Team mapping loaded: ${rows.length} records, from ${jsonFilePath}`);
    console.log(`[DuckDB] SalesmanPlanFact view created`);
  }

  /**
   * 关闭数据库连接
   */
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

// 导出单例实例
export const duckdbService = new DuckDBService();
