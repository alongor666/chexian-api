/**
 * 路由字段图例 SSOT 守卫测试
 *
 * 核心断言：renewal-tracker 输出列 A-E 的中文名 / 口径 / 单位**必须**来自
 * metric-registry 续保域（单一事实源），绑定的每个 metricId 必须可解析。
 * 任何绑定漂移（改名 / 删指标 / 错 id）在此变红，挡住 SSOT 断裂。
 */
import { describe, it, expect } from 'vitest';
import {
  buildRouteLegend,
  hasRouteLegend,
  normalizeRouteKey,
} from '../route-field-legend.js';
import { RENEWAL_OUTPUT_COLUMNS } from '../../sql/renewal-tracker.js';
import { getMetric } from '../metric-registry/index.js';

describe('normalizeRouteKey', () => {
  it('小写 / 中划线 / 前导斜杠 → 大写下划线', () => {
    expect(normalizeRouteKey('renewal-tracker')).toBe('RENEWAL_TRACKER');
    expect(normalizeRouteKey('/renewal-tracker')).toBe('RENEWAL_TRACKER');
    expect(normalizeRouteKey('RENEWAL_TRACKER')).toBe('RENEWAL_TRACKER');
  });
});

describe('RENEWAL_OUTPUT_COLUMNS — SSOT 绑定守卫', () => {
  it('A-E 五列且别名连续', () => {
    expect(RENEWAL_OUTPUT_COLUMNS.map((c) => c.column)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('每个 metricId 在 metric-registry 可解析（漂移即红）', () => {
    for (const b of RENEWAL_OUTPUT_COLUMNS) {
      const metric = getMetric(b.metricId);
      expect(metric, `指标 ${b.metricId}（列 ${b.column}）必须存在于注册表`).toBeDefined();
      expect(metric!.category).toBe('renewal');
    }
  });
});

describe('buildRouteLegend(RENEWAL_TRACKER)', () => {
  it('返回 5 列图例，口径文本逐列等于注册表事实源', () => {
    const legend = buildRouteLegend('RENEWAL_TRACKER');
    expect(legend).not.toBeNull();
    expect(legend!.route).toBe('RENEWAL_TRACKER');
    expect(legend!.columns).toHaveLength(5);

    for (const col of legend!.columns) {
      const metric = getMetric(col.metricId)!;
      // 图例文本不得自创——必须等于注册表派生值（SSOT）
      expect(col.label).toBe(metric.display?.label ?? metric.name);
      expect(col.description).toBe(metric.formula.description);
      expect(col.unit).toBe(metric.formula.unit ?? metric.display?.unit ?? '');
    }
  });

  it('A 列 = 应续件数（renewal_due_count），单位件', () => {
    const legend = buildRouteLegend('RENEWAL_TRACKER')!;
    const a = legend.columns.find((c) => c.column === 'A')!;
    expect(a.metricId).toBe('renewal_due_count');
    expect(a.label).toBe('应续件数');
    expect(a.unit).toBe('件');
    expect(a.description).toContain('应续');
  });

  it('携带路由级时间口径（window + 到期窗口说明）', () => {
    const legend = buildRouteLegend('RENEWAL_TRACKER')!;
    expect(legend.timeWindow).toBe('window');
    expect(legend.timeWindowNote).toContain('到期');
  });

  it('大小写 / 中划线宽容（renewal-tracker 等价）', () => {
    expect(buildRouteLegend('renewal-tracker')?.route).toBe('RENEWAL_TRACKER');
  });
});

describe('buildRouteLegend — 未登记路由', () => {
  it('未登记图例的路由返回 null（非抛错）', () => {
    expect(buildRouteLegend('KPI')).toBeNull();
    expect(buildRouteLegend('NONEXISTENT')).toBeNull();
  });

  it('hasRouteLegend 与 buildRouteLegend 一致', () => {
    expect(hasRouteLegend('RENEWAL_TRACKER')).toBe(true);
    expect(hasRouteLegend('renewal-tracker')).toBe(true);
    expect(hasRouteLegend('KPI')).toBe(false);
  });
});
