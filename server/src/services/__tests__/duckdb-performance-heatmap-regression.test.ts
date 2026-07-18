/**
 * PR #81 回溯回归：热力图经营口径必须由真实 DuckDB 结果守护。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePerformanceOrgHeatmapQuery } from '../../sql/performance-heatmap.js';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';

interface HeatmapRow {
  org_level_3: string;
  policy_date: Date | string;
  premium: number;
  plan_premium: number | null;
  achievement_rate: number | null;
  mom_growth_rate: number | null;
}

let db: DuckDBService;
let rows: HeatmapRow[];

beforeAll(async () => {
  db = createDuckDBService({ path: ':memory:' });
  await db.init();
  await db.query(`
    CREATE TABLE PolicyFact (
      policy_date DATE,
      org_level_3 VARCHAR,
      salesman_name VARCHAR,
      policy_no VARCHAR,
      vehicle_frame_no VARCHAR,
      endorsement_no VARCHAR,
      premium DOUBLE,
      commercial_pricing_factor DOUBLE
    );
    INSERT INTO PolicyFact VALUES
      (DATE '2025-12-01', '零业绩机构', '20002李四', 'OLD-B', 'VIN-B', NULL, 5000, 1.0),
      (DATE '2025-12-25', '活跃机构', '10001张三', 'OLD-A', 'VIN-A0', NULL, 5000, 1.0),
      (DATE '2026-01-01', '活跃机构', '10001张三', 'A-1', 'VIN-A1', NULL, 10000, 1.0),
      (DATE '2026-01-01', '活跃机构', '10001张三', 'A-1-E', 'VIN-A1', 'E-1', -2000, 1.0),
      (DATE '2026-01-02', '活跃机构', '10001张三', 'A-2', 'VIN-A2', NULL, 10000, 1.0),
      (DATE '2026-01-15', '活跃机构', '10001张三', 'A-15', 'VIN-A15', NULL, 10000, 1.0);

    CREATE TABLE SalesmanTeamMapping (
      organization VARCHAR,
      team_name VARCHAR,
      full_name VARCHAR,
      car_insurance_plan_2026 DOUBLE
    );
    INSERT INTO SalesmanTeamMapping VALUES
      ('活跃机构', '一队', '10001张三', 365),
      ('零业绩机构', '二队', '20002李四', 365);
  `);

  rows = await db.query<HeatmapRow>(generatePerformanceOrgHeatmapQuery(
    '1=1',
    'all',
    'day',
    15,
    'org_level_3',
  ));
}, 30_000);

afterAll(async () => {
  await db.close();
});

function dateKey(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

describe('performance heatmap 经营口径回归', () => {
  it('计划达成率按单元格截止日的 YTD 实收保费 / 年计划时间进度计算', () => {
    const jan15 = rows.find((row) => row.org_level_3 === '活跃机构' && dateKey(row.policy_date) === '2026-01-15');

    expect(jan15).toBeDefined();
    // YTD 实收 2.8 万；年计划 365 万在 1 月 15 日的进度目标为 15 万。
    expect(jan15!.plan_premium).toBeCloseTo(15, 4);
    expect(jan15!.achievement_rate).toBeCloseTo(18.67, 2);
  });

  it('最近窗口零签单但历史上存在的机构仍返回完整零值日期网格', () => {
    const zeroRows = rows.filter((row) => row.org_level_3 === '零业绩机构');

    expect(zeroRows).toHaveLength(15);
    expect(zeroRows.every((row) => row.premium === 0)).toBe(true);
    expect(dateKey(zeroRows[0].policy_date)).toBe('2026-01-01');
    expect(dateKey(zeroRows[14].policy_date)).toBe('2026-01-15');
  });
});
