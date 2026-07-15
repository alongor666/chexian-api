import { describe, expect, it } from 'vitest';
import { getMetric, getMetricsByCategory } from '../index.js';

describe('销售队伍业绩指标注册表', () => {
  it('注册独立 sales_team 分类及三个无歧义原子指标', () => {
    const metrics = getMetricsByCategory('sales_team');
    expect(metrics.map((metric) => metric.id)).toEqual([
      'standard_premium',
      'received_premium',
      'sales_team_row_count',
    ]);
    expect(getMetric('sales_team_row_count')?.formula.description).toContain('明细行');
    expect(getMetric('sales_team_row_count')?.sql.expression.trim()).toMatch(/^--/);
  });
});
