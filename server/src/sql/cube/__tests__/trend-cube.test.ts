/**
 * 趋势立方体 SQL 模块单元测试（纯字符串级，CI 可跑，无原生依赖）
 *
 * 等值的数据级验证见集成测试 services/__tests__/duckdb-cube-trend.test.ts（仅本地）。
 */
import { describe, expect, it } from 'vitest';
import {
  TREND_CUBE_TABLE,
  buildTrendCubeSql,
  isTrendCubeServable,
  rewriteTrendSqlForCube,
  generatePremiumTrendCubeQuery,
} from '../trend-cube.js';
import { generatePremiumTrendQuery } from '../../trend/premium-trend.js';
import type { TimeView } from '../../trend/shared.js';

const TIME_VIEWS: TimeView[] = ['daily', 'weekly', 'monthly'];

describe('buildTrendCubeSql', () => {
  it('包含全部粒度维度与可加度量', () => {
    const sql = buildTrendCubeSql(false);
    expect(sql).toContain(`CREATE OR REPLACE TABLE ${TREND_CUBE_TABLE}`);
    expect(sql).toContain(`DATE_TRUNC('month', CAST(insurance_start_date AS DATE))`);
    expect(sql).toContain('SUM(premium) AS premium_sum');
    expect(sql).toContain('COUNT(*) AS row_cnt');
    expect(sql).toContain('GROUP BY ALL');
    expect(sql).not.toContain('branch_code');
  });

  it('branch_code 存在时纳入粒度（多分公司 RLS 条件可下推）', () => {
    expect(buildTrendCubeSql(true)).toContain('branch_code');
  });
});

describe('isTrendCubeServable（WHERE token 白名单）', () => {
  it.each([
    ['1=1'],
    ["policy_date >= '2026-01-01' AND policy_date <= '2026-06-10'"],
    ["org_level_3 IN ('天府', '乐山')"],
    ["customer_category LIKE '营业%' AND is_renewal = true"],
    ["insurance_type = '交强险' AND is_nev = false AND is_telemarketing = true"],
    ["(org_level_3 = '天府') AND branch_code = 'SC'"],
  ])('可服务：%s', (where) => {
    expect(isTrendCubeServable(where, 'policy_date').servable).toBe(true);
  });

  it.each([
    ["salesman_name = '张三'"],                              // 业务员不在立方体粒度
    ["coverage_combination IN ('主全')"],                    // 险别组合
    ["tonnage_segment = '2-9吨'"],                           // 吨位
    ["is_nev = false AND fuel_type LIKE '天然气%'"],         // 燃料（气/油）
    ["vehicle_model LIKE '%货车%'"],                          // 车型快捷筛选
    ["is_commercial_insure = '套单'"],                       // 套单
    ["renewal_mode IS NULL"],                                // 续保模式
  ])('不可服务（白名单外列回退）：%s', (where) => {
    expect(isTrendCubeServable(where, 'policy_date').servable).toBe(false);
  });

  it('dateField=insurance_start_date 回退（立方体起保口径仅月粒度）', () => {
    expect(isTrendCubeServable('1=1', 'insurance_start_date').servable).toBe(false);
  });

  it('引号内的任意值不影响判定（值剥离后再扫 token）', () => {
    expect(isTrendCubeServable("org_level_3 = 'salesman_name 假装是列名'", 'policy_date').servable).toBe(true);
  });
});

describe('rewriteTrendSqlForCube', () => {
  it.each(TIME_VIEWS)('保费视角 %s：行级度量全部替换为预聚合度量', (tv) => {
    const legacy = generatePremiumTrendQuery(tv, '1=1', 'policy_date', 'premium', 'org_level_3');
    const cube = rewriteTrendSqlForCube(legacy);
    expect(cube).toContain(`FROM ${TREND_CUBE_TABLE}`);
    expect(cube).not.toMatch(/\bPolicyFact\b/);
    expect(cube).toContain('SUM(premium_sum)');
    expect(cube).toContain('THEN premium_sum');
    expect(cube).not.toMatch(/\bSUM\(premium\)/);
    expect(cube).not.toMatch(/\bTHEN premium\b/);
  });

  it.each(TIME_VIEWS)('件数视角 %s：COUNT 全部替换为 SUM(row_cnt)', (tv) => {
    const legacy = generatePremiumTrendQuery(tv, '1=1', 'policy_date', 'policy_count', 'org_level_3');
    const cube = rewriteTrendSqlForCube(legacy);
    expect(cube).toContain('SUM(row_cnt)');
    expect(cube).toContain('THEN row_cnt ELSE 0 END)');
    expect(cube).not.toMatch(/\bCOUNT\(/);
  });

  it('模板漂移 fail-fast：意外 SQL 形态抛错而非静默产出', () => {
    expect(() => rewriteTrendSqlForCube('SELECT COUNT(*) FROM PolicyFact UNION SELECT COUNT(*) FROM PolicyFact'))
      .toThrow(/改写断言失败/);
  });

  it('generatePremiumTrendCubeQuery 与原生成器同参可直接生成', () => {
    const sql = generatePremiumTrendCubeQuery('weekly', "org_level_3 = '天府'", 'policy_date', 'premium', "'全部'");
    expect(sql).toContain(`FROM ${TREND_CUBE_TABLE}`);
    expect(sql).toContain("org_level_3 = '天府'");
  });
});
