/**
 * 领域断言 — DuckDB 集成测试
 *
 * 用合成数据在 DuckDB 内存实例中执行所有 metric testCase。
 * Layer 2: 需要 DuckDB 原生二进制，仅本地运行。
 *
 * 运行方式：bun run test:integration
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../../../../services/duckdb.js';
import { getAllMetrics } from '../../index.js';
import type { TestAssertion } from '../../types.js';
import { L4_METRIC_IDS, assertSafeWhereClause } from '../test-helpers.js';

/** 需要 CrossSellDailyAgg schema 的指标 */
const CROSS_SELL_IDS = new Set([
  'cross_sell_total_rate', 'cross_sell_danjiao_rate',
  'cross_sell_jiaosan_rate', 'cross_sell_zhuquan_rate',
]);

/** 需要 Growth CTE output schema 的指标 */
const GROWTH_IDS = new Set(['growth_rate_yoy', 'growth_rate_mom']);

// ═══════════════════════════════════════════════════
// 断言执行器
// ═══════════════════════════════════════════════════

function assertTestCase(value: unknown, assertion: TestAssertion, context: string): void {
  if (typeof assertion === 'number') {
    expect(Number(value), `${context}: exact = ${assertion}`).toBe(assertion);
  } else if (assertion.op === 'gt') {
    expect(Number(value), `${context}: > ${assertion.value}`).toBeGreaterThan(assertion.value);
  } else if (assertion.op === 'gte') {
    expect(Number(value), `${context}: >= ${assertion.value}`).toBeGreaterThanOrEqual(assertion.value);
  } else if (assertion.op === 'between') {
    const n = Number(value);
    expect(n, `${context}: >= ${assertion.min}`).toBeGreaterThanOrEqual(assertion.min);
    expect(n, `${context}: <= ${assertion.max}`).toBeLessThanOrEqual(assertion.max);
  } else if (assertion.op === 'type') {
    expect(typeof value, `${context}: type = ${assertion.value}`).toBe(assertion.value);
  } else if (assertion.op === 'notNull') {
    expect(value, `${context}: notNull`).not.toBeNull();
  }
}

// ═══════════════════════════════════════════════════
// 合成数据
// ═══════════════════════════════════════════════════

/** PolicyFact-like 合成数据 — 覆盖 foundation/ratio/cost 所有 requiredColumns */
const SEED_POLICY_DATA = `
CREATE TABLE policy_data (
  premium DOUBLE,
  policy_no VARCHAR,
  org_level_3 VARCHAR,
  salesman_name VARCHAR,
  vehicle_frame_no VARCHAR,
  is_transfer BOOLEAN,
  is_telemarketing BOOLEAN,
  is_renewal BOOLEAN,
  is_nev BOOLEAN,
  is_new_car BOOLEAN,
  is_cross_sell BOOLEAN,
  insurance_type VARCHAR,
  coverage_combination VARCHAR,
  customer_category VARCHAR,
  tonnage_segment VARCHAR,
  reported_claims DOUBLE,
  claim_cases INTEGER,
  fee_amount DOUBLE,
  exposure_days INTEGER,
  earned_days INTEGER,
  policy_term INTEGER
);

INSERT INTO policy_data VALUES
  (5000, 'P001', '成都', '张三', 'VIN001', false, false, true,  false, false, true,  '商业保险', '主全', '非营业个人客车', NULL, 1000, 1, 500, 365, 300, 365),
  (3000, 'P002', '成都', '张三', 'VIN002', true,  true,  false, false, true,  false, '交强险',   '单交', '非营业个人客车', NULL, 0,    0, 300, 365, 365, 365),
  (8000, 'P003', '乐山', '李四', 'VIN003', false, false, true,  true,  false, true,  '商业保险', '交三', '非营业企业客车', NULL, 2000, 2, 800, 366, 200, 366),
  (4000, 'P004', '乐山', '李四', 'VIN004', false, false, false, false, false, false, '交强险',   '单交', '非营业货车',     '2-9吨', 500, 1, 400, 365, 365, 365),
  (6000, 'P005', '天府', '王五', 'VIN005', false, false, true,  false, false, false, '商业保险', '主全', '非营业机关客车', NULL, 3000, 1, 600, 365, 100, 365),
  (2000, 'P006', '天府', '王五', NULL,     false, false, false, false, true,  false, '交强险',   '单交', '摩托车',         NULL, 0,    0, 200, 365, 365, 365),
  (7000, 'P007', '成都', '赵六', 'VIN006', true,  false, false, false, false, true,  '商业保险', '交三', '非营业个人客车', NULL, 1500, 1, 700, 365, 250, 365),
  (1000, 'P008', '乐山', '赵六', 'VIN007', false, true,  true,  false, false, false, '商业保险', '主全', '营业货车',       '1吨以下', 200, 0, 100, 365, 350, 365);
`;

/** CrossSellDailyAgg 合成数据 */
const SEED_CROSS_SELL_DATA = `
CREATE TABLE cross_sell_data (
  auto_count INTEGER,
  driver_count INTEGER,
  danjiao_auto_count INTEGER,
  danjiao_driver_count INTEGER,
  jiaosan_auto_count INTEGER,
  jiaosan_driver_count INTEGER,
  zhuquan_auto_count INTEGER,
  zhuquan_driver_count INTEGER
);

INSERT INTO cross_sell_data VALUES
  (100, 30, 20, 5, 40, 15, 40, 10),
  (50,  20, 10, 3, 20, 8,  20, 9);
`;

/** Growth CTE output 合成数据 */
const SEED_GROWTH_DATA = `
CREATE TABLE growth_data (
  current_value DOUBLE,
  previous_value DOUBLE
);

INSERT INTO growth_data VALUES
  (120000, 100000),
  (80000, 90000);
`;

// ═══════════════════════════════════════════════════
// 测试
// ═══════════════════════════════════════════════════

describe('指标 testCase DuckDB 执行', () => {
  let db: DuckDBService;

  beforeAll(async () => {
    db = createDuckDBService({ path: ':memory:' });
    await db.init();

    // 创建所有合成数据表
    for (const sql of [SEED_POLICY_DATA, SEED_CROSS_SELL_DATA, SEED_GROWTH_DATA]) {
      // 拆分为独立语句执行
      const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await db.query(stmt);
      }
    }
  });

  afterAll(async () => {
    await db.close();
  });

  /** 根据指标 ID 决定查询的表名 */
  function getTableName(metricId: string): string {
    if (CROSS_SELL_IDS.has(metricId)) return 'cross_sell_data';
    if (GROWTH_IDS.has(metricId)) return 'growth_data';
    return 'policy_data';
  }

  // 筛选可执行指标（排除 L4 占位符）
  const executableMetrics = getAllMetrics().filter((m) => !L4_METRIC_IDS.has(m.id));

  for (const metric of executableMetrics) {
    describe(metric.name + ` (${metric.id})`, () => {
      for (const tc of metric.testCases) {
        it(tc.name, async () => {
          assertSafeWhereClause(tc.input.whereClause, `${metric.id}/${tc.name}`);
          const tableName = getTableName(metric.id);
          const sql = `SELECT ${metric.sql.expression} FROM ${tableName} WHERE ${tc.input.whereClause}`;

          const rows = await db.query<Record<string, unknown>>(sql);
          expect(rows.length, `${metric.id} 查询应返回至少 1 行`).toBeGreaterThanOrEqual(1);

          const row = rows[0];
          for (const [field, assertion] of Object.entries(tc.assertions)) {
            assertTestCase(row[field], assertion, `${metric.id}.${field}`);
          }
        });
      }
    });
  }
});
