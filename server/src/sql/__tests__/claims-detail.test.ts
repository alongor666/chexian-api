import { describe, expect, it } from 'vitest';
import {
  generatePendingOverviewQuery,
  generatePendingByOrgQuery,
  generatePendingAgingQuery,
  generateCauseAnalysisQuery,
  generateGeoRiskByAccidentQuery,
  generateGeoRiskByPlateQuery,
  generateGeoComparisonQuery,
  generateClaimCycleQuery,
  generateLossRatioDevelopmentQuery,
  generateFrequencyYoyQuery,
  type ClaimsDetailFilters,
} from '../claims-detail.js';

// ── 共享配置 ──

const EMPTY_FILTERS: ClaimsDetailFilters = {};

const FULL_FILTERS: ClaimsDetailFilters = {
  dateStart: '2025-01-01',
  dateEnd: '2025-12-31',
  orgName: '天府',
  claimStatus: '未业务结案',
  isBodilyInjury: 'true',
  accidentCause: '碰撞',
  accidentCity: '成都市',
  customerCategory: '非营业个人客车',
  isNev: '1',
  coverageCombination: '主全',
  isTransfer: 'false',
  businessNature: 'non_commercial',
  isNewCar: 'false',
  isRenewal: 'true',
};

// ═══════════════════════════════════════════════════
// 1. generatePendingOverviewQuery — 未决赔案概览
// ═══════════════════════════════════════════════════

describe('generatePendingOverviewQuery', () => {
  it('基本结构：SELECT FROM ClaimsDetail + PolicyFact JOIN', () => {
    const sql = generatePendingOverviewQuery(EMPTY_FILTERS);
    expect(sql).toContain('FROM ClaimsDetail c');
    expect(sql).toContain('JOIN PolicyFact p ON c.policy_no = p.policy_no');
    expect(sql).toContain('GROUP BY c.claim_status');
  });

  it('输出列完整性：统计量 + 金额 + 人伤 + 三分项', () => {
    const sql = generatePendingOverviewQuery(EMPTY_FILTERS);
    expect(sql).toContain('c.claim_status');
    expect(sql).toContain('COUNT(*) AS cases');
    expect(sql).toContain('reserve_wan');
    expect(sql).toContain('avg_reserve');
    expect(sql).toContain('injury_cases');
    expect(sql).toContain('injury_reserve_wan');
    expect(sql).toContain('bodily_wan');
    expect(sql).toContain('vehicle_wan');
    expect(sql).toContain('property_wan');
  });

  it('万元换算：/ 1e4', () => {
    const sql = generatePendingOverviewQuery(EMPTY_FILTERS);
    expect(sql).toContain('/ 1e4');
  });

  it('空过滤器：WHERE 1=1（无额外条件）', () => {
    const sql = generatePendingOverviewQuery(EMPTY_FILTERS);
    expect(sql).toContain('WHERE 1=1');
  });

  it('dateStart 过滤注入', () => {
    const sql = generatePendingOverviewQuery({ dateStart: '2025-01-01' });
    expect(sql).toContain("c.accident_time >= '2025-01-01'");
  });

  it('dateEnd 过滤注入：自动追加 23:59:59', () => {
    const sql = generatePendingOverviewQuery({ dateEnd: '2025-12-31' });
    expect(sql).toContain("c.accident_time <= '2025-12-31 23:59:59'");
  });

  it('claimStatus 过滤注入（赔案级）', () => {
    const sql = generatePendingOverviewQuery({ claimStatus: '已业务结案' });
    expect(sql).toContain("c.claim_status = '已业务结案'");
  });

  it('isBodilyInjury true 转换为布尔', () => {
    const sql = generatePendingOverviewQuery({ isBodilyInjury: 'true' });
    expect(sql).toContain('c.is_bodily_injury = true');
  });

  it('isBodilyInjury false 转换为布尔', () => {
    const sql = generatePendingOverviewQuery({ isBodilyInjury: 'false' });
    expect(sql).toContain('c.is_bodily_injury = false');
  });

  it('accidentCause 过滤注入', () => {
    const sql = generatePendingOverviewQuery({ accidentCause: '碰撞' });
    expect(sql).toContain("c.accident_cause = '碰撞'");
  });

  it('accidentCity 过滤注入', () => {
    const sql = generatePendingOverviewQuery({ accidentCity: '成都市' });
    expect(sql).toContain("c.accident_city = '成都市'");
  });

  it('orgName 保单级过滤（p.org_level_3）', () => {
    const sql = generatePendingOverviewQuery({ orgName: '天府' });
    expect(sql).toContain("p.org_level_3 = '天府'");
  });

  it('customerCategory 保单级过滤', () => {
    const sql = generatePendingOverviewQuery({ customerCategory: '非营业个人客车' });
    expect(sql).toContain("p.customer_category = '非营业个人客车'");
  });

  it('isNev=1 过滤为 p.is_nev = true', () => {
    const sql = generatePendingOverviewQuery({ isNev: '1' });
    expect(sql).toContain('p.is_nev = true');
  });

  it('isNev=0 过滤为 p.is_nev = false', () => {
    const sql = generatePendingOverviewQuery({ isNev: '0' });
    expect(sql).toContain('p.is_nev = false');
  });

  it('isNev=true 也可触发新能源过滤', () => {
    const sql = generatePendingOverviewQuery({ isNev: 'true' });
    expect(sql).toContain('p.is_nev = true');
  });

  it('isTransfer=true 过滤', () => {
    const sql = generatePendingOverviewQuery({ isTransfer: 'true' });
    expect(sql).toContain('p.is_transfer = true');
  });

  it('isTransfer=false 过滤', () => {
    const sql = generatePendingOverviewQuery({ isTransfer: 'false' });
    expect(sql).toContain('p.is_transfer = false');
  });

  it('isNewCar=true 过滤', () => {
    const sql = generatePendingOverviewQuery({ isNewCar: 'true' });
    expect(sql).toContain('p.is_new_car = true');
  });

  it('isRenewal=true 过滤', () => {
    const sql = generatePendingOverviewQuery({ isRenewal: 'true' });
    expect(sql).toContain('p.is_renewal = true');
  });

  it('coverageCombination 过滤注入', () => {
    const sql = generatePendingOverviewQuery({ coverageCombination: '主全' });
    expect(sql).toContain("p.coverage_combination = '主全'");
  });

  it('businessNature=commercial 映射为 LIKE 营业%', () => {
    const sql = generatePendingOverviewQuery({ businessNature: 'commercial' });
    expect(sql).toContain("p.customer_category LIKE '营业%'");
  });

  it('businessNature=non_commercial 映射为 LIKE 非营业%', () => {
    const sql = generatePendingOverviewQuery({ businessNature: 'non_commercial' });
    expect(sql).toContain("p.customer_category LIKE '非营业%'");
  });

  it('全量过滤器组合生成有效 SQL', () => {
    const sql = generatePendingOverviewQuery(FULL_FILTERS);
    expect(sql.length).toBeGreaterThan(100);
    expect(sql).toContain('FROM ClaimsDetail c');
  });
});

// ═══════════════════════════════════════════════════
// 2. generatePendingByOrgQuery — 未决机构分布
// ═══════════════════════════════════════════════════

describe('generatePendingByOrgQuery', () => {
  it('强制注入 claimStatus=未业务结案', () => {
    // 即使 filters 没传 claimStatus，查询也硬编码了"未业务结案"
    const sql = generatePendingByOrgQuery(EMPTY_FILTERS);
    expect(sql).toContain("c.claim_status = '未业务结案'");
  });

  it('输出机构维度 + 账龄字段', () => {
    const sql = generatePendingByOrgQuery(EMPTY_FILTERS);
    expect(sql).toContain('p.org_level_3 AS org');
    expect(sql).toContain('COUNT(*) AS cases');
    expect(sql).toContain('reserve_wan');
    expect(sql).toContain('avg_reserve');
    expect(sql).toContain('injury_cases');
    expect(sql).toContain('avg_pending_days');
    expect(sql).toContain('max_pending_days');
  });

  it('账龄用 DATEDIFF day accent_time → CURRENT_DATE', () => {
    const sql = generatePendingByOrgQuery(EMPTY_FILTERS);
    expect(sql).toContain("DATEDIFF('day', c.accident_time, CURRENT_DATE)");
  });

  it('按 reserve_wan 降序排列', () => {
    const sql = generatePendingByOrgQuery(EMPTY_FILTERS);
    expect(sql).toContain('ORDER BY reserve_wan DESC');
  });

  it('GROUP BY p.org_level_3', () => {
    const sql = generatePendingByOrgQuery(EMPTY_FILTERS);
    expect(sql).toContain('GROUP BY p.org_level_3');
  });

  it('orgName 过滤传入时正确注入', () => {
    const sql = generatePendingByOrgQuery({ orgName: '乐山' });
    expect(sql).toContain("p.org_level_3 = '乐山'");
  });
});

// ═══════════════════════════════════════════════════
// 3. generatePendingAgingQuery — 账龄分布
// ═══════════════════════════════════════════════════

describe('generatePendingAgingQuery', () => {
  it('强制注入 claimStatus=未业务结案', () => {
    const sql = generatePendingAgingQuery(EMPTY_FILTERS);
    expect(sql).toContain("c.claim_status = '未业务结案'");
  });

  it('5个账龄桶完整', () => {
    const sql = generatePendingAgingQuery(EMPTY_FILTERS);
    expect(sql).toContain("'0-30天'");
    expect(sql).toContain("'31-90天'");
    expect(sql).toContain("'91-180天'");
    expect(sql).toContain("'181-365天'");
    expect(sql).toContain("'365天+'");
  });

  it('sort_order 字段用于排序', () => {
    const sql = generatePendingAgingQuery(EMPTY_FILTERS);
    expect(sql).toContain('sort_order');
    expect(sql).toContain('ORDER BY sort_order');
  });

  it('输出 cases + reserve_wan + injury_cases', () => {
    const sql = generatePendingAgingQuery(EMPTY_FILTERS);
    expect(sql).toContain('COUNT(*) AS cases');
    expect(sql).toContain('reserve_wan');
    expect(sql).toContain('injury_cases');
  });

  it('GROUP BY aging_bucket, sort_order', () => {
    const sql = generatePendingAgingQuery(EMPTY_FILTERS);
    expect(sql).toContain('GROUP BY aging_bucket, sort_order');
  });

  it('DATEDIFF 天数阈值：30/90/180/365', () => {
    const sql = generatePendingAgingQuery(EMPTY_FILTERS);
    expect(sql).toContain('<= 30');
    expect(sql).toContain('<= 90');
    expect(sql).toContain('<= 180');
    expect(sql).toContain('<= 365');
  });
});

// ═══════════════════════════════════════════════════
// 4. generateCauseAnalysisQuery — 出险原因分析
// ═══════════════════════════════════════════════════

describe('generateCauseAnalysisQuery', () => {
  it('按 accident_cause 分组', () => {
    const sql = generateCauseAnalysisQuery(EMPTY_FILTERS);
    expect(sql).toContain('c.accident_cause');
    expect(sql).toContain('GROUP BY c.accident_cause');
    expect(sql).toContain('ORDER BY cases DESC');
  });

  it('输出人伤占比 injury_pct', () => {
    const sql = generateCauseAnalysisQuery(EMPTY_FILTERS);
    expect(sql).toContain('injury_pct');
    expect(sql).toContain('100.0');
  });

  it('人伤率公式：SUM(is_bodily_injury) / COUNT(*)', () => {
    const sql = generateCauseAnalysisQuery(EMPTY_FILTERS);
    expect(sql).toContain('SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END)');
    expect(sql).toContain('* 100.0 / COUNT(*)');
  });

  it('accidentCause 过滤传入时正确注入', () => {
    const sql = generateCauseAnalysisQuery({ accidentCause: '自然灾害' });
    expect(sql).toContain("c.accident_cause = '自然灾害'");
  });
});

// ═══════════════════════════════════════════════════
// 5. generateGeoRiskByAccidentQuery — 出险地点地理分布
// ═══════════════════════════════════════════════════

describe('generateGeoRiskByAccidentQuery', () => {
  it('包含省市双维度输出', () => {
    const sql = generateGeoRiskByAccidentQuery(EMPTY_FILTERS);
    expect(sql).toContain('c.accident_province AS province');
    expect(sql).toContain('c.accident_city AS city');
  });

  it('输出平均赔付周期 avg_cycle_days', () => {
    const sql = generateGeoRiskByAccidentQuery(EMPTY_FILTERS);
    expect(sql).toContain('avg_cycle_days');
    expect(sql).toContain('c.payment_time IS NOT NULL');
  });

  it('过滤空城市：accident_city IS NOT NULL', () => {
    const sql = generateGeoRiskByAccidentQuery(EMPTY_FILTERS);
    expect(sql).toContain('c.accident_city IS NOT NULL');
  });

  it('LIMIT 100 防止数据过大', () => {
    const sql = generateGeoRiskByAccidentQuery(EMPTY_FILTERS);
    expect(sql).toContain('LIMIT 100');
  });

  it('按 cases DESC 排序', () => {
    const sql = generateGeoRiskByAccidentQuery(EMPTY_FILTERS);
    expect(sql).toContain('ORDER BY cases DESC');
  });

  it('GROUP BY province + city 双字段', () => {
    const sql = generateGeoRiskByAccidentQuery(EMPTY_FILTERS);
    expect(sql).toContain('GROUP BY c.accident_province, c.accident_city');
  });
});

// ═══════════════════════════════════════════════════
// 6. generateGeoRiskByPlateQuery — 车牌归属地地理分布
// ═══════════════════════════════════════════════════

describe('generateGeoRiskByPlateQuery', () => {
  it('使用 CTE claim_with_plate', () => {
    const sql = generateGeoRiskByPlateQuery(EMPTY_FILTERS);
    expect(sql).toContain('WITH claim_with_plate AS');
  });

  it('四川各城市 LIKE 规则完整（21 个城市）', () => {
    const sql = generateGeoRiskByPlateQuery(EMPTY_FILTERS);
    expect(sql).toContain("WHEN p.plate_no LIKE '川A%' THEN '成都'");
    expect(sql).toContain("WHEN p.plate_no LIKE '川B%' THEN '绵阳'");
    expect(sql).toContain("WHEN p.plate_no LIKE '川K%' THEN '乐山'");
    expect(sql).toContain("WHEN p.plate_no LIKE '川W%' THEN '凉山'");
    expect(sql).toContain("WHEN p.plate_no LIKE '渝%' THEN '重庆'");
  });

  it('过滤其他地区：WHERE plate_city != 其他', () => {
    const sql = generateGeoRiskByPlateQuery(EMPTY_FILTERS);
    expect(sql).toContain("WHERE plate_city != '其他'");
  });

  it('输出 injury_pct', () => {
    const sql = generateGeoRiskByPlateQuery(EMPTY_FILTERS);
    expect(sql).toContain('injury_pct');
  });

  it('GROUP BY plate_city 并 ORDER BY cases DESC', () => {
    const sql = generateGeoRiskByPlateQuery(EMPTY_FILTERS);
    expect(sql).toContain('GROUP BY plate_city');
    expect(sql).toContain('ORDER BY cases DESC');
  });

  it('JOIN PolicyFact 以获取车牌号', () => {
    const sql = generateGeoRiskByPlateQuery(EMPTY_FILTERS);
    expect(sql).toContain('JOIN PolicyFact p ON c.policy_no = p.policy_no');
    expect(sql).toContain('p.plate_no');
  });
});

// ═══════════════════════════════════════════════════
// 7. generateGeoComparisonQuery — 出险地 vs 车牌归属地对比
// ═══════════════════════════════════════════════════

describe('generateGeoComparisonQuery', () => {
  it('使用 CTE base 计算跨地区标识', () => {
    const sql = generateGeoComparisonQuery(EMPTY_FILTERS);
    expect(sql).toContain('WITH base AS');
    expect(sql).toContain('is_cross_region');
  });

  it('过滤 plate_no IS NOT NULL', () => {
    const sql = generateGeoComparisonQuery(EMPTY_FILTERS);
    expect(sql).toContain('p.plate_no IS NOT NULL');
  });

  it('输出跨区域统计四字段', () => {
    const sql = generateGeoComparisonQuery(EMPTY_FILTERS);
    expect(sql).toContain('total_cases');
    expect(sql).toContain('cross_region_cases');
    expect(sql).toContain('cross_region_pct');
    expect(sql).toContain('cross_region_avg_reserve');
    expect(sql).toContain('local_avg_reserve');
  });

  it('包含跨区域保费对比逻辑（local_avg_reserve）', () => {
    const sql = generateGeoComparisonQuery(EMPTY_FILTERS);
    expect(sql).toContain('CASE WHEN NOT is_cross_region THEN reserve_amount END');
  });
});

// ═══════════════════════════════════════════════════
// 8. generateClaimCycleQuery — 理赔时效分析
// ═══════════════════════════════════════════════════

describe('generateClaimCycleQuery', () => {
  it('强制注入 claimStatus=已业务结案（仅已结案才有 payment_time）', () => {
    const sql = generateClaimCycleQuery(EMPTY_FILTERS);
    expect(sql).toContain("c.claim_status = '已业务结案'");
  });

  it('过滤 payment_time IS NOT NULL', () => {
    const sql = generateClaimCycleQuery(EMPTY_FILTERS);
    expect(sql).toContain('c.payment_time IS NOT NULL');
  });

  it('输出 4 个时效节点', () => {
    const sql = generateClaimCycleQuery(EMPTY_FILTERS);
    expect(sql).toContain('avg_report_days');   // 出险→报案
    expect(sql).toContain('avg_open_days');     // 报案→立案
    expect(sql).toContain('avg_settle_days');   // 立案→核定
    expect(sql).toContain('avg_pay_days');      // 核定→支付
    expect(sql).toContain('avg_total_days');    // 全程
    expect(sql).toContain('median_total_days'); // 中位数
  });

  it('按人伤/非人伤分组', () => {
    const sql = generateClaimCycleQuery(EMPTY_FILTERS);
    expect(sql).toContain("CASE WHEN c.is_bodily_injury THEN '人伤' ELSE '非人伤' END AS type");
    expect(sql).toContain('GROUP BY c.is_bodily_injury');
  });

  it('使用 MEDIAN 函数计算中位数', () => {
    const sql = generateClaimCycleQuery(EMPTY_FILTERS);
    expect(sql).toContain('MEDIAN(DATEDIFF(');
  });

  it('时效计算：4 个 DATEDIFF 节点', () => {
    const sql = generateClaimCycleQuery(EMPTY_FILTERS);
    expect(sql).toContain('c.accident_time, c.report_time');
    expect(sql).toContain('c.report_time, c.case_open_time');
    expect(sql).toContain('c.case_open_time, c.settlement_time');
    expect(sql).toContain('c.settlement_time, c.payment_time');
  });
});

// ═══════════════════════════════════════════════════
// 9. generateLossRatioDevelopmentQuery — 赔付率发展三角形
// ═══════════════════════════════════════════════════

describe('generateLossRatioDevelopmentQuery', () => {
  it('默认 cohortYears=[2023,2024,2025] 注入 IN 子句', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('IN (2023,2024,2025)');
  });

  it('自定义 cohortYears 正确注入', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS, [2024, 2025]);
    expect(sql).toContain('IN (2024,2025)');
  });

  it('默认 maxDevMonth=24 生成 RANGE(1, 25)', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('RANGE(1, 25)');
  });

  it('自定义 maxDevMonth=12 生成 RANGE(1, 13)', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS, [2024, 2025], 12);
    expect(sql).toContain('RANGE(1, 13)');
  });

  it('包含 CTE：claims_cutoff_cte + raw_policies + policies + policy_totals + dev_months + calendar_window + earned + claimed', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('claims_cutoff_cte AS (');
    expect(sql).toContain('raw_policies AS (');
    expect(sql).toContain('policies AS (');
    expect(sql).toContain('policy_totals AS (');
    expect(sql).toContain('dev_months AS (');
    expect(sql).toContain('calendar_window AS (');
    expect(sql).toContain('earned AS (');
    expect(sql).toContain('claimed AS (');
  });

  it('输出关键指标：loss_ratio_pct + incident_rate_pct + avg_claim + claims_cutoff', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('loss_ratio_pct');
    expect(sql).toContain('incident_rate_pct');
    expect(sql).toContain('avg_claim');
    expect(sql).toContain('coverage_pct');
    expect(sql).toContain('claims_cutoff');
  });

  it('日历发展口径：MAKE_DATE + year_start + observation_end', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('MAKE_DATE(');
    expect(sql).toContain('year_start');
    expect(sql).toContain('observation_end');
    expect(sql).toContain('to_months(m.dev_month)');
  });

  it('保单净额聚合：HAVING SUM(premium) > 0', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('HAVING SUM(premium) > 0');
  });

  it('赔案按报案时间过滤：report_time < observation_end', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('c.report_time < cw.observation_end');
  });

  it('已决/未决按 settlement_time 分类取值', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('c.settlement_time IS NOT NULL');
    expect(sql).toContain('c.settlement_time < cw.observation_end');
    expect(sql).toContain('c.settled_amount');
    expect(sql).toContain('c.reserve_amount');
  });

  it('全局截止时间用 MAX(report_time)，非 CURRENT_DATE', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('MAX(report_time)');
    expect(sql).not.toContain('CURRENT_DATE');
  });

  it('NULLIF 防除以零（已赚保费 + 已赚暴露）', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('NULLIF(e.earned_premium, 0)');
    expect(sql).toContain('NULLIF(e.earned_exposure, 0)');
  });

  it('avg_claim 用 CASE WHEN > 0 防除以零', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('CASE WHEN cl.claim_count > 0');
    expect(sql).toContain('THEN ROUND(cl.total_reserve / cl.claim_count, 0)');
  });

  it('ORDER BY cohort_year + dev_month', () => {
    const sql = generateLossRatioDevelopmentQuery(EMPTY_FILTERS);
    expect(sql).toContain('ORDER BY e.cohort_year, e.dev_month');
  });

  it('保单级过滤 policyWhere 注入（orgName）', () => {
    const sql = generateLossRatioDevelopmentQuery({ orgName: '乐山' });
    expect(sql).toContain("p.org_level_3 = '乐山'");
  });
});

// ═══════════════════════════════════════════════════
// 10. generateFrequencyYoyQuery — 出险频度同比
// ═══════════════════════════════════════════════════

describe('generateFrequencyYoyQuery', () => {
  it('包含 quarterly_claims + quarterly_policies 两个 CTE', () => {
    const sql = generateFrequencyYoyQuery(EMPTY_FILTERS);
    expect(sql).toContain('quarterly_claims AS (');
    expect(sql).toContain('quarterly_policies AS (');
  });

  it('数据覆盖 2022 年以后', () => {
    const sql = generateFrequencyYoyQuery(EMPTY_FILTERS);
    expect(sql).toContain("c.accident_time >= '2022-01-01'");
    expect(sql).toContain("insurance_start_date >= '2022-01-01'");
  });

  it('按年/季度分组', () => {
    const sql = generateFrequencyYoyQuery(EMPTY_FILTERS);
    expect(sql).toContain('YEAR(c.accident_time) AS year');
    expect(sql).toContain('QUARTER(c.accident_time) AS quarter');
  });

  it('输出千件出险频率 freq_per_1000', () => {
    const sql = generateFrequencyYoyQuery(EMPTY_FILTERS);
    expect(sql).toContain('freq_per_1000');
    expect(sql).toContain('* 1000.0 /');
  });

  it('输出人伤率 injury_pct', () => {
    const sql = generateFrequencyYoyQuery(EMPTY_FILTERS);
    expect(sql).toContain('injury_pct');
  });

  it('LEFT JOIN 保单季度数据', () => {
    const sql = generateFrequencyYoyQuery(EMPTY_FILTERS);
    expect(sql).toContain('LEFT JOIN quarterly_policies e ON c.year = e.year AND c.quarter = e.quarter');
  });

  it('ORDER BY year + quarter', () => {
    const sql = generateFrequencyYoyQuery(EMPTY_FILTERS);
    expect(sql).toContain('ORDER BY c.year, c.quarter');
  });

  it('保单过滤注入（orgName）', () => {
    const sql = generateFrequencyYoyQuery({ orgName: '天府' });
    expect(sql).toContain("p.org_level_3 = '天府'");
  });
});

// ═══════════════════════════════════════════════════
// 11. vehicleQuickFilter 车型快捷筛选
// ═══════════════════════════════════════════════════

describe('vehicleQuickFilter 车型快捷筛选（buildPolicyWhere）', () => {
  it('home_car → 非营业个人客车', () => {
    const sql = generatePendingOverviewQuery({ vehicleQuickFilter: 'home_car' });
    expect(sql).toContain("p.customer_category = '非营业个人客车'");
  });

  it('motorcycle → 摩托车', () => {
    const sql = generatePendingOverviewQuery({ vehicleQuickFilter: 'motorcycle' });
    expect(sql).toContain("p.customer_category = '摩托车'");
  });

  it('rental → 营业出租租赁', () => {
    const sql = generatePendingOverviewQuery({ vehicleQuickFilter: 'rental' });
    expect(sql).toContain("p.customer_category = '营业出租租赁'");
  });

  it('truck_1t → 货车1吨以下', () => {
    const sql = generatePendingOverviewQuery({ vehicleQuickFilter: 'truck_1t' });
    expect(sql).toContain("p.customer_category IN ('营业货车', '非营业货车')");
    expect(sql).toContain("p.tonnage_segment = '1吨以下'");
  });

  it('truck_2_9t → 货车2-9吨', () => {
    const sql = generatePendingOverviewQuery({ vehicleQuickFilter: 'truck_2_9t' });
    expect(sql).toContain("p.tonnage_segment = '2-9吨'");
  });

  it('dump → 自卸车（10吨+含 LIKE %自卸%）', () => {
    const sql = generatePendingOverviewQuery({ vehicleQuickFilter: 'dump' });
    expect(sql).toContain("p.tonnage_segment = '10吨以上'");
    expect(sql).toContain("p.vehicle_model LIKE '%自卸%'");
  });

  it('tractor → 牵引车', () => {
    const sql = generatePendingOverviewQuery({ vehicleQuickFilter: 'tractor' });
    expect(sql).toContain("p.vehicle_model LIKE '%牵引%'");
  });

  it('general → 普通大货（排除自卸和牵引）', () => {
    const sql = generatePendingOverviewQuery({ vehicleQuickFilter: 'general' });
    expect(sql).toContain("p.vehicle_model NOT LIKE '%自卸%'");
    expect(sql).toContain("p.vehicle_model NOT LIKE '%牵引%'");
  });
});

// ═══════════════════════════════════════════════════
// 12. 安全性 & 防御性
// ═══════════════════════════════════════════════════

describe('安全性 & 防御性', () => {
  it('所有查询函数返回非空字符串', () => {
    const generators = [
      () => generatePendingOverviewQuery(EMPTY_FILTERS),
      () => generatePendingByOrgQuery(EMPTY_FILTERS),
      () => generatePendingAgingQuery(EMPTY_FILTERS),
      () => generateCauseAnalysisQuery(EMPTY_FILTERS),
      () => generateGeoRiskByAccidentQuery(EMPTY_FILTERS),
      () => generateGeoRiskByPlateQuery(EMPTY_FILTERS),
      () => generateGeoComparisonQuery(EMPTY_FILTERS),
      () => generateClaimCycleQuery(EMPTY_FILTERS),
      () => generateLossRatioDevelopmentQuery(EMPTY_FILTERS),
      () => generateFrequencyYoyQuery(EMPTY_FILTERS),
    ];
    for (const fn of generators) {
      const sql = fn();
      expect(sql.length).toBeGreaterThan(50);
      expect(sql).not.toMatch(/^\s*$/);
    }
  });

  it('所有查询均包含 ClaimsDetail JOIN PolicyFact', () => {
    const generators = [
      () => generatePendingOverviewQuery(EMPTY_FILTERS),
      () => generatePendingByOrgQuery(EMPTY_FILTERS),
      () => generatePendingAgingQuery(EMPTY_FILTERS),
      () => generateCauseAnalysisQuery(EMPTY_FILTERS),
      () => generateGeoRiskByAccidentQuery(EMPTY_FILTERS),
    ];
    for (const fn of generators) {
      const sql = fn();
      expect(sql).toContain('ClaimsDetail');
      expect(sql).toContain('PolicyFact');
    }
  });

  it('ROUND 精度保护：万元字段均 ROUND(x, 0)', () => {
    const sql = generatePendingOverviewQuery(EMPTY_FILTERS);
    expect(sql).toMatch(/ROUND\(SUM.*1e4.*0\)/);
  });

  it('orgName 特殊字符经 escapeSqlValue 安全处理（不破坏基本机构名）', () => {
    // 正常机构名不受影响
    const sql = generatePendingOverviewQuery({ orgName: '乐山' });
    expect(sql).toContain("p.org_level_3 = '乐山'");
  });

  it('全过滤器下 SQL 仍有效（无语法明显缺陷）', () => {
    const sql = generateLossRatioDevelopmentQuery(FULL_FILTERS, [2023, 2024, 2025], 12);
    // 基本结构完整
    expect(sql).toContain('WITH');
    expect(sql).toContain('SELECT');
    expect(sql).toContain('FROM');
    expect(sql).toContain('ORDER BY');
  });
});
