#!/usr/bin/env node
/**
 * VPS 预聚合数据导出脚本
 *
 * 在 Mac 本地运行，读取原始 Parquet → 用 DuckDB 重建所有聚合表 → 导出精简 Parquet
 *
 * 输出：数据管理/warehouse/vps-export/
 *   ├── aggregated.parquet    # 仪表盘所需预聚合数据（DailyAggregated + PeriodAggregated + CrossSellDailyAgg + KpiDailySummary）
 *   └── renewal_agg.parquet   # 续保专用聚合表（按到期日+维度聚合，无行级保单明细）
 *
 * 使用方式：
 *   node scripts/export-for-vps.mjs
 *   node scripts/export-for-vps.mjs --dry-run   # 仅验证，不导出
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @duckdb/node-api 安装在 server/node_modules 中，需要从 server 目录解析
const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));
const { DuckDBInstance } = serverRequire('@duckdb/node-api');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ============================================
// 配置
// ============================================
const WAREHOUSE_DIR = path.join(PROJECT_ROOT, '数据管理/warehouse');
const POLICY_DIR = path.join(WAREHOUSE_DIR, 'fact/policy');
const CURRENT_DIR = path.join(POLICY_DIR, 'current');
const OUTPUT_DIR = path.join(WAREHOUSE_DIR, 'vps-export');
const TEAM_MAPPING_PATH = path.join(WAREHOUSE_DIR, 'dim/业务员归属与规划/salesman_organization_mapping.json');

const DRY_RUN = process.argv.includes('--dry-run');

// ============================================
// 工具函数
// ============================================
function log(msg) {
  console.log(`[export-for-vps] ${msg}`);
}

function logError(msg) {
  console.error(`[export-for-vps] ❌ ${msg}`);
}

function logSuccess(msg) {
  console.log(`[export-for-vps] ✅ ${msg}`);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 查找所有需要加载的 Parquet 文件
 * 优先 current/ 目录，回退到 fact/policy/ 根目录
 */
function findParquetFiles() {
  const candidates = [CURRENT_DIR, POLICY_DIR];

  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.parquet') && !f.startsWith('test-data'))
      .map(f => ({
        name: f,
        path: path.join(dir, f),
        size: fs.statSync(path.join(dir, f)).size,
        mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (files.length > 0) return files;
  }

  return [];
}

// ============================================
// 列名映射 SQL 生成（与 column-normalizer.ts 保持一致）
// ============================================

/**
 * 从 server/src/normalize/mapping.ts 读不到（ESM vs CJS 问题），
 * 直接内联核心映射（与 mapping.ts 保持同步）。
 *
 * ⚠️ 如果 mapping.ts 修改了映射规则，这里也需要同步更新。
 */
const COLUMN_ALIASES = {
  '保单号': 'policy_no',
  '保费': 'premium',
  '签单日期': 'policy_date',
  '起保日期': 'insurance_start_date',
  '机构': 'org_level_3',
  '三级机构': 'org_level_3',
  '业务员': 'salesman_name',
  '客户类别': 'customer_category',
  '险别组合': 'coverage_combination',
  '续保方式': 'renewal_mode',
  '吨位段': 'tonnage_segment',
  '车险评分': 'insurance_grade',
  '小货车评分': 'small_truck_score',
  '大货车评分': 'large_truck_score',
  '是否转保': 'is_transfer',
  '是否电销': 'is_telemarketing',
  '是否续保': 'is_renewal',
  '是否新能源': 'is_nev',
  '是否新车': 'is_new_car',
  '是否交叉销售': 'is_cross_sell',
  '是否可续保': 'is_renewable',
  '是否商业险': 'is_commercial_insure',
  '险种': 'insurance_type',
  '续保单号': 'renewal_policy_no',
  '车架号': 'vehicle_frame_no',
  '车驾保额_驾驶员': 'driver_coverage',
  '车驾保额_乘客': 'passenger_coverage',
  '车驾保费_驾驶员': 'cross_sell_premium_driver',
};

/**
 * 生成列名映射 SQL（将中文列名映射到英文）
 */
function generateColumnMappingSql(tableName, actualColumns) {
  const mappedColumns = actualColumns.map(col => {
    const englishName = COLUMN_ALIASES[col];
    if (englishName) {
      return `"${col}" AS ${englishName}`;
    }
    return `"${col}"`;
  });

  return `
    CREATE OR REPLACE VIEW PolicyFact AS
    SELECT ${mappedColumns.join(',\n           ')}
    FROM ${tableName}
  `;
}

// ============================================
// 主流程
// ============================================
async function main() {
  log('VPS 预聚合数据导出脚本');
  log('='.repeat(60));

  // 1. 查找 Parquet 文件
  const parquetFiles = findParquetFiles();
  if (parquetFiles.length === 0) {
    logError('未找到任何 Parquet 文件');
    logError(`已搜索：${CURRENT_DIR}, ${POLICY_DIR}`);
    process.exit(1);
  }

  log(`找到 ${parquetFiles.length} 个 Parquet 文件：`);
  parquetFiles.forEach((f, i) => log(`  [${i}] ${f.name} (${formatSize(f.size)})`));

  // 2. 初始化 DuckDB（内存模式，Mac 本地大内存无限制）
  log('初始化 DuckDB (内存模式)...');
  const instance = await DuckDBInstance.create(':memory:', {
    max_memory: '8GB',
    threads: '4',
  });
  const conn = await instance.connect();

  const query = async (sql) => {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjects();
  };

  try {
    // 3. 加载原始 Parquet
    log('加载原始 Parquet 文件...');
    if (parquetFiles.length === 1) {
      await query(`CREATE TABLE raw_parquet AS SELECT * FROM read_parquet('${parquetFiles[0].path.replace(/'/g, "''")}')`);
    } else {
      // 多文件：逐个加载，UNION ALL
      for (let i = 0; i < parquetFiles.length; i++) {
        const escapedPath = parquetFiles[i].path.replace(/'/g, "''");
        await query(`CREATE TABLE raw_parquet_${i} AS SELECT * FROM read_parquet('${escapedPath}')`);
      }
      const unionParts = parquetFiles.map((_, i) => `SELECT * FROM raw_parquet_${i}`);
      await query(`CREATE VIEW raw_parquet AS ${unionParts.join(' UNION ALL ')}`);
    }

    const countResult = await query('SELECT COUNT(*) AS cnt FROM raw_parquet');
    const totalRows = Number(countResult[0]?.cnt ?? 0);
    log(`原始数据加载完成：${totalRows.toLocaleString()} 行`);

    // 4. 创建 PolicyFact 视图（列名映射）
    const schemaResult = await query('DESCRIBE raw_parquet');
    const actualColumns = schemaResult.map(r => String(r.column_name));
    const needsMapping = /[\u4e00-\u9fa5]/.test(actualColumns[0] || '');

    if (needsMapping) {
      log('检测到中文列名，应用映射...');
      const mappingSql = generateColumnMappingSql('raw_parquet', actualColumns);
      await query(mappingSql);
    } else {
      await query('CREATE OR REPLACE VIEW PolicyFact AS SELECT * FROM raw_parquet');
    }

    const pfCount = await query('SELECT COUNT(*) AS cnt FROM PolicyFact');
    log(`PolicyFact 视图创建成功：${Number(pfCount[0]?.cnt ?? 0).toLocaleString()} 行`);

    // 4.5 补全 PolicyFact 缺失列（确保聚合 SQL 与 duckdb.ts 完全一致）
    const pfSchema = await query('DESCRIBE PolicyFact');
    const availableColumns = new Set(pfSchema.map(r => String(r.column_name)));
    log(`PolicyFact 实际列数：${availableColumns.size}`);

    // 聚合 SQL 所需的全部列（与 duckdb.ts buildAggregates 一致）
    const requiredColumns = {
      policy_no: "CAST('' AS VARCHAR)",
      premium: 'CAST(0 AS DOUBLE)',
      policy_date: 'CAST(NULL AS DATE)',
      insurance_start_date: 'CAST(NULL AS DATE)',
      org_level_3: "CAST('' AS VARCHAR)",
      salesman_name: "CAST('' AS VARCHAR)",
      customer_category: "CAST('' AS VARCHAR)",
      coverage_combination: "CAST('' AS VARCHAR)",
      renewal_mode: "CAST('' AS VARCHAR)",
      tonnage_segment: "CAST('' AS VARCHAR)",
      insurance_grade: "CAST('' AS VARCHAR)",
      small_truck_score: 'CAST(NULL AS DOUBLE)',
      large_truck_score: 'CAST(NULL AS DOUBLE)',
      is_transfer: 'CAST(false AS BOOLEAN)',
      is_telemarketing: 'CAST(false AS BOOLEAN)',
      is_renewal: 'CAST(false AS BOOLEAN)',
      is_nev: 'CAST(false AS BOOLEAN)',
      is_new_car: 'CAST(false AS BOOLEAN)',
      is_cross_sell: 'CAST(false AS BOOLEAN)',
      is_renewable: 'CAST(false AS BOOLEAN)',
      is_commercial_insure: "CAST('' AS VARCHAR)",
      insurance_type: "CAST('' AS VARCHAR)",
      renewal_policy_no: "CAST('' AS VARCHAR)",
      vehicle_frame_no: "CAST('' AS VARCHAR)",
      driver_coverage: 'CAST(0 AS DOUBLE)',
      passenger_coverage: 'CAST(0 AS DOUBLE)',
      cross_sell_premium_driver: 'CAST(0 AS DOUBLE)',
    };

    const missingCols = Object.keys(requiredColumns).filter(c => !availableColumns.has(c));
    if (missingCols.length > 0) {
      log(`缺失列（将用默认值填充）：${missingCols.join(', ')}`);
      const selectParts = Object.entries(requiredColumns).map(([colName, defaultExpr]) =>
        availableColumns.has(colName) ? colName : `${defaultExpr} AS ${colName}`
      );
      const extraCols = [...availableColumns].filter(c => !requiredColumns[c]);
      // 用 TABLE 物化（而非 VIEW）以打断依赖链，避免 DROP 级联
      await query(`
        CREATE OR REPLACE TABLE PolicyFactComplete AS
        SELECT ${[...selectParts, ...extraCols].join(', ')}
        FROM PolicyFact
      `);
      // 重建 PolicyFact 指向物化表
      try { await query('DROP VIEW IF EXISTS PolicyFact'); } catch { /* ignore */ }
      await query('CREATE OR REPLACE VIEW PolicyFact AS SELECT * FROM PolicyFactComplete');
      log('PolicyFact 已补全缺失列（物化为 PolicyFactComplete）');
    } else {
      log('所有必需列均存在，无需补全');
    }

    // 5. 构建 DailyAggregated 表
    log('构建 DailyAggregated ...');
    await query(`
      CREATE OR REPLACE TABLE DailyAggregated AS
      WITH base AS (
        SELECT
          CAST(policy_date AS DATE) AS agg_date,
          CAST(EXTRACT(YEAR FROM CAST(policy_date AS DATE)) AS INTEGER) AS policy_year,
          CAST(FLOOR((EXTRACT(DOY FROM CAST(policy_date AS DATE)) - 1) / 7) + 1 AS INTEGER) AS natural_week_num,
          STRFTIME(CAST(policy_date AS DATE), '%Y-%m') AS policy_ym,
          org_level_3,
          salesman_name,
          customer_category,
          coverage_combination,
          renewal_mode,
          tonnage_segment,
          insurance_grade,
          small_truck_score,
          large_truck_score,
          COALESCE(is_transfer, false) AS is_transfer,
          COALESCE(is_telemarketing, false) AS is_telemarketing,
          COALESCE(is_renewal, false) AS is_renewal,
          COALESCE(is_nev, false) AS is_nev,
          COALESCE(is_new_car, false) AS is_new_car,
          COALESCE(is_cross_sell, false) AS is_cross_sell,
          COALESCE(is_renewable, false) AS is_renewable,
          COALESCE(CAST(is_commercial_insure AS VARCHAR), '') AS is_commercial_insure,
          COALESCE(CAST(insurance_type AS VARCHAR), '') AS insurance_type,
          COALESCE(premium, 0) AS premium,
          policy_no
        FROM PolicyFact
        WHERE policy_date IS NOT NULL
      )
      SELECT
        agg_date,
        policy_year,
        natural_week_num,
        policy_ym,
        org_level_3,
        salesman_name,
        customer_category,
        coverage_combination,
        renewal_mode,
        tonnage_segment,
        insurance_grade,
        small_truck_score,
        large_truck_score,
        is_transfer,
        is_telemarketing,
        is_renewal,
        is_nev,
        is_new_car,
        is_cross_sell,
        is_renewable,
        is_commercial_insure,
        insurance_type,
        SUM(premium) AS total_premium,
        COUNT(DISTINCT policy_no) AS policy_count,
        SUM(CASE WHEN is_transfer THEN 1 ELSE 0 END) AS transfer_count,
        SUM(CASE WHEN is_telemarketing THEN 1 ELSE 0 END) AS telesales_count,
        SUM(CASE WHEN is_renewal THEN 1 ELSE 0 END) AS renewal_count,
        SUM(CASE WHEN insurance_type LIKE '%商业%' THEN premium ELSE 0 END) AS commercial_premium,
        SUM(CASE WHEN is_nev THEN 1 ELSE 0 END) AS nev_count,
        SUM(CASE WHEN is_new_car THEN 1 ELSE 0 END) AS new_car_count
      FROM base
      GROUP BY
        agg_date, policy_year, natural_week_num, policy_ym,
        org_level_3, salesman_name, customer_category,
        coverage_combination, renewal_mode, tonnage_segment,
        insurance_grade, small_truck_score, large_truck_score,
        is_transfer, is_telemarketing, is_renewal,
        is_nev, is_new_car, is_cross_sell, is_renewable,
        is_commercial_insure, insurance_type
    `);
    const dailyCount = await query('SELECT COUNT(*) AS cnt FROM DailyAggregated');
    log(`  DailyAggregated: ${Number(dailyCount[0]?.cnt ?? 0).toLocaleString()} 行`);

    // 6. 构建 PeriodAggregated 表
    log('构建 PeriodAggregated ...');
    await query(`
      CREATE OR REPLACE TABLE PeriodAggregated AS
      SELECT
        policy_ym,
        policy_year,
        CAST(RIGHT(policy_ym, 2) AS INTEGER) AS policy_month,
        org_level_3, salesman_name, customer_category,
        coverage_combination, renewal_mode, tonnage_segment,
        insurance_grade, small_truck_score, large_truck_score,
        is_transfer, is_telemarketing, is_renewal,
        is_nev, is_new_car, is_cross_sell, is_renewable,
        is_commercial_insure, insurance_type,
        SUM(total_premium) AS period_premium,
        SUM(policy_count) AS period_count
      FROM DailyAggregated
      GROUP BY
        policy_ym, policy_year, policy_month,
        org_level_3, salesman_name, customer_category,
        coverage_combination, renewal_mode, tonnage_segment,
        insurance_grade, small_truck_score, large_truck_score,
        is_transfer, is_telemarketing, is_renewal,
        is_nev, is_new_car, is_cross_sell, is_renewable,
        is_commercial_insure, insurance_type
    `);
    const periodCount = await query('SELECT COUNT(*) AS cnt FROM PeriodAggregated');
    log(`  PeriodAggregated: ${Number(periodCount[0]?.cnt ?? 0).toLocaleString()} 行`);

    // 7. 构建 CrossSellDailyAgg 表
    log('构建 CrossSellDailyAgg ...');
    await query(`
      CREATE OR REPLACE TABLE CrossSellDailyAgg AS
      WITH normalized AS (
        SELECT
          CAST(policy_date AS DATE) AS policy_date,
          CAST(insurance_start_date AS DATE) AS insurance_start_date,
          org_level_3, salesman_name, customer_category,
          coverage_combination, renewal_mode, tonnage_segment,
          insurance_grade, small_truck_score, large_truck_score,
          COALESCE(CAST(is_commercial_insure AS VARCHAR), '') AS is_commercial_insure,
          COALESCE(CAST(insurance_type AS VARCHAR), '') AS insurance_type,
          (TRY_CAST(is_transfer AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_transfer AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_transfer,
          (TRY_CAST(is_telemarketing AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_telemarketing AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_telemarketing,
          (TRY_CAST(is_renewal AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_renewal AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_renewal,
          (TRY_CAST(is_nev AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_nev AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_nev,
          (TRY_CAST(is_new_car AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_new_car AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_new_car,
          (TRY_CAST(is_renewable AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_renewable AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_renewable,
          (TRY_CAST(is_cross_sell AS BOOLEAN) = true
            OR LOWER(TRIM(CAST(is_cross_sell AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
          ) AS is_cross_sell,
          COALESCE(driver_coverage, 0) AS driver_coverage,
          COALESCE(passenger_coverage, 0) AS passenger_coverage,
          COALESCE(cross_sell_premium_driver, 0) AS cross_sell_premium_driver,
          COALESCE(premium, 0) AS premium,
          COALESCE(
            NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''),
            NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')
          ) AS dedup_key,
          NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '') AS raw_policy_no
        FROM PolicyFact
        WHERE policy_date IS NOT NULL
      )
      SELECT
        policy_date, insurance_start_date,
        org_level_3, salesman_name, customer_category,
        coverage_combination, renewal_mode, tonnage_segment,
        insurance_grade, small_truck_score, large_truck_score,
        is_commercial_insure,
        is_transfer, is_telemarketing, is_renewal,
        is_nev, is_new_car, is_renewable, is_cross_sell,
        driver_coverage, passenger_coverage,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(DISTINCT CASE WHEN is_cross_sell THEN dedup_key END) AS driver_count,
        COUNT(DISTINCT CASE WHEN is_cross_sell THEN raw_policy_no END) AS driver_policy_count,
        COALESCE(SUM(CASE WHEN is_cross_sell THEN cross_sell_premium_driver ELSE 0 END), 0) AS driver_premium,
        COALESCE(SUM(premium), 0) AS auto_premium
      FROM normalized
      WHERE dedup_key IS NOT NULL
      GROUP BY
        policy_date, insurance_start_date,
        org_level_3, salesman_name, customer_category,
        coverage_combination, renewal_mode, tonnage_segment,
        insurance_grade, small_truck_score, large_truck_score,
        is_commercial_insure,
        is_transfer, is_telemarketing, is_renewal,
        is_nev, is_new_car, is_renewable, is_cross_sell,
        driver_coverage, passenger_coverage
    `);
    const crossSellCount = await query('SELECT COUNT(*) AS cnt FROM CrossSellDailyAgg');
    log(`  CrossSellDailyAgg: ${Number(crossSellCount[0]?.cnt ?? 0).toLocaleString()} 行`);

    // 8. 构建 KpiDailySummary 表
    log('构建 KpiDailySummary ...');
    await query(`
      CREATE OR REPLACE TABLE KpiDailySummary AS
      SELECT
        agg_date,
        policy_ym,
        org_level_3,
        insurance_type,
        SUM(total_premium) AS total_premium,
        SUM(policy_count) AS policy_count,
        SUM(commercial_premium) AS commercial_premium,
        SUM(renewal_count) AS renewal_count,
        SUM(transfer_count) AS transfer_count,
        SUM(nev_count) AS nev_count,
        SUM(new_car_count) AS new_car_count,
        SUM(telesales_count) AS telesales_count
      FROM DailyAggregated
      GROUP BY agg_date, policy_ym, org_level_3, insurance_type
    `);
    const kpiCount = await query('SELECT COUNT(*) AS cnt FROM KpiDailySummary');
    log(`  KpiDailySummary: ${Number(kpiCount[0]?.cnt ?? 0).toLocaleString()} 行`);

    // 9. 构建续保聚合表 (RenewalAgg)
    log('构建续保聚合表 (RenewalAgg) ...');
    await query(`
      CREATE OR REPLACE TABLE RenewalAgg AS
      SELECT
        DATE_ADD(CAST(insurance_start_date AS DATE), INTERVAL '1 year') - INTERVAL '1 day' AS expiry_date,
        YEAR(CAST(insurance_start_date AS DATE)) AS orig_start_year,
        org_level_3,
        salesman_name,
        customer_category,
        COALESCE(CAST(insurance_type AS VARCHAR), '') AS insurance_type,
        COUNT(DISTINCT policy_no) AS due_count,
        COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> '' THEN policy_no
        END) AS renewed_count,
        COALESCE(SUM(premium), 0) AS due_premium,
        COALESCE(SUM(CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> '' THEN premium ELSE 0
        END), 0) AS renewed_premium
      FROM PolicyFact
      WHERE insurance_start_date IS NOT NULL
      GROUP BY
        expiry_date,
        orig_start_year,
        org_level_3,
        salesman_name,
        customer_category,
        insurance_type
    `);
    const renewalCount = await query('SELECT COUNT(*) AS cnt FROM RenewalAgg');
    log(`  RenewalAgg: ${Number(renewalCount[0]?.cnt ?? 0).toLocaleString()} 行`);

    if (DRY_RUN) {
      logSuccess('DRY RUN 完成，跳过导出');
      conn.closeSync();
      return;
    }

    // 10. 创建输出目录
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // 11. 导出 aggregated.parquet（多表合并，含 table_name 字段区分）
    log('导出 aggregated.parquet ...');
    await query(`
      COPY (
        SELECT 'DailyAggregated' AS table_name, * FROM DailyAggregated
        UNION ALL
        SELECT 'PeriodAggregated' AS table_name, * FROM (
          SELECT
            CAST(NULL AS DATE) AS agg_date,
            policy_year,
            CAST(0 AS INTEGER) AS natural_week_num,
            policy_ym,
            org_level_3, salesman_name, customer_category,
            coverage_combination, renewal_mode, tonnage_segment,
            insurance_grade, small_truck_score, large_truck_score,
            is_transfer, is_telemarketing, is_renewal,
            is_nev, is_new_car, is_cross_sell, is_renewable,
            is_commercial_insure, insurance_type,
            period_premium AS total_premium,
            period_count AS policy_count,
            CAST(0 AS BIGINT) AS transfer_count,
            CAST(0 AS BIGINT) AS telesales_count,
            CAST(0 AS BIGINT) AS renewal_count,
            CAST(0 AS DOUBLE) AS commercial_premium,
            CAST(0 AS BIGINT) AS nev_count,
            CAST(0 AS BIGINT) AS new_car_count
          FROM PeriodAggregated
        )
        UNION ALL
        SELECT 'KpiDailySummary' AS table_name, * FROM (
          SELECT
            agg_date,
            CAST(0 AS INTEGER) AS policy_year,
            CAST(0 AS INTEGER) AS natural_week_num,
            policy_ym,
            org_level_3,
            CAST('' AS VARCHAR) AS salesman_name,
            CAST('' AS VARCHAR) AS customer_category,
            CAST('' AS VARCHAR) AS coverage_combination,
            CAST('' AS VARCHAR) AS renewal_mode,
            CAST('' AS VARCHAR) AS tonnage_segment,
            CAST('' AS VARCHAR) AS insurance_grade,
            CAST(NULL AS DOUBLE) AS small_truck_score,
            CAST(NULL AS DOUBLE) AS large_truck_score,
            CAST(false AS BOOLEAN) AS is_transfer,
            CAST(false AS BOOLEAN) AS is_telemarketing,
            CAST(false AS BOOLEAN) AS is_renewal,
            CAST(false AS BOOLEAN) AS is_nev,
            CAST(false AS BOOLEAN) AS is_new_car,
            CAST(false AS BOOLEAN) AS is_cross_sell,
            CAST(false AS BOOLEAN) AS is_renewable,
            CAST('' AS VARCHAR) AS is_commercial_insure,
            insurance_type,
            total_premium,
            policy_count,
            transfer_count,
            telesales_count,
            renewal_count,
            commercial_premium,
            nev_count,
            new_car_count
          FROM KpiDailySummary
        )
      ) TO '${OUTPUT_DIR.replace(/'/g, "''")}/aggregated.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);

    // 12. 单独导出 CrossSellDailyAgg（schema 与其他表差异大，不合并）
    log('导出 cross_sell_agg.parquet ...');
    await query(`
      COPY CrossSellDailyAgg
      TO '${OUTPUT_DIR.replace(/'/g, "''")}/cross_sell_agg.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);

    // 13. 导出 renewal_agg.parquet
    log('导出 renewal_agg.parquet ...');
    await query(`
      COPY RenewalAgg
      TO '${OUTPUT_DIR.replace(/'/g, "''")}/renewal_agg.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);

    // 14. 打印结果
    log('='.repeat(60));
    logSuccess('导出完成！');
    const outputFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.parquet'));
    let totalSize = 0;
    for (const f of outputFiles) {
      const fpath = path.join(OUTPUT_DIR, f);
      const size = fs.statSync(fpath).size;
      totalSize += size;
      log(`  ${f}: ${formatSize(size)}`);
    }
    log(`  总大小: ${formatSize(totalSize)}`);
    log('');
    log('下一步：');
    log('  1. 使用 deploy/sync-data.sh --export 同步到 VPS');
    log('  2. 或手动上传：');
    log(`     scp ${OUTPUT_DIR}/aggregated.parquet chexian-vps:/var/www/chexian/server/data/current/`);
    log(`     scp ${OUTPUT_DIR}/cross_sell_agg.parquet chexian-vps:/var/www/chexian/server/data/current/`);
    log(`     scp ${OUTPUT_DIR}/renewal_agg.parquet chexian-vps:/var/www/chexian/server/data/current/`);

  } catch (err) {
    logError(`导出失败: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    try { conn.closeSync(); } catch { /* ignore */ }
  }
}

main().catch(err => {
  logError(`未捕获异常: ${err.message}`);
  console.error(err);
  process.exit(1);
});
