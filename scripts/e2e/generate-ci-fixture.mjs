#!/usr/bin/env node
/**
 * E2E CI 数据 fixture 生成器（BACKLOG 2026-06-11-claude-89a352）
 *
 * 目标：在 CI / 无真实数据环境生成一套全合成、确定性、过 schema 契约的最小
 * Parquet 切片，让 Playwright E2E 不再因「无数据」静默跳过。
 *
 * 设计约束：
 * - 引擎复用 server 自带 @duckdb/node-api（零新增依赖，与 server 读写同引擎）
 * - 列集与生产 Parquet DESCRIBE 完全一致（2026-06-12 抄录），值域对齐业务枚举
 * - 纯 index 取模生成，零随机 → 任意两次运行产物字节级可复现
 * - 全合成数据：保单号 99 开头自造号段、业务员 9000xx 工号段、车架号 E2EVIN 前缀
 * - 生成后用 server/src/config/field-registry/fields.json 的 14 个必需字段做契约自校验
 *
 * 用法：node scripts/e2e/generate-ci-fixture.mjs [--out-dir server/data]
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// @duckdb/node-api 安装在 server/ 独立 package，从 server 上下文解析
const serverRequire = createRequire(path.join(REPO_ROOT, 'server', 'package.json'));
const { DuckDBInstance } = serverRequire('@duckdb/node-api');

const outDirArg = process.argv.indexOf('--out-dir');
const OUT_DIR = path.resolve(
  REPO_ROOT,
  outDirArg !== -1 ? process.argv[outDirArg + 1] : 'server/data'
);

const FIELDS_JSON = path.join(REPO_ROOT, 'server/src/config/field-registry/fields.json');

/** 合成维度常量（与 dim 表互相对齐） */
const ORGS = ['天府', '乐山', '高新'];
const SALESMEN = [
  { no: '900001', name: '测试业务员甲', team: '测试一部' },
  { no: '900002', name: '测试业务员乙', team: '测试一部' },
  { no: '900003', name: '测试业务员丙', team: '测试二部' },
  { no: '900004', name: '测试业务员丁', team: '测试二部' },
  { no: '900005', name: '测试业务员戊', team: '测试三部' },
  { no: '900006', name: '测试业务员己', team: '测试三部' },
];

/** DuckDB 列表字面量（1-indexed 取模索引用） */
const sqlList = (arr) => `[${arr.map((v) => `'${v}'`).join(', ')}]`;
const ORG_LIST = sqlList(ORGS);
const FULLNAME_LIST = sqlList(SALESMEN.map((s) => s.no + s.name));

async function main() {
  console.log(`[e2e-fixture] 输出目录: ${OUT_DIR}`);

  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  const run = (sql) => conn.run(sql);

  const copyTo = async (selectSql, relPath) => {
    const target = path.join(OUT_DIR, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await run(`COPY (${selectSql}) TO '${target.replace(/'/g, "''")}' (FORMAT PARQUET)`);
    const reader = await conn.runAndReadAll(
      `SELECT COUNT(*) AS n FROM read_parquet('${target.replace(/'/g, "''")}')`
    );
    const n = Number(reader.getRowObjects()[0].n);
    if (n <= 0) throw new Error(`[e2e-fixture] ${relPath} 行数为 0`);
    console.log(`[e2e-fixture] ✓ ${relPath} (${n} 行)`);
    return target;
  };

  // ── 1. policy（主数据源，240 行覆盖 2025-01 ~ 2026-05）──────────────────
  // 列集 = 生产 policy parquet DESCRIBE 全列；险类×险别组合对齐业务口径：
  // 主全/交三/其他=商业保险，单交=交强险
  const policySql = `
    SELECT
      '99' || lpad(CAST(i AS VARCHAR), 20, '0')                                   AS policy_no,
      CASE WHEN i % 3 = 0 THEN '98' || lpad(CAST(i AS VARCHAR), 20, '0') ELSE NULL END AS renewal_policy_no,
      ${FULLNAME_LIST}[CAST(i % 6 AS INT) + 1]                                    AS salesman_name,
      ${ORG_LIST}[CAST(i % 3 AS INT) + 1]                                         AS org_level_3,
      CAST(DATE '2025-01-05' + INTERVAL (CAST(i AS INT) * 2) DAY AS TIMESTAMP)    AS policy_date,
      CAST(DATE '2025-01-06' + INTERVAL (CAST(i AS INT) * 2) DAY AS TIMESTAMP)    AS insurance_start_date,
      CASE WHEN i % 4 = 2 THEN '交强险' ELSE '商业保险' END                        AS insurance_type,
      ['主全', '交三', '单交', '其他'][CAST(i % 4 AS INT) + 1]                     AS coverage_combination,
      CASE WHEN i % 40 = 7 THEN -200.0 ELSE 1500.0 + CAST(i % 50 AS DOUBLE) * 100 END AS premium,
      i % 3 = 0                                                                    AS is_renewal,
      CAST(CASE WHEN i % 5 = 0 THEN 1 ELSE 0 END AS INTEGER)                       AS is_renewable,
      i % 7 = 1                                                                    AS is_new_car,
      i % 6 = 2                                                                    AS is_nev,
      i % 8 = 3                                                                    AS is_transfer,
      i % 9 = 4                                                                    AS is_telemarketing,
      CASE WHEN i % 9 = 4 THEN '0110融合销售' ELSE '0101线下渠道' END               AS terminal_source,
      ['非营业个人客车', '营业货车', '非营业货车', '非营业企业客车', '摩托车'][CAST(i % 5 AS INT) + 1] AS customer_category,
      '测试车型' || CAST(i % 4 AS VARCHAR)                                          AS vehicle_model,
      ['0-2吨', '2-10吨', '10吨以上', ''][CAST(i % 4 AS INT) + 1]                   AS tonnage_segment,
      80000.0 + CAST(i % 20 AS DOUBLE) * 5000                                       AS new_vehicle_price,
      '测试代理' || CAST(i % 3 AS VARCHAR)                                          AS agent_name,
      ['续保', '新保', '转保'][CAST(i % 3 AS INT) + 1]                              AS customer_source,
      CAST(NULL AS VARCHAR)                                                         AS endorsement_no,
      0.85 + CAST(i % 30 AS DOUBLE) * 0.01                                          AS commercial_pricing_factor,
      CASE WHEN i % 4 = 2 THEN '否' ELSE '是' END                                   AS is_commercial_insure,
      'E2EVIN' || lpad(CAST(i AS VARCHAR), 11, '0')                                 AS vehicle_frame_no,
      120.0 + CAST(i % 10 AS DOUBLE) * 10                                           AS fee_amount,
      ['A', 'B', 'C', 'D', 'X'][CAST(i % 5 AS INT) + 1]                             AS insurance_grade,
      i % 5 = 1                                                                     AS is_cross_sell,
      CASE WHEN i % 5 = 1 THEN 300.0 ELSE 0.0 END                                   AS cross_sell_premium_driver,
      '川A' || lpad(CAST(10000 + CAST(i AS INT) AS VARCHAR), 5, '0')                AS plate_no,
      CAST(5 AS BIGINT)                                                             AS seat_count,
      ['30-40', '40-50', '50-60'][CAST(i % 3 AS INT) + 1]                           AS driver_age_group,
      '2020-01-01'                                                                  AS first_registration_date,
      CASE WHEN i % 6 = 2 THEN '纯电动' ELSE '汽油' END                              AS fuel_type,
      CAST(DATE '2026-01-05' + INTERVAL (CAST(i AS INT) * 2) DAY AS TIMESTAMP)      AS insurance_end_date,
      CASE WHEN i % 2 = 0 THEN '男' ELSE '女' END                                    AS insured_gender,
      CAST(NULL AS VARCHAR)                                                          AS truck_type,
      CAST(0 AS BIGINT)                                                              AS tonnage_value,
      CAST(NULL AS VARCHAR)                                                          AS no_claim_bonus,
      ['A0', 'A1', 'A2'][CAST(i % 3 AS INT) + 1]                                     AS compulsory_ncd,
      ['0.85', '1.0', '1.15'][CAST(i % 3 AS INT) + 1]                                AS commercial_ncd,
      ['低', '中', '高'][CAST(i % 3 AS INT) + 1]                                     AS highway_risk_level,
      CAST(NULL AS DOUBLE)                                                           AS previous_insurer,
      CAST(NULL AS DOUBLE)                                                           AS next_insurer,
      [0.9, 1.0, 1.1][CAST(i % 3 AS INT) + 1]                                        AS compulsory_ncd_factor,
      'SC'                                                                           AS branch_code
    FROM range(240) t(i)`;
  const policyPath = await copyTo(policySql, 'current/e2e_fixture_policy.parquet');

  // ── 2. claims_detail（36 行，JOIN 前 36 个保单；已结/未结对半）────────────
  const claimsSql = `
    SELECT
      CAST(DATE '2025-06-01' + INTERVAL (CAST(i AS INT) * 7) DAY AS TIMESTAMP)     AS report_time,
      'E2ECLM' || lpad(CAST(i AS VARCHAR), 10, '0')                                AS claim_no,
      'E2ERPT' || lpad(CAST(i AS VARCHAR), 10, '0')                                AS report_no,
      'E2EVIN' || lpad(CAST(i AS VARCHAR), 11, '0')                                AS vehicle_frame_no,
      '99' || lpad(CAST(i AS VARCHAR), 20, '0')                                    AS policy_no,
      '川A' || lpad(CAST(10000 + CAST(i AS INT) AS VARCHAR), 5, '0')               AS subject_plate_no,
      '测试车系'                                                                    AS vehicle_series,
      ['车损', '人伤', '三者'][CAST(i % 3 AS INT) + 1]                              AS loss_category,
      '合成测试事故描述'                                                            AS accident_description,
      '现场处理'                                                                    AS treatment_type,
      '碰撞'                                                                        AS accident_cause,
      '四川省'                                                                      AS accident_province,
      '成都市'                                                                      AS accident_city,
      '高新区'                                                                      AS accident_district,
      '测试地址'                                                                    AS accident_address,
      CAST(DATE '2025-06-01' + INTERVAL (CAST(i AS INT) * 7) DAY AS TIMESTAMP)     AS accident_time,
      CAST(DATE '2025-06-02' + INTERVAL (CAST(i AS INT) * 7) DAY AS TIMESTAMP)     AS case_open_time,
      CAST(DATE '2025-06-02' + INTERVAL (CAST(i AS INT) * 7) DAY AS TIMESTAMP)     AS survey_time,
      CASE WHEN i % 2 = 0
        THEN CAST(DATE '2025-07-01' + INTERVAL (CAST(i AS INT) * 7) DAY AS TIMESTAMP)
        ELSE CAST(NULL AS TIMESTAMP) END                                            AS settlement_time,
      CASE WHEN i % 2 = 0
        THEN CAST(DATE '2025-07-03' + INTERVAL (CAST(i AS INT) * 7) DAY AS TIMESTAMP)
        ELSE CAST(NULL AS TIMESTAMP) END                                            AS payment_time,
      CASE WHEN i % 12 = 11 THEN '未决' ELSE '正常' END                              AS case_type,
      '单方'                                                                         AS scene_type,
      '测试修理厂'                                                                   AS subject_repair_shop,
      CAST(NULL AS VARCHAR)                                                          AS third_party_repair,
      FALSE                                                                          AS is_recovery,
      CASE WHEN i % 2 = 0 THEN 0.0 ELSE 4000.0 + CAST(i AS DOUBLE) * 100 END         AS reserve_amount,
      0.0                                                                            AS reserve_bodily_amount,
      CASE WHEN i % 2 = 0 THEN 0.0 ELSE 4000.0 + CAST(i AS DOUBLE) * 100 END         AS reserve_vehicle_amount,
      0.0                                                                            AS reserve_property_amount,
      CASE WHEN i % 2 = 0 THEN 3000.0 + CAST(i AS DOUBLE) * 100 ELSE 0.0 END         AS settled_vehicle_amount,
      0.0                                                                            AS settled_bodily_amount,
      CAST(100 AS BIGINT)                                                            AS liability_ratio,
      CASE WHEN i % 2 = 0 THEN 3000.0 + CAST(i AS DOUBLE) * 100 ELSE 0.0 END         AS settled_amount,
      CASE WHEN i % 2 = 0 THEN 0.0 ELSE 4000.0 + CAST(i AS DOUBLE) * 100 END         AS pending_amount,
      CASE WHEN i % 2 = 0 THEN 200.0 ELSE 0.0 END                                    AS settled_fee,
      'E2ESHOP01'                                                                    AS subject_shop_code,
      CASE WHEN i % 2 = 0 THEN '已业务结案' ELSE '未业务结案' END                     AS claim_status,
      i % 3 = 1                                                                      AS is_bodily_injury,
      CAST(DATE '2025-01-06' + INTERVAL (CAST(i AS INT) * 2) DAY AS TIMESTAMP)       AS insurance_start_date,
      CAST(2025 AS BIGINT)                                                           AS insurance_year
    FROM range(36) t(i)`;
  await copyTo(claimsSql, 'fact/claims_detail/claims_2025.parquet');

  // ── 3. quotes_conversion（96 行；续/转/新保 × 承保/未承保）─────────────────
  const quotesSql = `
    SELECT
      CAST(DATE '2026-01-10' + INTERVAL (CAST(i AS INT)) DAY AS TIMESTAMP)         AS quote_time,
      'E2EVIN' || lpad(CAST(i AS VARCHAR), 11, '0')                                AS vehicle_frame_no,
      '商业保险'                                                                    AS insurance_type,
      ${ORG_LIST}[CAST(i % 3 AS INT) + 1]                                          AS org_level_3,
      CASE WHEN i % 2 = 0 THEN '主全' ELSE '交三' END                               AS coverage_combination,
      ['非营业个人客车', '营业货车', '非营业货车'][CAST(i % 3 AS INT) + 1]          AS customer_category,
      ''                                                                            AS tonnage_segment,
      '测试品牌车型'                                                                 AS brand_model_category,
      CASE WHEN i % 6 = 2 THEN '纯电动' ELSE '汽油' END                              AS fuel_type,
      CASE WHEN i % 3 < 2 THEN '99' || lpad(CAST(i AS VARCHAR), 20, '0') ELSE NULL END AS policy_no,
      '川A' || lpad(CAST(10000 + CAST(i AS INT) AS VARCHAR), 5, '0')                AS plate_no,
      CAST(DATE '2026-02-01' + INTERVAL (CAST(i AS INT)) DAY AS TIMESTAMP)          AS insurance_start_date,
      ['续保', '转保', '新保'][CAST(i % 3 AS INT) + 1]                               AS renewal_status,
      CASE WHEN i % 8 = 3 THEN '是' ELSE '否' END                                    AS is_transfer,
      CASE WHEN i % 6 = 2 THEN '是' ELSE '否' END                                    AS is_nev,
      CASE WHEN i % 9 = 4 THEN '是' ELSE '否' END                                    AS is_telemarketing,
      CASE WHEN i % 3 < 2 THEN '承保' ELSE '未承保' END                              AS is_underwritten,
      ['低', '中', '高'][CAST(i % 3 AS INT) + 1]                                     AS highway_risk_level,
      ['A', 'B', 'C'][CAST(i % 3 AS INT) + 1]                                        AS traffic_risk_grade,
      80000.0 + CAST(i % 20 AS DOUBLE) * 5000                                        AS new_vehicle_price,
      CAST(i % 8 AS DOUBLE)                                                          AS vehicle_age,
      1200.0 + CAST(i % 30 AS DOUBLE) * 50                                           AS pure_risk_premium,
      [0.85, 1.0, 1.15][CAST(i % 3 AS INT) + 1]                                      AS commercial_ncd,
      ['持平', '上浮', '下浮'][CAST(i % 3 AS INT) + 1]                                AS ncd_yoy_change,
      1300.0 + CAST(i % 30 AS DOUBLE) * 50                                           AS ncd_premium,
      0.85 + CAST(i % 30 AS DOUBLE) * 0.01                                            AS commercial_pricing_factor,
      ['持平', '上浮', '下浮'][CAST(i % 3 AS INT) + 1]                                AS pricing_factor_yoy_change,
      1500.0 + CAST(i % 40 AS DOUBLE) * 60                                            AS final_quote_premium,
      ['A', 'B', 'C', 'D', 'X'][CAST(i % 5 AS INT) + 1]                               AS insurance_grade,
      ${sqlList(SALESMEN.map((s) => s.no))}[CAST(i % 6 AS INT) + 1]                   AS salesman_no,
      ${sqlList(SALESMEN.map((s) => s.name))}[CAST(i % 6 AS INT) + 1]                 AS salesman_name,
      ${sqlList(SALESMEN.map((s) => s.team))}[CAST(i % 6 AS INT) + 1]                 AS team
    FROM range(96) t(i)`;
  await copyTo(quotesSql, 'fact/quotes_conversion/latest.parquet');

  // ── 4. cross_sell（48 行）──────────────────────────────────────────────────
  const crossSellSql = `
    SELECT
      ${ORG_LIST}[CAST(i % 3 AS INT) + 1]                                          AS org_level_3,
      ${FULLNAME_LIST}[CAST(i % 6 AS INT) + 1]                                     AS salesman_name,
      '99' || lpad(CAST(i AS VARCHAR), 20, '0')                                    AS policy_no,
      CAST(DATE '2026-01-05' + INTERVAL (CAST(i AS INT) * 3) DAY AS TIMESTAMP)     AS policy_date,
      'E2EVIN' || lpad(CAST(i AS VARCHAR), 11, '0')                                AS vehicle_frame_no,
      ['非营业个人客车', '营业货车', '非营业货车'][CAST(i % 3 AS INT) + 1]          AS customer_category,
      CASE WHEN i % 2 = 0 THEN '主全' ELSE '交三' END                               AS coverage_combination,
      i % 4 = 1                                                                     AS is_cross_sell,
      CASE WHEN i % 4 = 1 THEN 300.0 + CAST(i AS DOUBLE) * 10 ELSE 0.0 END          AS cross_sell_premium_driver
    FROM range(48) t(i)`;
  await copyTo(crossSellSql, 'fact/cross_sell/latest.parquet');

  // ── 5. renewal_tracker（48 行；含 is_renewed 而未报价行，对齐口径）─────────
  const renewalSql = `
    SELECT
      '97' || lpad(CAST(i AS VARCHAR), 20, '0')                                    AS source_policy_no,
      'E2EVIN' || lpad(CAST(i AS VARCHAR), 11, '0')                                AS vehicle_frame_no,
      CAST(DATE '2026-01-15' + INTERVAL (CAST(i AS INT) * 3) DAY AS TIMESTAMP)     AS expiry_date,
      CAST(1 + (i * 3 / 30) % 6 AS BIGINT)                                         AS expiry_month,
      CAST(DATE '2026-01-15' + INTERVAL (CAST(i AS INT) * 3) DAY AS TIMESTAMP)     AS expected_expiry_date,
      ${ORG_LIST}[CAST(i % 3 AS INT) + 1]                                          AS org_level_3,
      ${sqlList(SALESMEN.map((s) => s.team))}[CAST(i % 6 AS INT) + 1]              AS team_name,
      ${FULLNAME_LIST}[CAST(i % 6 AS INT) + 1]                                     AS salesman_name,
      ['非营业个人客车', '营业货车', '非营业货车'][CAST(i % 3 AS INT) + 1]          AS customer_category,
      CASE WHEN i % 2 = 0 THEN '主全' ELSE '交三' END                               AS coverage_combination,
      CASE WHEN i % 6 = 2 THEN '新能源' ELSE '燃油' END                              AS fuel_category,
      i % 6 = 2                                                                     AS is_nev,
      FALSE                                                                         AS is_new_car,
      i % 8 = 3                                                                     AS is_transfer,
      TRUE                                                                          AS is_renewal,
      '非过户'                                                                       AS used_transfer_type,
      '续保'                                                                         AS renewal_type,
      i % 3 = 0                                                                     AS is_renewed,
      CASE WHEN i % 3 = 0 THEN '99' || lpad(CAST(i AS VARCHAR), 20, '0') ELSE NULL END AS renewed_policy_no,
      CASE WHEN i % 3 = 0
        THEN CAST(DATE '2026-01-16' + INTERVAL (CAST(i AS INT) * 3) DAY AS TIMESTAMP)
        ELSE CAST(NULL AS TIMESTAMP) END                                            AS renewed_date,
      CASE WHEN i % 9 = 0 THEN FALSE ELSE i % 2 = 0 END                              AS is_quoted,
      CASE WHEN i % 9 <> 0 AND i % 2 = 0
        THEN CAST(DATE '2026-01-01' + INTERVAL (CAST(i AS INT) * 3) DAY AS TIMESTAMP)
        ELSE CAST(NULL AS TIMESTAMP) END                                             AS first_quote_time,
      CAST(CASE WHEN i % 9 <> 0 AND i % 2 = 0 THEN 1 + i % 3 ELSE 0 END AS BIGINT)   AS quote_count
    FROM range(48) t(i)`;
  await copyTo(renewalSql, 'fact/renewal_tracker/latest.parquet');

  // ── 6. dim/salesman + dim/plan + dim/plate_region ──────────────────────────
  const salesmanRows = SALESMEN.map(
    (s, idx) =>
      `('${s.no}', '${s.name}', '${s.no}${s.name}', '业务员', '${s.team}', '${ORGS[idx % 3]}', '2020-01-01', '在职', NULL, CAST(60 AS BIGINT))`
  ).join(',\n      ');
  const salesmanSql = `
    SELECT * FROM (VALUES
      ${salesmanRows}
    ) AS t(business_no, salesman_name, full_name, position, team, organization, hire_date, status, leave_date, tenure_months)`;
  await copyTo(`SELECT business_no, salesman_name, full_name, position, team, organization, hire_date, CAST(status AS VARCHAR) AS status, CAST(leave_date AS INTEGER) AS leave_date, tenure_months FROM (${salesmanSql})`, 'dim/salesman/latest.parquet');

  const planRows = SALESMEN.map(
    (s, idx) =>
      `(CAST(2026 AS BIGINT), 'salesman', '${s.no}', '${s.name}', '${s.no}${s.name}', '${s.team}', '${ORGS[idx % 3]}', '2020-01-01', 50.0, 10.0, 5.0, 65.0, 30.0, 6.0, 3.0, 39.0)`
  ).join(',\n      ');
  const planSql = `
    SELECT * FROM (VALUES
      ${planRows}
    ) AS t(plan_year, level, business_no, salesman_name, full_name, team, organization, hire_date,
           plan_vehicle, plan_property, plan_personal, plan_total,
           actual_vehicle, actual_property, actual_personal, actual_total)`;
  await copyTo(planSql, 'dim/plan/latest.parquet');

  const plateSql = `
    SELECT * FROM (VALUES
      ('川A', '四川省', '成都市'),
      ('川B', '四川省', '绵阳市'),
      ('川C', '四川省', '自贡市'),
      ('川L', '四川省', '乐山市')
    ) AS t(plate_prefix, province, city)`;
  await copyTo(plateSql, 'dim/plate_region/latest.parquet');

  // ── 7. schema 契约自校验（fields.json 14 必需字段必须全部在 policy 中）─────
  const registry = JSON.parse(fs.readFileSync(FIELDS_JSON, 'utf-8'));
  const fieldList = Array.isArray(registry) ? registry : registry.fields;
  const required = fieldList.filter((f) => f.required);

  const describeReader = await conn.runAndReadAll(
    `DESCRIBE SELECT * FROM read_parquet('${policyPath.replace(/'/g, "''")}')`
  );
  const actualCols = new Map(
    describeReader.getRowObjects().map((r) => [String(r.column_name), String(r.column_type)])
  );

  const TYPE_FAMILY = {
    VARCHAR: ['VARCHAR'],
    DOUBLE: ['DOUBLE', 'DECIMAL', 'FLOAT'],
    DATE: ['DATE', 'TIMESTAMP'],
    BOOLEAN: ['BOOLEAN'],
  };
  const violations = [];
  for (const f of required) {
    const actual = actualCols.get(f.id);
    if (!actual) {
      violations.push(`缺少必需字段: ${f.id}（${f.label}）`);
      continue;
    }
    const family = TYPE_FAMILY[f.dataTypes[0]] ?? [f.dataTypes[0]];
    if (!family.some((t) => actual.toUpperCase().startsWith(t))) {
      violations.push(`字段 ${f.id} 类型不匹配: 期望 ${f.dataTypes[0]} 族，实际 ${actual}`);
    }
  }
  if (violations.length > 0) {
    console.error('[e2e-fixture] ✗ schema 契约校验失败：');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(`[e2e-fixture] ✓ schema 契约校验通过（${required.length}/${required.length} 必需字段）`);

  conn.closeSync?.();
  console.log('[e2e-fixture] 全部完成');
}

main().catch((err) => {
  console.error('[e2e-fixture] 生成失败:', err);
  process.exit(1);
});
