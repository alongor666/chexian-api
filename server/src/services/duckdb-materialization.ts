/**
 * DuckDB 物化引擎 — 分批物化 + PolicyFact 构建 + CrossSell 聚合
 *
 * 从 duckdb.ts 拆出的物化相关逻辑。所有函数接收 DuckDBQueryable 接口，不依赖具体类。
 */

import type { DuckDBQueryable } from './duckdb-types.js';
import { DUCKDB_INIT_OPTIONS } from '../config/database.js';
import { generateColumnMappingSQL, getColumnMapping, BOOLEAN_FIELDS } from './column-normalizer.js';
import { sanitizeTableName } from '../utils/security.js';

// ============================================
// 派生表注册表（集中管理清理）
// ============================================

/** 所有启动时创建的派生 TABLE/VIEW，卸载数据时统一清理 */
export const DERIVED_RELATIONS = [
  'ClaimsDetail',
  'ClaimsAgg',
  'CrossSellFact',
  'CrossSellDailyAgg',
  'PolicyFact',
  'PolicyFactRealtime',
  'RepairDim',
  'BrandDim',
  'CustomerFlow',
  'RenewalTrackerFact',
] as const;

/**
 * 清理所有派生表/视图 + raw_parquet 系列表。
 * data.ts 卸载数据时调用。
 */
export async function dropAllDerivedTables(db: DuckDBQueryable): Promise<void> {
  for (const name of DERIVED_RELATIONS) {
    await db.dropRelationIfExists(name);
  }
  const rawTables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name LIKE 'raw_parquet%' AND table_schema = 'main'`
  );
  for (const { table_name } of rawTables) {
    await db.dropRelationIfExists(table_name);
  }
}

// ============================================
// 通用分批物化引擎
// ============================================

/**
 * 分批物化查询为 TABLE，降低峰值内存。
 *
 * 流程：
 * 1. 查询源表的年月范围
 * 2. 第一个月 CREATE TABLE AS ... WHERE month = ?
 * 3. 后续月份 INSERT INTO ... WHERE month = ?
 * 4. 创建索引
 *
 * 失败时自动回退到 VIEW（降级模式：慢但不挂）。
 */
export async function materializeInBatches(
  db: DuckDBQueryable,
  tableName: string,
  cteSql: string,
  aggregateSql: string,
  viewFallbackSql: string,
  indexes: Array<{ name: string; column: string }> = [],
  options: { batchDateExpression?: string } = {},
): Promise<'table' | 'view'> {
  await db.dropRelationIfExists(tableName);

  const t0 = Date.now();
  const batchDateExpression = options.batchDateExpression ?? 'policy_date';
  // VPS（threads<=2）：逐月分批降低峰值内存；本地（threads>2）：直接物化更快
  const useBatching = DUCKDB_INIT_OPTIONS.threads <= 2;
  console.log(`[DuckDB] Materializing ${tableName} (${useBatching ? 'batched by month' : 'direct'})...`);

  try {
    if (!useBatching) {
      // 本地开发：直接 CREATE TABLE，跳过分批
      await db.query(`
        CREATE TABLE ${tableName} AS
        WITH normalized AS (${cteSql}) ${aggregateSql}
      `);
    } else {
      // VPS：逐月分批降低峰值内存（不修改全局 threads/preserve_insertion_order，
      // 因为它们是 DuckDB GLOBAL scope 设置，会影响所有并发查询连接）
      const monthsResult = await db.query<{ ym: string }>(`
        SELECT DISTINCT strftime(CAST(policy_date AS DATE), '%Y-%m') AS ym
        FROM PolicyFact WHERE policy_date IS NOT NULL ORDER BY ym
      `);
      const months = monthsResult.map((r) => r.ym);

      if (months.length === 0) {
        await db.query(`
          CREATE TABLE ${tableName} AS
          WITH normalized AS (${cteSql}) ${aggregateSql}
        `);
      } else {
        await db.query(`
          CREATE TABLE ${tableName} AS
          WITH normalized AS (${cteSql}
            AND strftime(CAST(${batchDateExpression} AS DATE), '%Y-%m') = '${months[0]}'
          ) ${aggregateSql}
        `);
        console.log(`[DuckDB] ${tableName} batch 1/${months.length}: ${months[0]}`);

        for (let i = 1; i < months.length; i++) {
          await db.query(`
            INSERT INTO ${tableName}
            WITH normalized AS (${cteSql}
              AND strftime(CAST(${batchDateExpression} AS DATE), '%Y-%m') = '${months[i]}'
            ) ${aggregateSql}
          `);
          console.log(`[DuckDB] ${tableName} batch ${i + 1}/${months.length}: ${months[i]}`);
        }
      }
    }

    // 创建索引
    if (indexes.length > 0) {
      await Promise.all(
        indexes.map(({ name, column }) =>
          db.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${tableName}(${column})`)
        )
      );
    }

    console.log(`[DuckDB] ${tableName} materialized as TABLE in ${Date.now() - t0}ms`);
    return 'table';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[DuckDB] ⚠️ ${tableName} materialization failed (${Date.now() - t0}ms): ${msg}`);
    console.warn(`[DuckDB] Falling back to VIEW for ${tableName} — queries will be slower`);

    // 清理失败的半成品表
    await db.dropRelationIfExists(tableName);

    // 创建回退 VIEW
    await db.query(viewFallbackSql);
    console.warn(`[DuckDB] ${tableName} running as VIEW (degraded mode)`);
    return 'view';
  }
}

// ============================================
// PolicyFact 物化工作集
// ============================================

/**
 * 将标准化视图物化为行级实时工作表，并建立查询友好索引。
 * 不改变业务口径，仅提升实时查询吞吐与过滤性能。
 */
export async function materializePolicyFactWorkingSet(db: DuckDBQueryable): Promise<void> {
  await db.query('DROP TABLE IF EXISTS PolicyFactRealtime');
  console.log('[DuckDB] Materializing PolicyFactRealtime...');
  const t0 = Date.now();

  // 检测源表中实际存在的布尔字段（union_by_name 可能填 NULL 给缺失列）
  const schema = await db.getTableSchema('PolicyFact');
  const existingCols = new Set(schema.map((c: any) => c.column_name));
  const boolFieldsInSchema = BOOLEAN_FIELDS.filter((f) => existingCols.has(f));

  // 布尔标准化：SELECT * REPLACE 将 VARCHAR/'是'/'1'/'true' 统一为 BOOLEAN
  const replaceClauses = boolFieldsInSchema.map((field) =>
    `(CASE WHEN LOWER(TRIM(CAST("${field}" AS VARCHAR))) IN ('是', '1', 'true', 't', 'y', 'yes', '有', '有驾意险交叉销售') THEN true ELSE false END) AS "${field}"`
  );

  const selectExpr = replaceClauses.length > 0
    ? `SELECT * REPLACE (${replaceClauses.join(', ')})`
    : 'SELECT *';

  // ORDER BY policy_date 让 DuckDB 写入时生成有序 zonemap，date-range 过滤可跳过整块 row group
  // 这是分析型查询的关键优化：B-tree 索引对范围扫描作用有限，zonemap 才是 DuckDB 列式剪枝的主力
  await db.query(`
    CREATE TABLE PolicyFactRealtime AS
    ${selectExpr} FROM PolicyFact
    ORDER BY CAST(policy_date AS DATE) NULLS LAST
  `);
  console.log(`[DuckDB] PolicyFactRealtime created in ${Date.now() - t0}ms (${boolFieldsInSchema.length} boolean fields standardized, ordered by policy_date for zonemap pruning)`);

  // 重建视图指向物化表，然后释放原始 raw_parquet 表以回收内存
  await db.query(`
    CREATE OR REPLACE VIEW PolicyFact AS
    SELECT * FROM PolicyFactRealtime
  `);

  // 释放原始表 — 此时所有视图已指向 PolicyFactRealtime，raw_parquet 无引用
  const rawTables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name LIKE 'raw_parquet%' AND table_schema = 'main'`
  );
  for (const { table_name } of rawTables) {
    await db.dropRelationIfExists(table_name);
  }
  if (rawTables.length > 0) {
    console.log(`[DuckDB] Dropped ${rawTables.length} raw_parquet table(s) to free memory`);
  }

  // 创建高频查询索引（4 个：3 个过滤 + 1 个 JOIN）
  const t1 = Date.now();
  await Promise.all([
    db.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_policy_date ON PolicyFactRealtime(policy_date)'),
    db.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_org ON PolicyFactRealtime(org_level_3)'),
    db.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_salesman ON PolicyFactRealtime(salesman_name)'),
    db.query('CREATE INDEX IF NOT EXISTS idx_policy_fact_policy_no ON PolicyFactRealtime(policy_no)'),
  ]);
  console.log(`[DuckDB] 4 indexes created in ${Date.now() - t1}ms`);
  console.log('[DuckDB] PolicyFactRealtime materialized with realtime indexes');
}

// ============================================
// CrossSellDailyAgg 物化
// ============================================

/**
 * 物化 CrossSellDailyAgg 预聚合表（分批 + 自动回退 VIEW）
 *
 * 成功时：TABLE + 索引，查询走预聚合数据
 * 失败时：VIEW 回退，查询实时聚合（慢但可用）
 */
export async function createCrossSellRealtimeView(db: DuckDBQueryable): Promise<void> {
  // 检测是否有独立 CrossSellFact（8域模式），否则回退到旧 PolicyFact 模式
  const hasCrossSellFact = await db.hasRelation('CrossSellFact');

  if (hasCrossSellFact) {
    // ── 8域模式：PolicyFact 做分母 + LEFT JOIN 精简 CrossSellFact（仅 is_cross_sell=true）做分子 ──
    console.log('[DuckDB] Building CrossSellDailyAgg from PolicyFact + slim CrossSellFact...');

    // 检测 PolicyFact 实际存在的列（新数据源可能缺少 renewal_mode/driver_coverage 等）
    const pfSchema = await db.getTableSchema('PolicyFact');
    const pfCols = new Set(pfSchema.map((c: any) => c.column_name));
    const colStr = (name: string) => pfCols.has(name) ? `COALESCE(CAST(p.${name} AS VARCHAR), '')` : `''`;
    const colBool = (name: string) => pfCols.has(name) ? `COALESCE(p.${name}, false)` : `false`;
    const colNum = (name: string) => pfCols.has(name) ? `COALESCE(p.${name}, 0)` : `0`;

    const cteSql = `
        SELECT
          CAST(p.policy_date AS DATE) AS policy_date,
          COALESCE(CAST(p.insurance_start_date AS DATE), CAST(p.policy_date AS DATE)) AS insurance_start_date,
          p.org_level_3, p.salesman_name, p.customer_category, p.coverage_combination,
          ${colStr('renewal_mode')} AS renewal_mode,
          ${colStr('tonnage_segment')} AS tonnage_segment,
          ${colStr('insurance_grade')} AS insurance_grade,
          ${colStr('is_commercial_insure')} AS is_commercial_insure,
          ${colStr('insurance_type')} AS insurance_type,
          ${colBool('is_transfer')} AS is_transfer,
          ${colBool('is_telemarketing')} AS is_telemarketing,
          ${colBool('is_renewal')} AS is_renewal,
          ${colBool('is_nev')} AS is_nev,
          ${colBool('is_new_car')} AS is_new_car,
          ${colBool('is_renewable')} AS is_renewable,
          COALESCE(cs.is_cross_sell, false) AS is_cross_sell,
          ${colNum('driver_coverage')} AS driver_coverage,
          ${colNum('passenger_coverage')} AS passenger_coverage,
          COALESCE(cs.cross_sell_premium_driver, 0) AS cross_sell_premium_driver,
          ${colNum('premium')} AS premium,
          COALESCE(
            NULLIF(TRIM(CAST(p.vehicle_frame_no AS VARCHAR)), ''),
            NULLIF(TRIM(CAST(p.policy_no AS VARCHAR)), '')) AS dedup_key,
          NULLIF(TRIM(CAST(p.policy_no AS VARCHAR)), '') AS raw_policy_no
        FROM PolicyFact p
        LEFT JOIN CrossSellFact cs ON p.policy_no = cs.policy_no
        WHERE p.policy_date IS NOT NULL`;

    // ⚠️ groupByColumns 增删筛选维度列（insurance_type/fuel_type/tonnage_segment/
    // vehicle_model 等）时，必须同步 filter-dimension-capability.ts 能力矩阵（前后端两份）
    // 与 cross-sell 路由的 sanitizeAggQuery 剥离清单——否则前端会放出 Binder Error chip
    const groupByColumns = `policy_date, insurance_start_date, org_level_3, salesman_name,
        customer_category, coverage_combination, renewal_mode, tonnage_segment,
        insurance_grade, is_commercial_insure,
        is_transfer, is_telemarketing, is_renewal, is_nev, is_new_car,
        is_renewable, is_cross_sell, driver_coverage, passenger_coverage`;

    const aggregateSql = `
      SELECT ${groupByColumns},
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(DISTINCT CASE WHEN is_cross_sell THEN dedup_key END) AS driver_count,
        COUNT(DISTINCT CASE WHEN is_cross_sell THEN raw_policy_no END) AS driver_policy_count,
        COALESCE(SUM(CASE WHEN is_cross_sell THEN cross_sell_premium_driver ELSE 0 END), 0) AS driver_premium,
        COALESCE(SUM(CASE WHEN insurance_type IN ('商业险', '商业保险', '商车统保', '商业险+交强险') THEN premium ELSE 0 END), 0) AS commercial_premium,
        COALESCE(SUM(CASE WHEN insurance_type = '交强险' THEN premium ELSE 0 END), 0) AS compulsory_premium,
        COALESCE(SUM(premium), 0) AS auto_premium
      FROM normalized WHERE dedup_key IS NOT NULL
      GROUP BY ${groupByColumns}`;

    const viewFallbackSql = `
      CREATE OR REPLACE VIEW CrossSellDailyAgg AS
      WITH normalized AS (${cteSql})
      ${aggregateSql}`;

    await materializeInBatches(
      db,
      'CrossSellDailyAgg',
      cteSql,
      aggregateSql,
      viewFallbackSql,
      [
        { name: 'idx_cross_sell_agg_date', column: 'policy_date' },
        { name: 'idx_cross_sell_agg_category', column: 'customer_category' },
      ],
      { batchDateExpression: 'p.policy_date' },
    );
  } else {
    // ── 旧模式：从 PolicyFact 全扫描构建（向后兼容）──
    console.log('[DuckDB] Building CrossSellDailyAgg from PolicyFact (legacy mode)...');

    // 检测 PolicyFact 实际列（8域后部分字段已移出）
    const legacySchema = await db.getTableSchema('PolicyFact');
    const legacyCols = new Set(legacySchema.map((c: any) => c.column_name));
    const lColStr = (name: string) => legacyCols.has(name) ? `COALESCE(CAST(${name} AS VARCHAR), '')` : `''`;
    const lColBool = (name: string) => legacyCols.has(name) ? `COALESCE(${name}, false)` : `false`;
    const lColNum = (name: string) => legacyCols.has(name) ? `COALESCE(${name}, 0)` : `0`;

    const cteSql = `
        SELECT
          CAST(policy_date AS DATE) AS policy_date,
          CAST(insurance_start_date AS DATE) AS insurance_start_date,
          org_level_3, salesman_name, customer_category, coverage_combination,
          ${lColStr('renewal_mode')} AS renewal_mode,
          ${lColStr('tonnage_segment')} AS tonnage_segment,
          ${lColStr('insurance_grade')} AS insurance_grade,
          ${lColStr('is_commercial_insure')} AS is_commercial_insure,
          ${lColStr('insurance_type')} AS insurance_type,
          ${lColBool('is_transfer')} AS is_transfer,
          ${lColBool('is_telemarketing')} AS is_telemarketing,
          ${lColBool('is_renewal')} AS is_renewal,
          ${lColBool('is_nev')} AS is_nev,
          ${lColBool('is_new_car')} AS is_new_car,
          ${lColBool('is_renewable')} AS is_renewable,
          ${lColBool('is_cross_sell')} AS is_cross_sell,
          ${lColNum('driver_coverage')} AS driver_coverage,
          ${lColNum('passenger_coverage')} AS passenger_coverage,
          ${lColNum('cross_sell_premium_driver')} AS cross_sell_premium_driver,
          ${lColNum('premium')} AS premium,
          COALESCE(
            NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''),
            NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')) AS dedup_key,
          NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '') AS raw_policy_no
        FROM PolicyFact
        WHERE policy_date IS NOT NULL`;

    const groupByColumns = `policy_date, insurance_start_date, org_level_3, salesman_name,
        customer_category, coverage_combination, renewal_mode, tonnage_segment,
        insurance_grade, is_commercial_insure,
        is_transfer, is_telemarketing, is_renewal, is_nev, is_new_car,
        is_renewable, is_cross_sell, driver_coverage, passenger_coverage`;

    const aggregateSql = `
      SELECT ${groupByColumns},
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(DISTINCT CASE WHEN is_cross_sell THEN dedup_key END) AS driver_count,
        COUNT(DISTINCT CASE WHEN is_cross_sell THEN raw_policy_no END) AS driver_policy_count,
        COALESCE(SUM(CASE WHEN is_cross_sell THEN cross_sell_premium_driver ELSE 0 END), 0) AS driver_premium,
        COALESCE(SUM(CASE WHEN insurance_type IN ('商业险', '商业保险', '商车统保', '商业险+交强险') THEN premium ELSE 0 END), 0) AS commercial_premium,
        COALESCE(SUM(CASE WHEN insurance_type = '交强险' THEN premium ELSE 0 END), 0) AS compulsory_premium,
        COALESCE(SUM(premium), 0) AS auto_premium
      FROM normalized WHERE dedup_key IS NOT NULL
      GROUP BY ${groupByColumns}`;

    const viewFallbackSql = `
      CREATE OR REPLACE VIEW CrossSellDailyAgg AS
      WITH normalized AS (${cteSql})
      ${aggregateSql}`;

    await materializeInBatches(
      db,
      'CrossSellDailyAgg',
      cteSql,
      aggregateSql,
      viewFallbackSql,
      [
        { name: 'idx_cross_sell_agg_date', column: 'policy_date' },
        { name: 'idx_cross_sell_agg_category', column: 'customer_category' },
      ],
    );
  }
}

// ============================================
// PolicyFact 视图构建
// ============================================

/**
 * 创建PolicyFact视图（带列名映射和去重）
 *
 * @param db 可查询接口
 * @param sourceTable 源表名
 */
export async function createPolicyFactView(db: DuckDBQueryable, sourceTable: string = 'raw_parquet'): Promise<void> {
  // 全环境统一实时模式：从原始 Parquet 构建标准化 PolicyFact 行级数据。

  // 1. 验证表名（防止 SQL 注入）
  const safeSourceTable = sanitizeTableName(sourceTable);

  // 获取表结构
  const schema = await db.getTableSchema(safeSourceTable);
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
    await db.query(mappingSQL);

    console.log('[DuckDB] PolicyFact view created with column mapping');
  } else {
    // 英文列名，直接创建视图（使用验证后的表名）
    const sql = `
      CREATE OR REPLACE VIEW PolicyFact AS
      SELECT * FROM ${safeSourceTable}
    `;
    await db.query(sql);
    console.log('[DuckDB] PolicyFact view created (pass-through mode)');
  }

  // 补齐 8 域迁移后 PolicyFact 中可能缺失的向后兼容字段
  const pfSchema = await db.getTableSchema('raw_parquet');
  const existingCols = new Set(pfSchema.map((c: any) => c.column_name));
  const compatFields: Array<[string, string, string]> = [
    ['renewal_mode', 'VARCHAR', "''"],
    ['is_cross_sell', 'BOOLEAN', 'false'],
    ['cross_sell_premium_driver', 'DOUBLE', '0'],
    ['claim_cases', 'INTEGER', '0'],
    ['reported_claims', 'DOUBLE', '0'],
    ['driver_coverage', 'DOUBLE', '0'],
    ['passenger_coverage', 'DOUBLE', '0'],
  ];
  const missingFields = compatFields.filter(([name]) => !existingCols.has(name));
  if (missingFields.length > 0) {
    // raw_parquet 是 TABLE，可以 ALTER ADD COLUMN
    for (const [name, type, defaultVal] of missingFields) {
      await db.query(`ALTER TABLE raw_parquet ADD COLUMN IF NOT EXISTS "${name}" ${type} DEFAULT ${defaultVal}`);
    }
    // 重建 PolicyFact 视图
    await db.query(`CREATE OR REPLACE VIEW PolicyFact AS SELECT * FROM raw_parquet`);
    console.log(`[DuckDB] Added ${missingFields.length} compat columns to raw_parquet: ${missingFields.map(f => f[0]).join(', ')}`);
  }

  await materializePolicyFactWorkingSet(db);
  // createCrossSellRealtimeView 已从此处移除（per D-09 解耦）
  // CrossSell lazy-loader（data-bootstrapper.ts registerLazyDomains）加载后调用此函数
  console.log('[DuckDB] Realtime mode enabled: using PolicyFact realtime aggregation (no pre-aggregated tables)');
}

/**
 * 兼容历史调用点。系统已固定实时聚合，不再存在预聚合自愈流程。
 */
export async function ensureAggregatesReady(): Promise<void> {
  return;
}
