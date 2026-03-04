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
import { databaseConfig, DUCKDB_INIT_OPTIONS } from '../config/database.js';
import { getKpiPlanConfigPath } from '../config/paths.js';
import { AppError } from '../middleware/error.js';
import { generateColumnMappingSQL, getColumnMapping } from './column-normalizer.js';
import { sanitizeTableName, escapeSqlValue } from '../utils/security.js';
import { recordQueryMetric } from '../utils/request-context.js';

// ============================================
// 查询缓存
// ============================================

interface CacheEntry<T = any> {
  data: T;
  expiry: number;
}

class QueryCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 500;

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
      this.instance = await DuckDBInstance.create(databaseConfig.path, {
        max_memory: DUCKDB_INIT_OPTIONS.max_memory,
        threads: String(DUCKDB_INIT_OPTIONS.threads),
      });
      this.connectionPool = new ConnectionPool(this.instance, databaseConfig.maxConnections ?? 10);
      console.log(
        '[DuckDB] Database initialized:', databaseConfig.path,
        `(pool max: ${databaseConfig.maxConnections ?? 10},`,
        `max_memory: ${DUCKDB_INIT_OPTIONS.max_memory},`,
        `threads: ${DUCKDB_INIT_OPTIONS.threads})`
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
          active BOOLEAN,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        )
      `);

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
   * 按真实对象类型清理同名 relation（TABLE / VIEW）。
   * DuckDB 的 `DROP VIEW IF EXISTS table_name` 在对象为 TABLE 时仍会报错，
   * 因此需要先查类型，再执行对应 DROP。
   */
  private async dropRelationIfExists(relationName: string): Promise<void> {
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

    // 兼容同名对象类型切换（VIEW ↔ TABLE）
    await this.dropRelationIfExists(safeTableName);

    const sql = `
      CREATE OR REPLACE TABLE ${safeTableName} AS
      SELECT * FROM read_parquet('${escapedPath}')
    `;

    await this.query(sql);
    this.invalidateCache();
    console.log(`[DuckDB] Loaded Parquet file: ${filePath} -> ${safeTableName}`);
  }

  /**
   * 加载多个 Parquet 文件并合并为 raw_parquet 视图
   *
   * 策略：
   * - 单文件时走快速路径（直接 CREATE TABLE，保持原行为）
   * - 多文件时：每个文件加载到独立表，UNION ALL 合并为视图
   * - 兼容 schema 差异：缺失列填 NULL
   */
  async loadMultipleParquet(filePaths: string[]): Promise<{ totalRows: number }> {
    if (filePaths.length === 0) {
      throw new AppError(400, 'No parquet files provided');
    }

    // 单文件快速路径
    if (filePaths.length === 1) {
      await this.loadParquet(filePaths[0], 'raw_parquet');
      const countResult = await this.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
      return { totalRows: countResult[0]?.cnt ?? 0 };
    }

    // 多文件：逐个加载到独立表
    const tableNames: string[] = [];
    const allColumns = new Map<string, string>(); // column_name -> column_type

    for (let i = 0; i < filePaths.length; i++) {
      const tableName = `raw_parquet_${i}`;
      const safeTableName = sanitizeTableName(tableName);
      const escapedPath = escapeSqlValue(filePaths[i]);

      await this.query(`
        CREATE OR REPLACE TABLE ${safeTableName} AS
        SELECT * FROM read_parquet('${escapedPath}')
      `);
      tableNames.push(safeTableName);

      // 收集列信息
      const schema = await this.getTableSchema(safeTableName);
      for (const col of schema) {
        if (!allColumns.has(col.column_name)) {
          allColumns.set(col.column_name, col.column_type);
        }
      }

      const countResult = await this.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${safeTableName}`);
      console.log(`[DuckDB] Loaded parquet[${i}]: ${filePaths[i]} → ${safeTableName} (${countResult[0]?.cnt ?? 0} rows)`);
    }

    // 构建 UNION ALL 视图，缺失列填 NULL
    const allColumnNames = Array.from(allColumns.keys());
    const selectParts = tableNames.map((table) => {
      return this.query<{ column_name: string }>(`SELECT column_name FROM (DESCRIBE ${table})`).then((schema) => {
        const existingCols = new Set(schema.map((c) => c.column_name));
        const cols = allColumnNames.map((col) =>
          existingCols.has(col) ? `"${col}"` : `NULL AS "${col}"`
        );
        return `SELECT ${cols.join(', ')} FROM ${table}`;
      });
    });

    const selects = await Promise.all(selectParts);
    // raw_parquet 在单文件路径下可能是 TABLE，多文件路径需要 VIEW。
    await this.dropRelationIfExists('raw_parquet');

    const unionSQL = `
      CREATE OR REPLACE VIEW raw_parquet AS
      ${selects.join('\n      UNION ALL\n      ')}
    `;
    await this.query(unionSQL);

    this.invalidateCache();

    const totalResult = await this.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM raw_parquet');
    const totalRows = totalResult[0]?.cnt ?? 0;
    console.log(`[DuckDB] Multi-parquet loaded: ${filePaths.length} files, ${totalRows} total rows`);

    return { totalRows };
  }

  /**
   * 创建PolicyFact视图（带列名映射和去重）
   *
   * @param sourceTable 源表名
   *
   * 安全修复：表名验证（防止 SQL 注入）
   */
  async createPolicyFactView(sourceTable: string = 'raw_parquet'): Promise<void> {
    // 全环境统一实时模式：从原始 Parquet 构建标准化 PolicyFact 行级数据。

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

    await this.materializePolicyFactWorkingSet();
    await this.createCrossSellRealtimeView();
    console.log('[DuckDB] Realtime mode enabled: using PolicyFact realtime aggregation (no pre-aggregated tables)');
  }

  /**
   * 将标准化视图物化为行级实时工作表，并建立查询友好索引。
   * 不改变业务口径，仅提升实时查询吞吐与过滤性能。
   */
  private async materializePolicyFactWorkingSet(): Promise<void> {
    await this.query('DROP TABLE IF EXISTS PolicyFactRealtime');
    await this.query(`
      CREATE TABLE PolicyFactRealtime AS
      SELECT * FROM PolicyFactRenewal
    `);

    await Promise.all([
      this.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_policy_date ON PolicyFactRealtime(policy_date)'),
      this.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_start_date ON PolicyFactRealtime(insurance_start_date)'),
      this.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_org ON PolicyFactRealtime(org_level_3)'),
      this.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_salesman ON PolicyFactRealtime(salesman_name)'),
      this.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_customer ON PolicyFactRealtime(customer_category)'),
      this.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_cov ON PolicyFactRealtime(coverage_combination)'),
      this.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_vehicle ON PolicyFactRealtime(insurance_type)'),
    ]);

    await this.query(`
      CREATE OR REPLACE VIEW PolicyFact AS
      SELECT * FROM PolicyFactRealtime
    `);
    await this.query(`
      CREATE OR REPLACE VIEW PolicyFactRenewal AS
      SELECT * FROM PolicyFact
    `);
    console.log('[DuckDB] PolicyFactRealtime materialized with realtime indexes');
  }

  /**
   * 实时聚合模式专用：创建 CrossSellDailyAgg 实时视图（非物化）
   *
   * 说明：
   * - 结构与历史 CrossSellDailyAgg 表保持一致，复用现有 SQL 生成器和路由
   * - 数据来源实时读取 PolicyFact，不依赖预聚合导出文件
  */
  async createCrossSellRealtimeView(): Promise<void> {
    // 兼容历史部署中 CrossSellDailyAgg 可能是 TABLE 的情况
    await this.dropRelationIfExists('CrossSellDailyAgg');

    await this.query(`
      CREATE OR REPLACE VIEW CrossSellDailyAgg AS
      WITH normalized AS (
        SELECT
          CAST(policy_date AS DATE) AS policy_date,
          CAST(insurance_start_date AS DATE) AS insurance_start_date,
          org_level_3,
          salesman_name,
          customer_category,
          coverage_combination,
          renewal_mode,
          tonnage_segment,
          insurance_grade,
          small_truck_score,
          large_truck_score,
          COALESCE(CAST(is_commercial_insure AS VARCHAR), '') AS is_commercial_insure,
          COALESCE(CAST(insurance_type AS VARCHAR), '') AS insurance_type,
          (
            TRY_CAST(is_transfer AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_transfer AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_transfer,
          (
            TRY_CAST(is_telemarketing AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_telemarketing AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_telemarketing,
          (
            TRY_CAST(is_renewal AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_renewal AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_renewal,
          (
            TRY_CAST(is_nev AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_nev AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_nev,
          (
            TRY_CAST(is_new_car AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_new_car AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_new_car,
          (
            TRY_CAST(is_renewable AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_renewable AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_renewable,
          (
            TRY_CAST(is_cross_sell AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_cross_sell AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_cross_sell,
          COALESCE(driver_coverage, 0) AS driver_coverage,
          COALESCE(passenger_coverage, 0) AS passenger_coverage,
          COALESCE(cross_sell_premium_driver, 0) AS cross_sell_premium_driver,
          COALESCE(premium, 0) AS premium,
          COALESCE(
            NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''),
            NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')
          ) AS dedup_key
        FROM PolicyFact
        WHERE policy_date IS NOT NULL
      )
      SELECT
        policy_date,
        insurance_start_date,
        org_level_3,
        salesman_name,
        customer_category,
        coverage_combination,
        renewal_mode,
        tonnage_segment,
        insurance_grade,
        small_truck_score,
        large_truck_score,
        is_commercial_insure,
        is_transfer,
        is_telemarketing,
        is_renewal,
        is_nev,
        is_new_car,
        is_renewable,
        is_cross_sell,
        driver_coverage,
        passenger_coverage,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(DISTINCT CASE WHEN is_cross_sell THEN dedup_key END) AS driver_count,
        COALESCE(SUM(CASE WHEN is_cross_sell THEN cross_sell_premium_driver ELSE 0 END), 0) AS driver_premium,
        COALESCE(SUM(premium), 0) AS auto_premium
      FROM normalized
      WHERE dedup_key IS NOT NULL
      GROUP BY
        policy_date,
        insurance_start_date,
        org_level_3,
        salesman_name,
        customer_category,
        coverage_combination,
        renewal_mode,
        tonnage_segment,
        insurance_grade,
        small_truck_score,
        large_truck_score,
        is_commercial_insure,
        is_transfer,
        is_telemarketing,
        is_renewal,
        is_nev,
        is_new_car,
        is_renewable,
        is_cross_sell,
        driver_coverage,
        passenger_coverage
    `);
  }

  /**
   * 兼容历史调用点。系统已固定实时聚合，不再存在预聚合自愈流程。
   */
  async ensureAggregatesReady(): Promise<void> {
    return;
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

    // 预构建达成分析缓存表（数据加载完成后立即计算，后续查询直接读缓存）
    await this.buildAchievementView(2026);
  }

  /**
   * 预构建保费达成分析缓存表 achievement_cache（业务员粒度）
   *
   * 规则（用户确认）：
   * - JOIN 键：full_name（含工号前缀，如 "106014762刘刚"）
   * - 时间进度：自然日历天数 / 365（使用最新签单日期）
   * - 上年同期：精确日期匹配（max_date - INTERVAL 1 YEAR）
   * - 无计划业务员：出现（mapping 中 plan=0 的 + mapping 外有保单的均出现）
   *
   * 调用时机：loadTeamMapping() 完成后自动调用
   * 上游视图：SalesmanTeamMapping（含归属）+ PolicyFact（实际保费）
   * 下游：server/src/sql/premiumPlan.ts 所有查询从本表读取
   */
  async buildAchievementView(planYear: number = 2026): Promise<void> {
    const prevYear = planYear - 1;

    await this.query(`
      CREATE OR REPLACE TABLE achievement_cache AS
      WITH
      -- 1. 时间进度：当年最新签单日到 1月1日 的自然天数 / 365
      time_prog AS (
        SELECT
          GREATEST(
            CAST(DATEDIFF('day', DATE '${planYear}-01-01', LEAST(CAST(CURRENT_DATE AS DATE), DATE '${planYear}-12-31')) + 1 AS DOUBLE) / 
            CAST(DATEDIFF('day', DATE '${planYear}-01-01', DATE '${planYear}-12-31') + 1 AS DOUBLE),
            1.0 / 365.0
          ) AS progress,
          MAX(policy_date) AS max_date
        FROM PolicyFact
        WHERE policy_date >= DATE '${planYear}-01-01'
      ),
      -- 2. 今年 YTD 实际（JOIN 键：PolicyFact.salesman_name = SalesmanTeamMapping.full_name）
      ytd_actual AS (
        SELECT salesman_name, SUM(premium) / 10000 AS actual_vehicle
        FROM PolicyFact
        WHERE policy_date >= DATE '${planYear}-01-01'
        GROUP BY salesman_name
      ),
      -- 3. 上年同期（精确日期：去年 1月1日 到 max_date-1年）
      prev_ytd AS (
        SELECT salesman_name, SUM(premium) / 10000 AS prev_actual
        FROM PolicyFact
        WHERE policy_date >= DATE '${prevYear}-01-01'
          AND policy_date <= (SELECT max_date - INTERVAL 1 YEAR FROM time_prog)
        GROUP BY salesman_name
      ),
      -- 4. 上年全年（用于计划增长率：今年计划 / 上年全年 - 1）
      prev_full AS (
        SELECT salesman_name, SUM(premium) / 10000 AS prev_full_year
        FROM PolicyFact
        WHERE policy_date BETWEEN DATE '${prevYear}-01-01' AND DATE '${prevYear}-12-31'
        GROUP BY salesman_name
      )

      -- Part A：SalesmanTeamMapping 中所有业务员（含 plan=0 的无计划人员）
      SELECT
        m.full_name                                                AS full_name,
        m.salesman_name                                            AS salesman_name_short,
        m.team_name,
        m.organization                                             AS org_name,
        ${planYear}                                                AS plan_year,
        COALESCE(m.car_insurance_plan_2026, 0)                     AS plan_vehicle,
        COALESCE(a.actual_vehicle, 0)                              AS actual_vehicle,
        COALESCE(pv.prev_actual, 0)                                AS prev_year_actual,
        COALESCE(pf.prev_full_year, 0)                             AS prev_year_full,
        tp.progress                                                AS time_progress,
        CASE
          WHEN COALESCE(m.car_insurance_plan_2026, 0) > 0 AND tp.progress > 0
          THEN ROUND((COALESCE(a.actual_vehicle, 0) / (m.car_insurance_plan_2026 * tp.progress)) * 100.0, 2)
          ELSE NULL
        END AS achievement_rate,
        CASE
          WHEN COALESCE(pv.prev_actual, 0) > 0
          THEN ROUND(((COALESCE(a.actual_vehicle, 0) - pv.prev_actual) / pv.prev_actual) * 100.0, 2)
          ELSE NULL
        END AS yoy_rate,
        CASE
          WHEN COALESCE(pf.prev_full_year, 0) > 0
          THEN ROUND((COALESCE(m.car_insurance_plan_2026, 0) / pf.prev_full_year - 1) * 100.0, 2)
          ELSE NULL
        END AS plan_growth_rate
      FROM SalesmanTeamMapping m
      LEFT JOIN ytd_actual  a  ON m.full_name = a.salesman_name
      LEFT JOIN prev_ytd    pv ON m.full_name = pv.salesman_name
      LEFT JOIN prev_full   pf ON m.full_name = pf.salesman_name
      CROSS JOIN time_prog  tp

      UNION ALL

      -- Part B：有保单但不在 mapping 中的业务员（无归属、无计划，但必须出现）
      SELECT
        a.salesman_name                                            AS full_name,
        a.salesman_name                                            AS salesman_name_short,
        '未归属团队'                                               AS team_name,
        '未归属机构'                                               AS org_name,
        ${planYear}                                                AS plan_year,
        0.0                                                        AS plan_vehicle,
        COALESCE(a.actual_vehicle, 0)                              AS actual_vehicle,
        COALESCE(pv.prev_actual, 0)                                AS prev_year_actual,
        COALESCE(pf.prev_full_year, 0)                             AS prev_year_full,
        tp.progress                                                AS time_progress,
        NULL                                                       AS achievement_rate,
        CASE
          WHEN COALESCE(pv.prev_actual, 0) > 0
          THEN ROUND(((COALESCE(a.actual_vehicle, 0) - pv.prev_actual) / pv.prev_actual) * 100.0, 2)
          ELSE NULL
        END AS yoy_rate,
        NULL                                                       AS plan_growth_rate
      FROM ytd_actual a
      LEFT JOIN prev_ytd  pv ON a.salesman_name = pv.salesman_name
      LEFT JOIN prev_full pf ON a.salesman_name = pf.salesman_name
      CROSS JOIN time_prog tp
      WHERE a.salesman_name NOT IN (SELECT full_name FROM SalesmanTeamMapping)
    `);

    const countResult = await this.query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM achievement_cache'
    );
    console.log(`[DuckDB] achievement_cache built: ${countResult[0]?.cnt ?? 0} salespeople, year=${planYear}`);
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
