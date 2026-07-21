/**
 * SX 计划覆盖范围反例：10 家有计划 + 4 个无计划单元。
 * 真实 DuckDB 结果同时守住：整体不混算、机构逐行取 PlanFact、综合分析同源。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import { generatePremiumPlanDrilldownQuery } from '../../sql/premiumPlan.js';
import { generateComprehensivePlanByOrgQuery } from '../../sql/comprehensive-analysis.js';

interface PlanRow {
  group_name: string;
  plan_vehicle: number | null;
  actual_vehicle: number;
  rate_vehicle: number | null;
}

let db: DuckDBService;
let companyRows: PlanRow[];
let orgRows: PlanRow[];

const PLANNED_ACTUAL = 9848.920434;
const UNPLANNED_ACTUAL = 1102.016087;
const PLAN_TOTAL = 23240;
const TIME_PROGRESS = 201 / 365;

beforeAll(async () => {
  db = createDuckDBService({ path: ':memory:' });
  await db.init();
  await db.query(`
    CREATE TABLE achievement_cache (
      org_name VARCHAR,
      team_name VARCHAR,
      full_name VARCHAR,
      plan_year BIGINT,
      plan_vehicle DOUBLE,
      actual_vehicle DOUBLE,
      time_progress DOUBLE,
      prev_year_actual DOUBLE,
      prev_year_full DOUBLE,
      branch_code VARCHAR
    );
    INSERT INTO achievement_cache
    SELECT
      '计划机构' || CAST(i AS VARCHAR), '团队' || CAST(i AS VARCHAR), '业务员' || CAST(i AS VARCHAR),
      2026, NULL, ${PLANNED_ACTUAL} / 10, ${TIME_PROGRESS}, 0, 0, 'SX'
    FROM range(1, 11) t(i);
    INSERT INTO achievement_cache
    SELECT
      CASE i WHEN 1 THEN '经代' WHEN 2 THEN '车商' WHEN 3 THEN '重客' ELSE '其他' END,
      '未配置团队', '未配置业务员' || CAST(i AS VARCHAR),
      2026, NULL, ${UNPLANNED_ACTUAL} / 4, ${TIME_PROGRESS}, 0, 0, 'SX'
    FROM range(1, 5) t(i);

    CREATE TABLE PlanFact (
      plan_year BIGINT,
      level VARCHAR,
      organization VARCHAR,
      plan_vehicle DOUBLE,
      branch_code VARCHAR
    );
    INSERT INTO PlanFact
    SELECT 2026, 'organization', '计划机构' || CAST(i AS VARCHAR), ${PLAN_TOTAL} / 10, 'SX'
    FROM range(1, 11) t(i);
  `);

  companyRows = await db.query<PlanRow>(generatePremiumPlanDrilldownQuery(
    2026, { level: 'company' }, { enabled: false }, 'actual_vehicle', 'desc',
    undefined, undefined, 'SX', 'SX'
  ));
  orgRows = await db.query<PlanRow>(generatePremiumPlanDrilldownQuery(
    2026, { level: 'org' }, { enabled: false }, 'actual_vehicle', 'desc',
    undefined, undefined, 'SX', 'SX'
  ));
}, 30_000);

afterAll(async () => {
  await db.close();
});

describe('SX 计划覆盖范围 DuckDB 反例', () => {
  it('分公司保费保留 14 个单元全量，但整体计划和达成率为空', () => {
    expect(companyRows).toHaveLength(1);
    expect(companyRows[0].actual_vehicle).toBeCloseTo(PLANNED_ACTUAL + UNPLANNED_ACTUAL, 6);
    expect(companyRows[0].plan_vehicle).toBeNull();
    expect(companyRows[0].rate_vehicle).toBeNull();
  });

  it('只在 10 家有计划机构计算达成率，4 个未配置单元不回退', () => {
    const configured = orgRows.filter((row) => row.plan_vehicle !== null);
    const missing = orgRows.filter((row) => row.plan_vehicle === null);
    expect(configured).toHaveLength(10);
    expect(missing.map((row) => row.group_name).sort()).toEqual(['其他', '经代', '车商', '重客'].sort());
    expect(configured.reduce((sum, row) => sum + Number(row.plan_vehicle), 0)).toBeCloseTo(PLAN_TOTAL, 6);
    expect(missing.every((row) => row.rate_vehicle === null)).toBe(true);
    expect(configured.reduce((sum, row) => sum + row.actual_vehicle, 0) * 100 /
      (PLAN_TOTAL * TIME_PROGRESS)).toBeCloseTo(76.9572, 4);
  });

  it('证明把 4 个无计划单元放进分子会虚高到 85.5681%', () => {
    const mismatched = (PLANNED_ACTUAL + UNPLANNED_ACTUAL) * 100 / (PLAN_TOTAL * TIME_PROGRESS);
    const scoped = PLANNED_ACTUAL * 100 / (PLAN_TOTAL * TIME_PROGRESS);
    expect(mismatched).toBeCloseTo(85.5681, 4);
    expect(mismatched - scoped).toBeCloseTo(8.6109, 4);
  });

  it('保费计划与综合分析逐机构读取同一 PlanFact 值', async () => {
    const comprehensiveRows = await db.query<{ dim_key: string; plan_premium: number }>(
      generateComprehensivePlanByOrgQuery(2026, [], 'SX', 'SX')
    );
    const comprehensiveMap = new Map(comprehensiveRows.map((row) => [row.dim_key, Number(row.plan_premium)]));
    for (const row of orgRows) {
      expect(row.plan_vehicle).toBe(comprehensiveMap.get(row.group_name) ?? null);
    }
  });
});
