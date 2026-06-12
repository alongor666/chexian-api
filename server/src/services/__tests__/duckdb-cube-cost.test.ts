/**
 * 成本立方体数据级等值集成测试（需 DuckDB 原生二进制，仅本地：bun run test:integration）
 *
 * 同一份合成 PolicyFact（含批改重复行/净额≤0 保单/起保日为空行/未起保保单）+
 * ClaimsAgg（含孤儿赔案），四类成本分析 × 维度 × 筛选 × 截止日组合下，
 * 立方体查询与原路径（B252 去重 + JOIN）逐行逐字段相等。
 * 另验证跨格保单探针的降级路径（exact=false → ensure 返回 'degraded'）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import {
  materializeCostCube,
  ensureCostCubeFresh,
  getCostCubeState,
  resetCostCubeStateForTest,
} from '../duckdb-cube.js';
import { setDataVersion, _resetDataVersionForTesting } from '../data-version.js';
import {
  generateClaimRatioQuery,
  generateExpenseRatioQuery,
  generateComprehensiveCostQuery,
  generateVariableCostQuery,
} from '../../sql/cost/cost-ratios.js';
import {
  generateCostCubeQuery,
  isCostCubeServable,
  type CostCubeAnalysisType,
} from '../../sql/cube/cost-cube.js';
import type { CostAnalysisConfig, CostDimension } from '../../sql/cost/shared.js';
import { diffRows } from '../cube-shadow.js';

let db: DuckDBService;

beforeAll(async () => {
  _resetDataVersionForTesting();
  resetCostCubeStateForTest();
  db = createDuckDBService({ path: ':memory:' });
  await db.init();

  // 起保日横跨 2025-01-01 ~ 2026-06 → 截止日取中段时大量保单未满期、部分未起保（earned_days=0）
  await db.query(`
    CREATE TABLE PolicyFact AS
    SELECT
      'P' || lpad(CAST(i AS VARCHAR), 8, '0') AS policy_no,
      DATE '2025-01-01' + CAST(i % 500 AS INTEGER) AS policy_date,
      DATE '2025-01-01' + CAST(floor(random() * 540) AS INTEGER) AS insurance_start_date,
      'org_' || CAST(i % 8 AS VARCHAR) AS org_level_3,
      CASE i % 4 WHEN 0 THEN '非营业个人客车' WHEN 1 THEN '营业货车' WHEN 2 THEN '非营业货车' ELSE '摩托车' END AS customer_category,
      CASE i % 5 WHEN 0 THEN '主全' WHEN 1 THEN '交三' WHEN 2 THEN '单交' WHEN 3 THEN '主全' ELSE NULL END AS coverage_combination,
      CASE WHEN i % 2 = 0 THEN '交强险' ELSE '商业保险' END AS insurance_type,
      CASE i % 6 WHEN 0 THEN '1吨以下' WHEN 1 THEN '2-9吨' WHEN 2 THEN '10吨以上' ELSE NULL END AS tonnage_segment,
      (i % 2 = 0) AS is_renewal,
      (i % 7 = 0) AS is_new_car,
      (i % 11 = 0) AS is_transfer,
      (i % 5 = 0) AS is_nev,
      (i % 13 = 0) AS is_telemarketing,
      300 + random() * 5000 AS premium,
      CASE WHEN i % 17 = 0 THEN NULL ELSE random() * 300 END AS fee_amount
    FROM range(40000) t(i)
  `);

  // 批改行：同保单号/同起保日/同维度，签单日后移、保费 6%（B252 多行形态）
  await db.query(`
    INSERT INTO PolicyFact
    SELECT policy_no, policy_date + 30, insurance_start_date, org_level_3, customer_category,
           coverage_combination, insurance_type, tonnage_segment,
           is_renewal, is_new_car, is_transfer, is_nev, is_telemarketing,
           premium * 0.06, NULL
    FROM (SELECT * FROM PolicyFact USING SAMPLE 8 PERCENT (bernoulli, 7))
  `);

  // 全额冲销批改：净额 < 0 → HAVING SUM(premium) > 0 两侧同步剔除
  await db.query(`
    INSERT INTO PolicyFact
    SELECT policy_no, policy_date + 45, insurance_start_date, org_level_3, customer_category,
           coverage_combination, insurance_type, tonnage_segment,
           is_renewal, is_new_car, is_transfer, is_nev, is_telemarketing,
           premium * -2, fee_amount
    FROM PolicyFact
    WHERE CAST(substr(policy_no, 2) AS INTEGER) % 211 = 5 AND premium > 0
  `);

  // 起保日为空行：requireStartDate 口径下两侧同步排除
  await db.query(`
    INSERT INTO PolicyFact
    SELECT 'N' || policy_no, policy_date, NULL, org_level_3, customer_category,
           coverage_combination, insurance_type, tonnage_segment,
           is_renewal, is_new_car, is_transfer, is_nev, is_telemarketing,
           premium, fee_amount
    FROM PolicyFact
    WHERE CAST(substr(policy_no, 2) AS INTEGER) % 401 = 7 AND premium > 300
  `);

  // 赔案聚合：约 1/3 保单有赔案 + 一批孤儿赔案（保单表中不存在 → LEFT JOIN 语义）
  await db.query(`
    CREATE TABLE ClaimsAgg AS
    SELECT
      'P' || lpad(CAST(i AS VARCHAR), 8, '0') AS policy_no,
      1 + i % 3 AS claim_cases,
      500 + random() * 20000 AS reported_claims
    FROM range(0, 40500, 3) t(i)
  `);

  setDataVersion('verC-cost-cube-1');
  await materializeCostCube(db);
}, 60_000);

afterAll(async () => {
  try { await db.close(); } catch { /* ignore */ }
  _resetDataVersionForTesting();
  resetCostCubeStateForTest();
});

const LEGACY_GENERATORS: Record<CostCubeAnalysisType, (c: CostAnalysisConfig) => string> = {
  claimRatio: generateClaimRatioQuery,
  expenseRatio: generateExpenseRatioQuery,
  comprehensiveCost: generateComprehensiveCostQuery,
  variableCost: generateVariableCostQuery,
};

/**
 * 两条 SQL 同 ORDER BY SUM(premium) DESC，但两路浮点求和顺序差异可能令
 * 近等总额的组互换行序 —— 比对前按全行内容规范化排序（数值取 10 位有效数字），
 * 校验集合相等，与生产语义一致（前端按 dim_key 消费）。
 */
const canonicalSort = (rows: Array<Record<string, unknown>>) => {
  const key = (r: Record<string, unknown>) =>
    Object.keys(r).sort().map((k) => {
      const v = r[k];
      const n = Number(v);
      return typeof v !== 'object' && v !== null && v !== '' && !Number.isNaN(n)
        ? `${k}=${n.toPrecision(10)}` : `${k}=${String(v)}`;
    }).join('|');
  return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
};

const assertEqual = async (analysisType: CostCubeAnalysisType, config: CostAnalysisConfig) => {
  expect(isCostCubeServable({ whereClause: config.whereClause ?? '1=1', dimension: config.dimension }).servable).toBe(true);
  const legacySql = LEGACY_GENERATORS[analysisType](config);
  const cubeSql = generateCostCubeQuery(analysisType, config);
  const [legacyRows, cubeRows] = await Promise.all([db.query(legacySql), db.query(cubeSql)]);
  expect(legacyRows.length).toBeGreaterThan(0);
  expect(diffRows(canonicalSort(legacyRows), canonicalSort(cubeRows))).toBeNull();
};

describe('成本立方体 物化与状态机', () => {
  it('探针通过（合成数据无跨格保单）→ exact=true，ensure 返回 ready', () => {
    const state = getCostCubeState();
    expect(state.exact).toBe(true);
    expect(state.builtVersion).not.toBeNull();
    expect(ensureCostCubeFresh(db)).toBe('ready');
  });
});

describe('成本立方体 数据级等值（立方体 = 原路径，逐行逐字段）', () => {
  const TYPES: CostCubeAnalysisType[] = ['claimRatio', 'expenseRatio', 'comprehensiveCost', 'variableCost'];
  const DIMENSIONS: CostDimension[] = ['org_level_3', 'customer_category', 'coverage_combination', 'org_customer', 'org_coverage'];

  for (const analysisType of TYPES) {
    for (const dimension of DIMENSIONS) {
      it(`${analysisType} × ${dimension} × 无筛选`, async () => {
        await assertEqual(analysisType, { dimension, cutoffDate: '2025-12-31', whereClause: '1=1' });
      });
    }
  }

  const WHERE_VARIANTS: Array<[string, string]> = [
    ['机构+布尔', "1=1 AND org_level_3 IN ('org_2', 'org_4') AND is_renewal = true"],
    ['类别LIKE+险类', "1=1 AND customer_category LIKE '营业%' AND insurance_type = '商业保险'"],
    ['吨位+险别组合', "1=1 AND tonnage_segment = '2-9吨' AND coverage_combination IS NOT NULL"],
    ['起保日窗', "1=1 AND insurance_start_date >= '2025-04-01' AND insurance_start_date <= '2026-02-28'"],
  ];

  for (const [label, whereClause] of WHERE_VARIANTS) {
    it(`claimRatio × org_level_3 × ${label}`, async () => {
      await assertEqual('claimRatio', { dimension: 'org_level_3', cutoffDate: '2025-12-31', whereClause });
    });
    it(`variableCost × org_customer × ${label}`, async () => {
      await assertEqual('variableCost', { dimension: 'org_customer', cutoffDate: '2025-12-31', whereClause });
    });
  }

  it('任意截止日精确重算（早期/中段/全部满期三个 cutoff）', async () => {
    for (const cutoffDate of ['2025-03-31', '2026-03-31', '2027-12-31']) {
      await assertEqual('claimRatio', { dimension: 'customer_category', cutoffDate, whereClause: '1=1' });
      await assertEqual('comprehensiveCost', { dimension: 'org_level_3', cutoffDate, whereClause: '1=1' });
    }
  });
});

describe('跨格保单探针降级路径', () => {
  it('保单行间机构不一致 → exact=false，ensure 返回 degraded（不建表不重试）', async () => {
    // 注入一张跨格保单（同保单号、同起保日、两个机构）
    await db.query(`
      INSERT INTO PolicyFact
      SELECT 'PIMPURE001', DATE '2025-06-01', DATE '2025-06-01', 'org_1', '营业货车',
             '主全', '商业保险', '2-9吨', false, false, false, false, false, 1000, 10
      UNION ALL
      SELECT 'PIMPURE001', DATE '2025-07-01', DATE '2025-06-01', 'org_2', '营业货车',
             '主全', '商业保险', '2-9吨', false, false, false, false, false, 60, NULL
    `);
    setDataVersion('verD-cost-cube-2');
    resetCostCubeStateForTest();
    await materializeCostCube(db);

    const state = getCostCubeState();
    expect(state.exact).toBe(false);
    expect(ensureCostCubeFresh(db)).toBe('degraded');
  });
});
