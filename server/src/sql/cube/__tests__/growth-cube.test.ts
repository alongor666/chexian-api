/**
 * 增长立方体 SQL 模块单元测试（纯字符串级，CI 可跑）
 * 数据级等值见集成测试 services/__tests__/duckdb-cube-growth.test.ts（仅本地）。
 */
import { describe, expect, it } from 'vitest';
import { isGrowthCubeServable, rewriteGrowthSqlForCube } from '../growth-cube.js';
import { TREND_CUBE_TABLE } from '../trend-cube.js';
import { generateGrowthQuery, generateDailyGrowthWithContextQuery, generateDualMetricComparisonQuery, type GrowthConfig } from '../../growth.js';

const baseConfig = (over: Partial<GrowthConfig>): GrowthConfig => ({
  growthType: 'yoy',
  timeView: 'monthly',
  whereClause: '1=1',
  ...over,
});

describe('isGrowthCubeServable', () => {
  it('白名单指标 + 机构分组 + 立方体内 WHERE → 可服务', () => {
    expect(isGrowthCubeServable({ whereClause: "org_level_3 = '天府'", metric: 'SUM(premium)', groupBy: ['org_level_3'] }).servable).toBe(true);
    expect(isGrowthCubeServable({ whereClause: '1=1', metric: 'COUNT(*)' }).servable).toBe(true);
    expect(isGrowthCubeServable({ whereClause: '1=1' }).servable).toBe(true); // 缺省 = SUM(premium)
  });

  it('业务员分组 / 立方体外列 / 未知指标 → 回退', () => {
    expect(isGrowthCubeServable({ whereClause: '1=1', groupBy: ['salesman_name'] }).servable).toBe(false);
    expect(isGrowthCubeServable({ whereClause: "coverage_combination = '主全'" }).servable).toBe(false);
    expect(isGrowthCubeServable({ whereClause: '1=1', metric: 'COUNT(DISTINCT policy_no)' }).servable).toBe(false);
  });
});

describe('rewriteGrowthSqlForCube（机械替换 + fail-fast）', () => {
  const GROWTH_TYPES: Array<GrowthConfig['growthType']> = ['yoy', 'mom', 'ytd'];
  const METRICS = ['SUM(premium)', 'COUNT(*)'] as const;

  for (const growthType of GROWTH_TYPES) {
    for (const metric of METRICS) {
      it(`${growthType} × ${metric}：零残留`, () => {
        const sql = generateGrowthQuery(baseConfig({ growthType, metric, referenceYear: 2026 }));
        const cube = rewriteGrowthSqlForCube(sql);
        expect(cube).toContain(`FROM ${TREND_CUBE_TABLE}`);
        expect(cube).not.toMatch(/\bPolicyFact\b/);
        expect(cube).not.toMatch(/\bSUM\(premium\)/);
        expect(cube).not.toMatch(/\bCOUNT\(/);
      });
    }
  }

  it('custom 双期对比（双扫模板）：零残留', () => {
    const sql = generateGrowthQuery(baseConfig({
      growthType: 'custom',
      currentPeriod: { startDate: '2026-01-01', endDate: '2026-05-31' },
      baselinePeriod: { startDate: '2025-01-01', endDate: '2025-05-31' },
      groupBy: ['org_level_3'],
    }));
    const cube = rewriteGrowthSqlForCube(sql);
    expect(cube).not.toMatch(/\bPolicyFact\b/);
  });

  it('daily-context（日对比+月度/年度上下文）：零残留', () => {
    const sql = generateDailyGrowthWithContextQuery(baseConfig({
      growthType: 'custom',
      timeView: 'daily',
      currentPeriod: { startDate: '2026-05-01', endDate: '2026-05-31' },
      baselinePeriod: { startDate: '2025-05-01', endDate: '2025-05-31' },
      metric: 'SUM(premium)',
    }));
    const cube = rewriteGrowthSqlForCube(sql);
    expect(cube).not.toMatch(/\bPolicyFact\b/);
  });

  it('dual-metric 含 COUNT(DISTINCT)（去重计数非可加）→ fail-fast 抛错', () => {
    const sql = generateDualMetricComparisonQuery(baseConfig({
      growthType: 'custom',
      currentPeriod: { startDate: '2026-01-01', endDate: '2026-05-31' },
      baselinePeriod: { startDate: '2025-01-01', endDate: '2025-05-31' },
      groupBy: ['org_level_3'],
    }));
    expect(() => rewriteGrowthSqlForCube(sql)).toThrow(/COUNT\(DISTINCT/);
  });
});
