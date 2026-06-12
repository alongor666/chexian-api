import { describe, expect, it } from 'vitest';
import { generateCrossSellQuery } from '../server/src/sql/cross-sell';
import { generateCrossSellTimePeriodQuery } from '../server/src/sql/cross-sell-summary';
import { generateCrossSellTrendQuery } from '../server/src/sql/cross-sell-trend';
import { generateCrossSellOrgTrendQuery } from '../server/src/sql/cross-sell-org-trend';
import { generateCrossSellHeatmapQuery } from '../server/src/sql/cross-sell-heatmap';

describe('cross-sell SQL 兼容交叉销售字段格式', () => {
  it('cross-sell 下钻 SQL 应使用预聚合表并按聚合值求和', () => {
    const sql = generateCrossSellQuery('1=1', [], null);

    expect(sql).toContain('FROM CrossSellDailyAgg');
    // total 汇总用 CASE WHEN 过滤商业险（主全+交三）
    expect(sql).toContain('THEN auto_count ELSE 0 END');
    expect(sql).toContain('THEN driver_count ELSE 0 END');
  });

  it('cross-sell 整体推介率分母应仅含商业险（排除单交）', () => {
    const sql = generateCrossSellQuery('1=1', [], null);

    // total_auto_count/total_driver_count 应排除单交
    expect(sql).toContain("coverage_combination IN ('主全', '交三')");
    // 单交行仍单独统计
    expect(sql).toContain("coverage_combination = '单交'");
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

  it('cross-sell 走势整体线应排除纯交强', () => {
    const sql = generateCrossSellTrendQuery('1=1', 'passenger', 'monthly');

    // total_trend CTE 应过滤 coverage_combination
    const totalTrendMatch = sql.match(/total_trend[\s\S]*?GROUP BY 1/);
    expect(totalTrendMatch).toBeTruthy();
    expect(totalTrendMatch![0]).toContain("coverage_combination IN ('主全', '交三')");
  });

  it('cross-sell 机构趋势 SQL 的车险件数应按去重保单口径', () => {
    const sql = generateCrossSellOrgTrendQuery('1=1', 'passenger', '主全', 14);

    expect(sql).toContain('COUNT(DISTINCT dedup_key) AS auto_count');
    expect(sql).toContain("NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')");
    expect(sql).toContain("NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')");
    expect(sql).not.toContain("COUNT(DISTINCT CASE WHEN insurance_type LIKE '%商业%' THEN dedup_key END) AS auto_count");
  });

  it('cross-sell 机构趋势整体应排除单交', () => {
    const sql = generateCrossSellOrgTrendQuery('1=1', 'passenger', '整体', 14);

    expect(sql).toContain("coverage_combination IN ('主全', '交三')");
    expect(sql).not.toContain("AND coverage_combination = '整体'");
  });

  it('cross-sell 热力图 SQL 在 PolicyFact 分支应按 VIN/保单去重并输出渗透率', () => {
    const sql = generateCrossSellHeatmapQuery('1=1', 'passenger', '', 'month', 'team', []);

    expect(sql).toContain("NULLIF(TRIM(CAST(p.vehicle_frame_no AS VARCHAR)), '')");
    expect(sql).toContain("NULLIF(TRIM(CAST(p.policy_no AS VARCHAR)), '') AS raw_policy_no");
    expect(sql).toContain("COUNT(DISTINCT CASE WHEN coverage_combination IN ('主全', '交三') THEN dedup_key END) AS auto_count");
    expect(sql).toContain("COUNT(DISTINCT CASE WHEN is_cross_sell AND coverage_combination IN ('主全', '交三') THEN dedup_key END) AS driver_count");
    expect(sql).toContain('SUM(commercial_premium) AS commercial_premium');
    expect(sql).toContain('SUM(compulsory_premium) AS compulsory_premium');
    expect(sql).toContain("WHEN coverage_combination = '单交' THEN compulsory_premium");
    expect(sql).toContain("WHEN coverage_combination IN ('交三', '主全') THEN commercial_premium");
    expect(sql).toContain('AS penetration_rate');
  });

  it('cross-sell 热力图 SQL 在聚合表分支应复用商业险/交强险保费原子量', () => {
    const sql = generateCrossSellHeatmapQuery('1=1', 'passenger', '', 'month', 'org_level_3', []);

    expect(sql).toContain('FROM CrossSellDailyAgg');
    expect(sql).toContain('SUM(commercial_premium) AS commercial_premium');
    expect(sql).toContain('SUM(compulsory_premium) AS compulsory_premium');
    expect(sql).toContain('AS penetration_base_premium');
    expect(sql).toContain('AS penetration_rate');
  });

  it('cross-sell 热力图 SQL 应忽略已下线的客户类别下钻维度', () => {
    const sql = generateCrossSellHeatmapQuery(
      '1=1',
      'passenger',
      '',
      'month',
      'org_level_3',
      [{ dimension: 'customer_category' as any, value: '企业客户' }] as any,
    );

    expect(sql).not.toContain("TRIM(CAST(customer_category AS VARCHAR)) = '企业客户'");
    expect(sql).not.toContain("TRIM(CAST(p.customer_category AS VARCHAR)) = '企业客户'");
  });

  it('cross-sell 热力图 business_nature 应与全项目统一为四分类', () => {
    const sql = generateCrossSellHeatmapQuery('1=1', 'passenger', '', 'month', 'business_nature', []);

    expect(sql).toContain("THEN '续保'");
    expect(sql).toContain("THEN '新保'");
    expect(sql).toContain("THEN '过户转保'");
    expect(sql).toContain("ELSE '非过户转保'");
    expect(sql).not.toContain("THEN '过户'");
    expect(sql).not.toContain("THEN '新车'");
    expect(sql).not.toContain("ELSE '转保'");
  });

  it('cross-sell 热力图 business_nature 下钻应支持续保/新保/过户转保', () => {
    const transferSql = generateCrossSellHeatmapQuery(
      '1=1',
      'passenger',
      '',
      'month',
      'business_nature',
      [{ dimension: 'business_nature', value: '过户转保' }]
    );
    expect(transferSql).toContain("COALESCE(CAST(is_transfer AS VARCHAR), '0') IN ('1', 'true', 'TRUE')");
    expect(transferSql).toContain("NOT COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1','true','TRUE')");

    const renewalSql = generateCrossSellHeatmapQuery(
      '1=1',
      'passenger',
      '',
      'month',
      'business_nature',
      [{ dimension: 'business_nature', value: '续保' }]
    );
    expect(renewalSql).toContain("COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE')");

    const newBusinessSql = generateCrossSellHeatmapQuery(
      '1=1',
      'passenger',
      '',
      'month',
      'business_nature',
      [{ dimension: 'business_nature', value: '新保' }]
    );
    expect(newBusinessSql).toContain("COALESCE(CAST(is_new_car AS VARCHAR), '0') IN ('1', 'true', 'TRUE')");
    expect(newBusinessSql).toContain("NOT COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE')");
  });

  it('cross-sell 下钻维度 is_renewal 应显示为 续保/非续保', () => {
    const sql = generateCrossSellQuery('1=1', [], 'is_renewal');

    expect(sql).toContain("THEN '续保' ELSE '非续保' END AS group_name");
  });
});
