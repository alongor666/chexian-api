/**
 * 趋势立方体数据级等值集成测试（需 DuckDB 原生二进制，仅本地：bun run test:integration）
 *
 * 核心断言：对同一份合成 PolicyFact（含批改重复行），任意（时间视图 × 视角 ×
 * 筛选组合 × 分组维度）下，立方体查询与原路径查询逐行逐字段相等。
 * 这是设计文档 §4 阶段 1"影子对账"的离线版本。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import { materializeTrendCube, ensureTrendCubeFresh, isTrendCubeFresh, resetTrendCubeStateForTest, getTrendCubeState } from '../duckdb-cube.js';
import { setDataVersion, _resetDataVersionForTesting } from '../data-version.js';
import { generatePremiumTrendQuery } from '../../sql/trend/premium-trend.js';
import { generatePremiumTrendCubeQuery, isTrendCubeServable } from '../../sql/cube/trend-cube.js';
import { diffRows } from '../cube-shadow.js';
import type { TimeView } from '../../sql/trend/shared.js';

let db: DuckDBService;

beforeAll(async () => {
  _resetDataVersionForTesting();
  resetTrendCubeStateForTest();
  db = createDuckDBService({ path: ':memory:' });
  await db.init();

  // 合成 PolicyFact：6 万原始行（2025-2026 两年 × 8 机构 × 6 类别 × 双险类 × 5 布尔）
  // + 8% 批改重复行（同保单号同签单日，保费 6%）。起保日 = 签单日 + 0..5 天（含跨次月样本）。
  await db.query(`
    CREATE TABLE PolicyFact AS
    WITH cat AS (
      SELECT * FROM (VALUES
        (0,'非营业个人客车'),(1,'非营业企业客车'),(2,'营业货车'),
        (3,'非营业货车'),(4,'摩托车'),(5,'营业客车')
      ) AS t(cid, category)
    ),
    base AS (
      SELECT i,
        'P' || lpad(CAST(i AS VARCHAR), 8, '0') AS policy_no,
        DATE '2025-01-01' + CAST(floor(random() * 525) AS INTEGER) AS policy_date,
        CAST(floor(random() * 8) AS INTEGER) AS org_id,
        CAST(floor(random() * 6) AS INTEGER) AS cid,
        random() AS r1, random() AS r2, random() AS r3,
        300 + random() * 5000 AS premium
      FROM range(60000) t(i)
    )
    SELECT
      b.policy_no,
      b.policy_date,
      b.policy_date + CAST(floor(b.r3 * 6) AS INTEGER) AS insurance_start_date,
      'org_' || CAST(b.org_id AS VARCHAR) AS org_level_3,
      c.category AS customer_category,
      CASE WHEN b.r1 < 0.42 THEN '交强险' ELSE '商业保险' END AS insurance_type,
      (b.r1 < 0.55) AS is_renewal,
      (b.r2 < 0.15) AS is_new_car,
      (b.r2 >= 0.15 AND b.r2 < 0.25) AS is_transfer,
      (b.r3 < 0.18) AS is_nev,
      (b.r3 >= 0.18 AND b.r3 < 0.30) AS is_telemarketing,
      b.premium
    FROM base b JOIN cat c USING (cid)
  `);
  await db.query(`
    INSERT INTO PolicyFact
    SELECT policy_no, policy_date, insurance_start_date, org_level_3, customer_category,
           insurance_type, is_renewal, is_new_car, is_transfer, is_nev, is_telemarketing,
           premium * 0.06
    FROM (SELECT * FROM PolicyFact USING SAMPLE 8 PERCENT (bernoulli, 7))
  `);

  setDataVersion('verA-trend-cube-1');
  await materializeTrendCube(db);
}, 60_000);

afterAll(async () => {
  try { await db.close(); } catch { /* ignore */ }
  _resetDataVersionForTesting();
  resetTrendCubeStateForTest();
});

const TIME_VIEWS: TimeView[] = ['daily', 'weekly', 'monthly'];
const WHERE_VARIANTS: Array<[string, string]> = [
  ['无筛选', '1=1'],
  ['日期窗', "1=1 AND policy_date >= '2026-01-01' AND policy_date <= '2026-05-31'"],
  ['机构多选', "1=1 AND org_level_3 IN ('org_1', 'org_3')"],
  ['类别LIKE+布尔', "1=1 AND customer_category LIKE '营业%' AND is_renewal = true"],
  ['险类+新能源', "1=1 AND insurance_type = '交强险' AND is_nev = false"],
];

describe('趋势立方体 数据级等值（保费视角：立方体 = 原路径，逐行逐字段）', () => {
  for (const tv of TIME_VIEWS) {
    for (const [label, where] of WHERE_VARIANTS) {
      it(`${tv} × premium × ${label}`, async () => {
        expect(isTrendCubeServable(where, 'policy_date', 'premium').servable).toBe(true);
        const groupDim = label === '机构多选' ? 'org_level_3' : "'全部'";
        const legacySql = generatePremiumTrendQuery(tv, where, 'policy_date', 'premium', groupDim);
        const cubeSql = generatePremiumTrendCubeQuery(tv, where, 'policy_date', 'premium', groupDim);
        const [legacyRows, cubeRows] = await Promise.all([
          db.query(legacySql),
          db.query(cubeSql),
        ]);
        expect(legacyRows.length).toBeGreaterThan(0);
        expect(diffRows(legacyRows, cubeRows)).toBeNull();
      });
    }
  }

  it('件数视角（去重计数非可加）判定为不可服务，回退原路径', () => {
    expect(isTrendCubeServable('1=1', 'policy_date', 'policy_count').servable).toBe(false);
  });
});

describe('趋势立方体 新鲜度状态机（结构性规避 B311 竞态）', () => {
  it('构建完成后 fresh；ETL 版本翻新后立即判定 stale 并触发单飞重建', async () => {
    expect(isTrendCubeFresh()).toBe(true);
    expect(ensureTrendCubeFresh(db)).toBe('ready');

    // 模拟 ETL 重载：dataVersion 变化 → 旧立方体立即失效（本次请求应走原路径）
    setDataVersion('verB-trend-cube-2');
    expect(isTrendCubeFresh()).toBe(false);
    expect(ensureTrendCubeFresh(db)).toBe('building');

    // 等待后台单飞重建完成 → 恢复 ready
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (isTrendCubeFresh()) { clearInterval(poll); resolve(); }
      }, 50);
    });
    expect(ensureTrendCubeFresh(db)).toBe('ready');
    expect(getTrendCubeState().lastError).toBeNull();
  }, 30_000);
});
