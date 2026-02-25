import { describe, expect, it } from 'vitest';
import { generateCrossSellQuery } from '../server/src/sql/cross-sell';
import { generateCrossSellTimePeriodQuery } from '../server/src/sql/cross-sell-summary';
import { generateCrossSellTrendQuery } from '../server/src/sql/cross-sell-trend';

describe('cross-sell SQL 兼容交叉销售字段格式', () => {
  it('cross-sell 下钻 SQL 应包含兼容判定表达式', () => {
    const sql = generateCrossSellQuery('1=1', [], null);

    expect(sql).toContain('TRY_CAST(is_cross_sell AS BOOLEAN)');
    expect(sql).toContain("IN ('1', 'y', 'yes', 'true', 't', '是')");
    expect(sql).toContain('vehicle_frame_no');
    expect(sql).toContain('COUNT(DISTINCT COALESCE(');
  });

  it('cross-sell 时间维度 SQL 应包含兼容判定表达式', () => {
    const sql = generateCrossSellTimePeriodQuery('1=1', 'passenger');

    expect(sql).toContain('TRY_CAST(is_cross_sell AS BOOLEAN)');
    expect(sql).toContain("IN ('1', 'y', 'yes', 'true', 't', '是')");
    expect(sql).toContain('AS dedup_key');
    expect(sql).toContain('COUNT(DISTINCT dedup_key)');
  });

  it('cross-sell 走势 SQL 应使用签单日期并包含四条线', () => {
    const sql = generateCrossSellTrendQuery('1=1', 'passenger', 'monthly');

    expect(sql).toContain('CAST(policy_date AS DATE) AS pd');
    expect(sql).toContain("'整体' AS coverage_combination");
    expect(sql).toContain("WHERE coverage_combination IN ('主全', '交三', '单交')");
    expect(sql).toContain('time_period');
  });
});
