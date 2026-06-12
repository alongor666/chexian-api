/**
 * 增长立方体数据级等值集成测试（需 DuckDB 原生二进制，仅本地：bun run test:integration）
 *
 * 同一份合成 PolicyFact（含批改重复行），yoy/mom/ytd/custom/daily-context ×
 * 指标 × 筛选组合下，立方体查询与原路径查询逐行逐字段相等。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import { materializeTrendCube, resetTrendCubeStateForTest } from '../duckdb-cube.js';
import { setDataVersion, _resetDataVersionForTesting } from '../data-version.js';
import { generateGrowthQuery, generateDailyGrowthWithContextQuery, type GrowthConfig } from '../../sql/growth.js';
import { isGrowthCubeServable, rewriteGrowthSqlForCube } from '../../sql/cube/growth-cube.js';
import { diffRows } from '../cube-shadow.js';

let db: DuckDBService;

beforeAll(async () => {
  _resetDataVersionForTesting();
  resetTrendCubeStateForTest();
  db = createDuckDBService({ path: ':memory:' });
  await db.init();

  await db.query(`
    CREATE TABLE PolicyFact AS
    SELECT
      'P' || lpad(CAST(i AS VARCHAR), 8, '0') AS policy_no,
      DATE '2025-01-01' + CAST(floor(random() * 525) AS INTEGER) AS policy_date,
      DATE '2025-01-01' + CAST(floor(random() * 525) AS INTEGER) + CAST(i % 6 AS INTEGER) AS insurance_start_date,
      'org_' || CAST(i % 8 AS VARCHAR) AS org_level_3,
      CASE i % 4 WHEN 0 THEN '非营业个人客车' WHEN 1 THEN '营业货车' WHEN 2 THEN '非营业货车' ELSE '摩托车' END AS customer_category,
      CASE WHEN i % 2 = 0 THEN '交强险' ELSE '商业保险' END AS insurance_type,
      (i % 2 = 0) AS is_renewal,
      (i % 7 = 0) AS is_new_car,
      (i % 11 = 0) AS is_transfer,
      (i % 5 = 0) AS is_nev,
      (i % 13 = 0) AS is_telemarketing,
      300 + random() * 5000 AS premium
    FROM range(50000) t(i)
  `);
  await db.query(`
    INSERT INTO PolicyFact
    SELECT policy_no, policy_date, insurance_start_date, org_level_3, customer_category,
           insurance_type, is_renewal, is_new_car, is_transfer, is_nev, is_telemarketing,
           premium * 0.06
    FROM (SELECT * FROM PolicyFact USING SAMPLE 8 PERCENT (bernoulli, 7))
  `);
  setDataVersion('verG-growth-cube');
  await materializeTrendCube(db);
}, 60_000);

afterAll(async () => {
  try { await db.close(); } catch { /* ignore */ }
  _resetDataVersionForTesting();
  resetTrendCubeStateForTest();
});

const WHERE_VARIANTS: Array<[string, string]> = [
  ['无筛选', '1=1'],
  ['机构+布尔', "1=1 AND org_level_3 IN ('org_2', 'org_4') AND is_renewal = true"],
  ['类别LIKE', "1=1 AND customer_category LIKE '营业%'"],
];

/**
 * growth 模板只 ORDER BY time_period，带 groupBy 时同期多机构的行序非确定
 * （原路径自身两次执行也可能不同序）。比对前按 (time_period, org_level_3, dim_key)
 * 规范化排序 —— 校验的是集合相等，与生产语义一致（前端按 key 消费）。
 */
const canonicalSort = (rows: Array<Record<string, unknown>>) => {
  // 全行内容做排序键（yoy 的 FULL OUTER JOIN 会产生同 (期间, 机构) 两行：
  // 仅当期行 + 仅基期行，必须用完整内容消除平局）；数值取 10 位有效数字，
  // 消除立方体与原路径浮点求和顺序差异
  const key = (r: Record<string, unknown>) =>
    Object.keys(r).sort().map((k) => {
      const v = r[k];
      const n = Number(v);
      return typeof v !== 'object' && v !== null && v !== '' && !Number.isNaN(n)
        ? `${k}=${n.toPrecision(10)}` : `${k}=${String(v)}`;
    }).join('|');
  return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
};

const assertEqual = async (legacySql: string, cubeSql: string) => {
  const [legacyRows, cubeRows] = await Promise.all([db.query(legacySql), db.query(cubeSql)]);
  expect(legacyRows.length).toBeGreaterThan(0);
  expect(diffRows(canonicalSort(legacyRows), canonicalSort(cubeRows))).toBeNull();
};

describe('增长立方体 数据级等值（立方体 = 原路径，逐行逐字段）', () => {
  for (const growthType of ['yoy', 'mom', 'ytd'] as const) {
    for (const metric of ['SUM(premium)', 'COUNT(*)'] as const) {
      for (const [label, whereClause] of WHERE_VARIANTS) {
        it(`${growthType} × ${metric} × ${label}`, async () => {
          expect(isGrowthCubeServable({ whereClause, metric }).servable).toBe(true);
          const config: GrowthConfig = {
            growthType, timeView: 'monthly', whereClause, metric, referenceYear: 2026,
            groupBy: label === '机构+布尔' ? ['org_level_3'] : [],
          };
          const legacySql = generateGrowthQuery(config);
          await assertEqual(legacySql, rewriteGrowthSqlForCube(legacySql));
        });
      }
    }
  }

  it('custom 双期对比 × 机构分组', async () => {
    const config: GrowthConfig = {
      growthType: 'custom', timeView: 'daily', whereClause: '1=1',
      currentPeriod: { startDate: '2026-01-01', endDate: '2026-05-31' },
      baselinePeriod: { startDate: '2025-01-01', endDate: '2025-05-31' },
      groupBy: ['org_level_3'],
    };
    const legacySql = generateGrowthQuery(config);
    await assertEqual(legacySql, rewriteGrowthSqlForCube(legacySql));
  });

  it('daily-context 日对比（保费 + 件数两种指标）', async () => {
    for (const metric of ['SUM(premium)', 'COUNT(*)'] as const) {
      const config: GrowthConfig = {
        growthType: 'custom', timeView: 'daily', whereClause: "1=1 AND insurance_type = '交强险'",
        currentPeriod: { startDate: '2026-05-01', endDate: '2026-05-31' },
        baselinePeriod: { startDate: '2025-05-01', endDate: '2025-05-31' },
        metric,
      };
      const legacySql = generateDailyGrowthWithContextQuery(config);
      await assertEqual(legacySql, rewriteGrowthSqlForCube(legacySql));
    }
  });
});
