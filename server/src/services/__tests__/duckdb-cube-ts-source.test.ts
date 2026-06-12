/**
 * TIMESTAMP 源列等值集成测试（生产形态钉死，需 DuckDB 原生二进制，仅本地）
 *
 * 背景（2026-06-12 生产事故，追踪 issue #608）：生产 ETL（pandas datetime64）把
 * policy_date 落盘为 TIMESTAMP（时分秒恒 00:00:00），而集成测试合成数据用 DATE——
 * 立方体构建时 CAST(policy_date AS DATE) 改变列类型，趋势 daily 的
 * `CAST(policy_date AS VARCHAR)` 在两边输出 '2026-01-01 00:00:00' vs '2026-01-01'
 * → 生产影子对账 trend 12/12 全 mismatch，合成数据（DATE 源）无法复现。
 *
 * 本套件用 TIMESTAMP 源列重建合成数据，钉死"立方体列类型跟随源列"的修复：
 * trend（daily/weekly/monthly，正中生产 warmer 形态）+ growth + salesman 全等值。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import {
  materializeTrendCube,
  materializeSalesmanCube,
  resetTrendCubeStateForTest,
  resetSalesmanCubeStateForTest,
} from '../duckdb-cube.js';
import { setDataVersion, _resetDataVersionForTesting } from '../data-version.js';
import { generatePremiumTrendQuery } from '../../sql/trend/premium-trend.js';
import { rewriteTrendSqlForCube, isTrendCubeServable } from '../../sql/cube/trend-cube.js';
import { generateGrowthQuery, type GrowthConfig } from '../../sql/growth.js';
import { rewriteGrowthSqlForCube } from '../../sql/cube/growth-cube.js';
import { generateSalesmanAllBusinessRankingQuery } from '../../sql/salesman-ranking.js';
import { generateSalesmanRankingCubeQuery } from '../../sql/cube/salesman-cube.js';
import { diffRows } from '../cube-shadow.js';

let db: DuckDBService;

// 生产 warmer 形态：年初至今签单日窗（policy_date 列为 TIMESTAMP）
const WHERE = "1=1 AND policy_date >= '2026-01-01' AND policy_date <= '2026-06-05'";

beforeAll(async () => {
  _resetDataVersionForTesting();
  resetTrendCubeStateForTest();
  resetSalesmanCubeStateForTest();
  db = createDuckDBService({ path: ':memory:' });
  await db.init();

  // ⚠️ policy_date 显式 TIMESTAMP（生产 ETL 形态），时分秒 00:00:00
  await db.query(`
    CREATE TABLE PolicyFact AS
    SELECT
      'P' || lpad(CAST(i AS VARCHAR), 8, '0') AS policy_no,
      CAST(DATE '2025-06-01' + CAST(i % 370 AS INTEGER) AS TIMESTAMP) AS policy_date,
      CAST(DATE '2025-06-01' + CAST(i % 370 AS INTEGER) + CAST(i % 6 AS INTEGER) AS TIMESTAMP) AS insurance_start_date,
      'sales_' || CAST(i % 40 AS VARCHAR) AS salesman_name,
      'org_' || CAST(i % 8 AS VARCHAR) AS org_level_3,
      CASE i % 3 WHEN 0 THEN '非营业个人客车' WHEN 1 THEN '营业货车' ELSE '摩托车' END AS customer_category,
      CASE WHEN i % 2 = 0 THEN '交强险' ELSE '商业保险' END AS insurance_type,
      CASE i % 6 WHEN 0 THEN '1吨以下' WHEN 1 THEN '2-9吨' ELSE NULL END AS tonnage_segment,
      (i % 2 = 0) AS is_renewal, (i % 7 = 0) AS is_new_car, (i % 11 = 0) AS is_transfer,
      (i % 5 = 0) AS is_nev, (i % 13 = 0) AS is_telemarketing,
      500 + random() * 4000 AS premium
    FROM range(60000) t(i)
  `);
  setDataVersion('verTsSource1');
  await materializeTrendCube(db);
  await materializeSalesmanCube(db);
}, 60_000);

afterAll(async () => {
  try { await db.close(); } catch { /* ignore */ }
  _resetDataVersionForTesting();
  resetTrendCubeStateForTest();
  resetSalesmanCubeStateForTest();
});

describe('TIMESTAMP 源列：立方体列类型跟随源（issue #608 生产形态钉死）', () => {
  it('立方体 policy_date 列类型与 PolicyFact 一致（TIMESTAMP）', async () => {
    const [{ t }] = await db.query<{ t: string }>(
      `SELECT typeof(policy_date) AS t FROM CubeTrendDay LIMIT 1`
    );
    expect(t.toUpperCase()).toContain('TIMESTAMP');
  });

  // 生产 warmer 正中形态：daily × premium × 年初至今窗 × org/字面量分组
  for (const granularity of ['daily', 'weekly', 'monthly'] as const) {
    for (const groupDim of ['org_level_3', "'全部'"] as const) {
      it(`trend ${granularity} × groupDim=${groupDim}`, async () => {
        expect(isTrendCubeServable(WHERE, 'policy_date', 'premium').servable).toBe(true);
        const legacySql = generatePremiumTrendQuery(granularity, WHERE, 'policy_date', 'premium', groupDim);
        const cubeSql = rewriteTrendSqlForCube(legacySql);
        const [legacyRows, cubeRows] = await Promise.all([db.query(legacySql), db.query(cubeSql)]);
        expect(legacyRows.length).toBeGreaterThan(0);
        expect(diffRows(legacyRows, cubeRows)).toBeNull();
      });
    }
  }

  it('growth yoy（同窗）', async () => {
    const config: GrowthConfig = {
      growthType: 'yoy', timeView: 'monthly', whereClause: '1=1', metric: 'SUM(premium)', referenceYear: 2026,
    };
    const legacySql = generateGrowthQuery(config);
    const cubeSql = rewriteGrowthSqlForCube(legacySql);
    const [legacyRows, cubeRows] = await Promise.all([db.query(legacySql), db.query(cubeSql)]);
    expect(legacyRows.length).toBeGreaterThan(0);
    expect(diffRows(legacyRows, cubeRows)).toBeNull();
  });

  it('salesman ranking（签单日窗）', async () => {
    const legacySql = generateSalesmanAllBusinessRankingQuery(WHERE, 1000);
    const cubeSql = generateSalesmanRankingCubeQuery('all', WHERE, 1000);
    const [legacyRows, cubeRows] = await Promise.all([db.query(legacySql), db.query(cubeSql)]);
    expect(legacyRows.length).toBeGreaterThan(0);
    const byKey = (rows: Array<Record<string, unknown>>) =>
      [...rows].sort((a, b) =>
        `${String(a.salesman_name)}|${String(a.org_level_3)}`.localeCompare(`${String(b.salesman_name)}|${String(b.org_level_3)}`)
      );
    expect(diffRows(byKey(legacyRows), byKey(cubeRows))).toBeNull();
  });
});
