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
    expect(sql).toContain('salesman_name_short');
    expect(sql).not.toContain('allocated_plan');
  });
});
