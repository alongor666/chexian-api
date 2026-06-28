import { describe, expect, it } from 'vitest';
import {
  generatePerformanceDrilldownQuery,
  generatePerformanceTopSalesmanQuery,
} from '../server/src/sql/performance-analysis';

/**
 * 达成率标准口径（2026-06-11 拍板，注册表 plan_completion_pct v2.0.0）：
 *   达成率 = 年初累计签单保费 ÷（业务员年计划合计 × 时间进度）
 *   - 时间进度锚定数据内最新签单日（period_bounds.current_end），非自然日今天
 *   - 全年天数闰年感知（DATE_DIFF 跨年差值，禁止硬编码 365）
 *   - 废除旧「年计划按当期保费占比分摊再 ÷ 周期数」的均分语义
 */
describe('performance achievement standard caliber sql', () => {
  it('drilldown 达成率使用 年初累计 ÷ (年计划 × 时间进度)，锚定数据内最新签单日', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'org_level_3');

    // 时间进度：doy(current_end) ÷ 闰年感知全年天数
    expect(sql).toContain("EXTRACT('doy' FROM pb.current_end)");
    expect(sql).toContain("DATE_TRUNC('year', pb.current_end) + INTERVAL 1 YEAR");
    // 分子：年初 → 窗口末 的累计保费
    expect(sql).toContain('r.pd >= yb.ytd_start AND r.pd <= yb.ytd_end');
    // 分母：年计划 × 时间进度
    expect(sql).toContain('pl.annual_plan * yb.time_progress');
    // 年计划来自 achievement_cache（与保费看板、报告中心同源）
    expect(sql).toContain('FROM achievement_cache');
  });

  it('drilldown 不再包含周期均分与分摊语义（任何 timePeriod 同一公式）', () => {
    for (const period of ['day', 'week', 'month', 'quarter', 'year'] as const) {
      const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', period, 'mom', [], 'org_level_3');
      expect(sql).not.toContain('allocated_plan');
      expect(sql).not.toContain('/ 365');
      expect(sql).not.toContain('/ 52');
      expect(sql).not.toContain('/ 12)');
      expect(sql).toContain('pl.annual_plan * yb.time_progress');
    }
  });

  it('top-salesman 达成率同口径：年初累计 ÷ (业务员年计划 × 时间进度)', () => {
    const sql = generatePerformanceTopSalesmanQuery('1=1', '1=1', 'all', 'day', 'mom', 20);

    expect(sql).toContain("EXTRACT('doy' FROM pb.current_end)");
    expect(sql).toContain('pl.annual_plan * yb.time_progress');
    // plan join 按带工号 full_name 对齐 PolicyFact.salesman_name（人唯一键），防同名真人合并（2026-06-27 口径修复）
    expect(sql).toContain('full_name');
    expect(sql).not.toContain('salesman_name_short');
    expect(sql).not.toContain('allocated_plan');
  });

  // 2026-06-27 口径修复：业务员聚合键必带工号（人唯一键），防同名不同工号真人合并
  it('业务员聚合键带工号防同名合并 + display 短名两级判重（同机构同名加工号兜底）', () => {
    const top = generatePerformanceTopSalesmanQuery('1=1', '1=1', 'all', 'day', 'mom', 20);
    // 聚合键用带工号 salesman_name（人唯一键），非去工号短名
    expect(top).toContain("COALESCE(p.salesman_name, '未知') AS dimension_name");
    expect(top).toContain('GROUP BY dimension_name');
    expect(top).not.toContain("REGEXP_REPLACE(COALESCE(p.salesman_name, '未知'), '^[0-9]+', '') AS dimension_name");
    // 计划侧 join 带工号 full_name
    expect(top).toContain('GROUP BY full_name');
    // display_name：短名 + 冲突两级判重（同机构同名加工号兜底 REGEXP_EXTRACT）
    expect(top).toContain('display_name');
    expect(top).toContain("REGEXP_EXTRACT(m.dimension_name, '^[0-9]+')");

    // 下钻 salesman 维度聚合键同样带工号
    const drillSalesman = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'day', 'mom', [], 'salesman');
    expect(drillSalesman).toContain("COALESCE(p.salesman_name, '未知') AS group_name");
    expect(drillSalesman).toContain('display_name');

    // 下钻筛选业务员用带工号精确匹配（防命中同名多人）
    const drillStep = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'day', 'mom', [{ dimension: 'salesman', value: '118069129张丽' }], 'org_level_3');
    expect(drillStep).toContain("COALESCE(p.salesman_name, '未知') = '118069129张丽'");
    expect(drillStep).not.toContain("REGEXP_REPLACE(p.salesman_name, '^[0-9]+', '') = '118069129张丽'");
  });
});
