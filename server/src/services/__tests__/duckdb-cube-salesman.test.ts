/**
 * 业务员立方体数据级等值集成测试（需 DuckDB 原生二进制，仅本地：bun run test:integration）
 *
 * 同一份合成 PolicyFact（含批改重复行——本立方体度量为行级可加，批改行原样计入），
 * 全部业务/优质业务两类排名 × 筛选组合下，立方体查询与原路径逐行逐字段相等
 * （排名 = 序敏感输出，直接按返回行序比对，不做规范化排序）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import {
  materializeSalesmanCube,
  ensureSalesmanCubeFresh,
  resetSalesmanCubeStateForTest,
} from '../duckdb-cube.js';
import { setDataVersion, _resetDataVersionForTesting } from '../data-version.js';
import {
  generateSalesmanAllBusinessRankingQuery,
  generateSalesmanQualityBusinessRankingQuery,
} from '../../sql/salesman-ranking.js';
import {
  generateSalesmanRankingCubeQuery,
  isSalesmanCubeServable,
} from '../../sql/cube/salesman-cube.js';
import { diffRows } from '../cube-shadow.js';

let db: DuckDBService;

beforeAll(async () => {
  _resetDataVersionForTesting();
  resetSalesmanCubeStateForTest();
  db = createDuckDBService({ path: ':memory:' });
  await db.init();

  await db.query(`
    CREATE TABLE PolicyFact AS
    SELECT
      'P' || lpad(CAST(i AS VARCHAR), 8, '0') AS policy_no,
      DATE '2025-06-01' + CAST(i % 370 AS INTEGER) AS policy_date,
      DATE '2025-06-01' + CAST(i % 370 AS INTEGER) + CAST(i % 6 AS INTEGER) AS insurance_start_date,
      'sales_' || CAST(i % 60 AS VARCHAR) AS salesman_name,
      'org_' || CAST(i % 8 AS VARCHAR) AS org_level_3,
      CASE i % 5
        WHEN 0 THEN '非营业个人客车' WHEN 1 THEN '营业货车' WHEN 2 THEN '非营业货车'
        WHEN 3 THEN '非营业企业客车' ELSE '摩托车' END AS customer_category,
      CASE WHEN i % 2 = 0 THEN '交强险' ELSE '商业保险' END AS insurance_type,
      CASE i % 6 WHEN 0 THEN '1吨以下' WHEN 1 THEN '2-9吨' WHEN 2 THEN '10吨以上' ELSE NULL END AS tonnage_segment,
      (i % 2 = 0) AS is_renewal,
      (i % 7 = 0) AS is_new_car,
      (i % 11 = 0) AS is_transfer,
      (i % 5 = 0) AS is_nev,
      (i % 13 = 0) AS is_telemarketing,
      300 + random() * 5000 AS premium
    FROM range(50000) t(i)
  `);
  // 批改行（行级可加：原样计入 COUNT(*) 与 SUM，两侧同义）
  await db.query(`
    INSERT INTO PolicyFact
    SELECT policy_no, policy_date, insurance_start_date, salesman_name, org_level_3,
           customer_category, insurance_type, tonnage_segment,
           is_renewal, is_new_car, is_transfer, is_nev, is_telemarketing,
           premium * 0.06
    FROM (SELECT * FROM PolicyFact USING SAMPLE 8 PERCENT (bernoulli, 7))
  `);
  setDataVersion('verS-salesman-cube');
  await materializeSalesmanCube(db);
}, 60_000);

afterAll(async () => {
  try { await db.close(); } catch { /* ignore */ }
  _resetDataVersionForTesting();
  resetSalesmanCubeStateForTest();
});

const WHERE_VARIANTS: Array<[string, string]> = [
  ['无筛选', '1=1'],
  ['机构+布尔', "1=1 AND org_level_3 IN ('org_2', 'org_4') AND is_renewal = true"],
  ['签单日窗', "1=1 AND policy_date >= '2025-09-01' AND policy_date <= '2026-03-31'"],
  ['类别LIKE+险类', "1=1 AND customer_category LIKE '非营业%' AND insurance_type = '商业保险'"],
  ['业务员IN', "1=1 AND salesman_name IN ('sales_3', 'sales_17', 'sales_42')"],
];

/**
 * 排名是序敏感输出（ORDER BY total_premium DESC + LIMIT），但近等总额的并列名次
 * 在两路浮点求和顺序差异下可能互换行序。比对前按 (业务员, 机构) 复合键排序 ——
 * 校验集合相等；总额本身在 diffRows 的相对容差内逐字段核验。
 */
const byKey = (rows: Array<Record<string, unknown>>) =>
  [...rows].sort((a, b) =>
    `${String(a.salesman_name)}|${String(a.org_level_3)}`.localeCompare(
      `${String(b.salesman_name)}|${String(b.org_level_3)}`
    )
  );

describe('业务员立方体 物化与状态机', () => {
  it('构建完成 → ensure 返回 ready', () => {
    expect(ensureSalesmanCubeFresh(db)).toBe('ready');
  });
});

describe('业务员立方体 数据级等值（立方体 = 原路径，逐行逐字段）', () => {
  for (const rankingType of ['all', 'quality'] as const) {
    for (const [label, whereClause] of WHERE_VARIANTS) {
      it(`${rankingType} × ${label}`, async () => {
        expect(isSalesmanCubeServable(whereClause).servable).toBe(true);
        // LIMIT 取大于全组合数 → 全量逐行比对，排序并列不影响集合校验
        const legacySql = rankingType === 'all'
          ? generateSalesmanAllBusinessRankingQuery(whereClause, 1000)
          : generateSalesmanQualityBusinessRankingQuery(whereClause, 1000);
        const cubeSql = generateSalesmanRankingCubeQuery(rankingType, whereClause, 1000);
        const [legacyRows, cubeRows] = await Promise.all([db.query(legacySql), db.query(cubeSql)]);
        expect(legacyRows.length).toBeGreaterThan(0);
        expect(diffRows(byKey(legacyRows), byKey(cubeRows))).toBeNull();
      });
    }
  }

  it('TopN 截断（LIMIT 10）：名次集合一致', async () => {
    const legacySql = generateSalesmanAllBusinessRankingQuery('1=1', 10);
    const cubeSql = generateSalesmanRankingCubeQuery('all', '1=1', 10);
    const [legacyRows, cubeRows] = await Promise.all([db.query(legacySql), db.query(cubeSql)]);
    expect(legacyRows.length).toBe(10);
    expect(diffRows(byKey(legacyRows), byKey(cubeRows))).toBeNull();
  });
});
