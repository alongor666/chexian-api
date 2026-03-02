import { describe, expect, it } from 'vitest';
import { generateCrossSellQuery } from '../server/src/sql/cross-sell';
import { generateCrossSellTimePeriodQuery } from '../server/src/sql/cross-sell-summary';
import { generateCrossSellTrendQuery } from '../server/src/sql/cross-sell-trend';
import { generateCrossSellOrgTrendQuery } from '../server/src/sql/cross-sell-org-trend';

describe('cross-sell SQL 兼容交叉销售字段格式', () => {
  it('cross-sell 下钻 SQL 应使用预聚合表并按聚合值求和', () => {
    const sql = generateCrossSellQuery('1=1', [], null);

    expect(sql).toContain('FROM CrossSellDailyAgg');
    expect(sql).toContain('SUM(auto_count)');
    expect(sql).toContain('SUM(driver_count)');
  });

  it('cross-sell 时间维度 SQL 应基于预聚合表计算', () => {
    const sql = generateCrossSellTimePeriodQuery('1=1', 'passenger');

    expect(sql).toContain('FROM CrossSellDailyAgg');
    expect(sql).toContain('SUM(auto_count)');
    expect(sql).toContain('SUM(driver_count)');
    expect(sql).toContain('SUM(driver_premium)');
  });

  it('cross-sell 时间维度环比应使用同天数窗口而非完整上周期', () => {
    const sql = generateCrossSellTimePeriodQuery('1=1', 'passenger');

    expect(sql).toContain('pd >= tp_week - INTERVAL 7 DAY');
    expect(sql).toContain("pd <= tp_week - INTERVAL 7 DAY + DATEDIFF('day', tp_week, tp_max) * INTERVAL 1 DAY");
    expect(sql).toContain('pd >= tp_month - INTERVAL 1 MONTH');
    expect(sql).toContain("pd <= tp_month - INTERVAL 1 MONTH + DATEDIFF('day', tp_month, tp_max) * INTERVAL 1 DAY");
    expect(sql).toContain('pd >= tp_quarter - INTERVAL 3 MONTH');
    expect(sql).toContain("pd <= tp_quarter - INTERVAL 3 MONTH + DATEDIFF('day', tp_quarter, tp_max) * INTERVAL 1 DAY");
    expect(sql).toContain("DATEDIFF('day', tp_week, tp_max)");
    expect(sql).toContain("DATEDIFF('day', tp_month, tp_max)");
    expect(sql).toContain("DATEDIFF('day', tp_quarter, tp_max)");
  });

  it('cross-sell 走势 SQL 应使用签单日期并包含四条线', () => {
    const sql = generateCrossSellTrendQuery('1=1', 'passenger', 'monthly');

    expect(sql).toContain('CAST(policy_date AS DATE) AS pd');
    expect(sql).toContain('FROM CrossSellDailyAgg');
    expect(sql).toContain("'整体' AS coverage_combination");
    expect(sql).toContain("WHERE coverage_combination IN ('主全', '交三', '单交')");
    expect(sql).toContain('time_period');
  });

  it('cross-sell 机构趋势 SQL 的车险件数应按去重保单口径', () => {
    const sql = generateCrossSellOrgTrendQuery('1=1', 'passenger', '主全', 14);

    expect(sql).toContain('COUNT(DISTINCT dedup_key) AS auto_count');
    expect(sql).toContain("NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')");
    expect(sql).toContain("NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')");
    expect(sql).not.toContain("COUNT(DISTINCT CASE WHEN insurance_type LIKE '%商业%' THEN dedup_key END) AS auto_count");
  });
});
