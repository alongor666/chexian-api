import { describe, expect, it } from 'vitest';
import {
  generateClaimRatioQuery,
  generateExpenseRatioQuery,
  generateComprehensiveCostQuery,
  generateVariableCostQuery,
  getRolling12MonthWindowStart,
  generateEarnedPremiumQuery,
  generateEarnedPremiumSummaryQuery,
  generatePolicy2025In2025Query,
  generatePolicy2025In2026Query,
  generatePolicy2026In2026Query,
  generatePolicy2026In2027Query,
  generatePolicy2025EarnedPremiumQuery,
  generatePolicy2026EarnedPremiumQuery,
  generateNewEarnedPremiumSummaryQuery,
  generateMonthlyExpenseQuery,
  DIMENSION_LABELS,
  COST_ANALYSIS_PRESETS,
  type CostDimension,
} from '../cost.js';

// ── 共享配置 ──

const BASE_CONFIG = {
  dimension: 'customer_category' as CostDimension,
  cutoffDate: '2026-03-31',
};

const ALL_DIMENSIONS: CostDimension[] = [
  'customer_category',
  'org_level_3',
  'coverage_combination',
  'org_customer',
  'org_coverage',
];

// ════════════════��══════════════════════════════════
// 1. 核心成本率生成器（4 个函数）
// ═══════════════════════════════════════════════════

describe('generateClaimRatioQuery', () => {
  it('基本结构：policy_dedup + policy_exposure CTE + ClaimsAgg JOIN', () => {
    const sql = generateClaimRatioQuery(BASE_CONFIG);
    // B252：policy_dedup CTE 按 (policy_no, insurance_start_date) 去重后再 JOIN ClaimsAgg
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('policy_exposure AS');
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('FROM policy_dedup p');
    expect(sql).toContain('LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain('GROUP BY customer_category');
    expect(sql).toContain('ORDER BY SUM(premium) DESC');
  });

  it('输出列完整性', () => {
    const sql = generateClaimRatioQuery(BASE_CONFIG);
    expect(sql).toContain('dim_key');
    expect(sql).toContain('policy_count');
    expect(sql).toContain('total_premium');
    expect(sql).toContain('total_claim_cases');
    expect(sql).toContain('total_reported_claims');
    expect(sql).toContain('total_exposure_days');
    expect(sql).toContain('avg_exposure_days');
  });

  it('使用指标注册表（非裸写 SQL）', () => {
    const sql = generateClaimRatioQuery(BASE_CONFIG);
    // getMetricSql 会展开为注册表公式，验证关键指标别名存在
    expect(sql).toContain('AS avg_claim_amount');
    expect(sql).toContain('AS earned_premium');
    expect(sql).toContain('AS earned_claim_ratio');
    expect(sql).toContain('AS earned_loss_frequency');
  });

  it('满期天数计算包含闰年感知', () => {
    const sql = generateClaimRatioQuery(BASE_CONFIG);
    expect(sql).toContain('INTERVAL 1 YEAR');
    expect(sql).toContain('policy_term');
    expect(sql).toContain('earned_days');
  });

  it('cutoffDate 正确注入', () => {
    const sql = generateClaimRatioQuery(BASE_CONFIG);
    expect(sql).toContain("DATE '2026-03-31'");
  });

  it('WHERE 子句注入', () => {
    const sql = generateClaimRatioQuery({
      ...BASE_CONFIG,
      whereClause: "customer_category = '非营业个人客车'",
    });
    expect(sql).toContain("customer_category = '非营业个人客车'");
  });

  it('默认 WHERE = 1=1', () => {
    const sql = generateClaimRatioQuery(BASE_CONFIG);
    expect(sql).toContain('WHERE 1=1');
  });

  it.each(ALL_DIMENSIONS)('维度 %s: GROUP BY 正确', (dim) => {
    const sql = generateClaimRatioQuery({ ...BASE_CONFIG, dimension: dim });
    if (dim === 'org_customer') {
      expect(sql).toContain('GROUP BY org_level_3, customer_category');
    } else if (dim === 'org_coverage') {
      expect(sql).toContain('GROUP BY org_level_3, coverage_combination');
    } else {
      expect(sql).toContain(`GROUP BY ${dim}`);
    }
  });

  it('多维度 dim_key 用 || 连接', () => {
    const sql = generateClaimRatioQuery({
      ...BASE_CONFIG,
      dimension: 'org_customer',
    });
    expect(sql).toContain("|| ' - ' ||");
  });
});

describe('generateExpenseRatioQuery', () => {
  it('直接查 PolicyFact（无 CTE）', () => {
    const sql = generateExpenseRatioQuery(BASE_CONFIG);
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).not.toContain('WITH');
    expect(sql).not.toContain('ClaimsAgg');
  });

  it('输出列包含费用率', () => {
    const sql = generateExpenseRatioQuery(BASE_CONFIG);
    expect(sql).toContain('total_fee');
    expect(sql).toContain('AS expense_ratio');
  });

  it('使用指标注册表', () => {
    const sql = generateExpenseRatioQuery(BASE_CONFIG);
    expect(sql).toContain('AS expense_ratio');
  });

  it.each(ALL_DIMENSIONS)('维度 %s 可用', (dim) => {
    const sql = generateExpenseRatioQuery({ ...BASE_CONFIG, dimension: dim });
    expect(sql).toContain('dim_key');
    expect(sql).toContain('GROUP BY');
  });
});

describe('generateComprehensiveCostQuery', () => {
  it('CTE 包含 policy_dedup + policy_exposure + ClaimsAgg JOIN + fee_amount', () => {
    const sql = generateComprehensiveCostQuery(BASE_CONFIG);
    // B252
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('policy_exposure AS');
    expect(sql).toContain('FROM policy_dedup p');
    expect(sql).toContain('LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain('fee_amount');
  });

  it('输出综合费用率和费用率', () => {
    const sql = generateComprehensiveCostQuery(BASE_CONFIG);
    expect(sql).toContain('AS comprehensive_cost_ratio');
    expect(sql).toContain('AS expense_ratio');
    expect(sql).toContain('AS earned_claim_ratio');
  });

  it('综合费用率公式：(赔款 + 费用) / 满期保费', () => {
    const sql = generateComprehensiveCostQuery(BASE_CONFIG);
    expect(sql).toContain('SUM(reported_claims) + SUM(fee_amount)');
  });

  it('使用指标注册表：满期保费 + 赔付率', () => {
    const sql = generateComprehensiveCostQuery(BASE_CONFIG);
    expect(sql).toContain('AS earned_premium');
    expect(sql).toContain('AS earned_claim_ratio');
  });
});

describe('generateVariableCostQuery', () => {
  it('CTE 包含 policy_dedup + policy_exposure + ClaimsAgg JOIN', () => {
    const sql = generateVariableCostQuery(BASE_CONFIG);
    // B252
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('policy_exposure AS');
    expect(sql).toContain('FROM policy_dedup p');
    expect(sql).toContain('LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no');
    expect(sql).toContain('HAVING SUM(premium) > 0');
  });

  it('输出变动成本率', () => {
    const sql = generateVariableCostQuery(BASE_CONFIG);
    expect(sql).toContain('AS variable_cost_ratio');
  });

  it('变动成本率 = 赔付率 + 费用率', () => {
    const sql = generateVariableCostQuery(BASE_CONFIG);
    // 公式中同时有 reported_claims 和 fee_amount
    expect(sql).toContain('SUM(reported_claims)');
    expect(sql).toContain('SUM(fee_amount)');
  });

  it('使用指标注册表', () => {
    const sql = generateVariableCostQuery(BASE_CONFIG);
    expect(sql).toContain('AS earned_premium');
    expect(sql).toContain('AS earned_claim_ratio');
  });
});

// ═════════════════��════════════════════════════���════
// 2. 滚动12个月已赚保费（3 个函数）
// ═══════════════════════════════════════════════════

describe('getRolling12MonthWindowStart', () => {
  it('标准计算：2026-03-31 → 2025-04-01', () => {
    expect(getRolling12MonthWindowStart('2026-03-31')).toBe('2025-04-01');
  });

  it('年初：2026-01-15 → 2025-01-16', () => {
    expect(getRolling12MonthWindowStart('2026-01-15')).toBe('2025-01-16');
  });

  it('年末：2025-12-31 → 2025-01-01', () => {
    expect(getRolling12MonthWindowStart('2025-12-31')).toBe('2025-01-01');
  });

  it('闰年：2024-03-01 → 2023-03-03', () => {
    // 2024-03-01 - 364天 = 2023-03-03（JS Date 计算）
    expect(getRolling12MonthWindowStart('2024-03-01')).toBe('2023-03-03');
  });
});

describe('generateEarnedPremiumQuery', () => {
  const config = { cutoffDate: '2026-03-31' };

  it('基本结构：CTE + 首日费用 + 时间分摊', () => {
    const sql = generateEarnedPremiumQuery(config);
    expect(sql).toContain('WITH policy_earned AS');
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('first_day_part');
    expect(sql).toContain('time_part');
    expect(sql).toContain('earned_premium_cum');
  });

  it('险类系数：交强 0.82 / 商业 0.94', () => {
    const sql = generateEarnedPremiumQuery(config);
    expect(sql).toContain("WHEN '交强险' THEN 0.82");
    expect(sql).toContain("WHEN '商业保险' THEN 0.94");
  });

  it('滚动窗口日期正确', () => {
    const sql = generateEarnedPremiumQuery(config);
    expect(sql).toContain("DATE '2025-04-01'"); // windowStart
    expect(sql).toContain("DATE '2026-03-31'"); // cutoffDate
  });

  it('明细筛选：policyMonth + orgLevel3', () => {
    const sql = generateEarnedPremiumQuery({
      ...config,
      policyMonth: '2025-06',
      orgLevel3: '天府',
    });
    expect(sql).toContain("policy_month = '2025-06'");
    expect(sql).toContain("org_level_3 = '天府'");
  });

  it('明细筛选 all 值被忽略', () => {
    const sql = generateEarnedPremiumQuery({
      ...config,
      policyMonth: 'all',
      orgLevel3: 'all',
    });
    expect(sql).not.toContain("policy_month = 'all'");
    expect(sql).not.toContain("org_level_3 = 'all'");
  });

  it('限定险种范围', () => {
    const sql = generateEarnedPremiumQuery(config);
    expect(sql).toContain("insurance_type IN ('交强险', '商业保险')");
  });
});

describe('generateEarnedPremiumSummaryQuery', () => {
  const config = { cutoffDate: '2026-03-31' };

  it('按机构分组 + 合计行', () => {
    const sql = generateEarnedPremiumSummaryQuery(config);
    expect(sql).toContain('GROUP BY org_level_3');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain("'合计' AS org_level_3");
  });

  it('输出已赚保费率', () => {
    const sql = generateEarnedPremiumSummaryQuery(config);
    expect(sql).toContain('AS earned_ratio');
    expect(sql).toContain('total_earned_premium');
  });

  it('机构排序：四川→同城→异地→合计', () => {
    const sql = generateEarnedPremiumSummaryQuery(config);
    expect(sql).toContain("WHEN '四川' THEN 1");
    expect(sql).toContain("WHEN '合计' THEN 4");
  });
});

// ══════════════════════════════════════════════════��
// 3. V3 期间已赚保费委托包装器（4 个函数）
// ═══════════════════════════════════════════════════

describe('V3 期间已赚保费包装器', () => {
  it('generatePolicy2025In2025Query: policyYear=2025, earnedYear=2025', () => {
    const sql = generatePolicy2025In2025Query();
    expect(sql).toContain('2025');
    expect(sql).toContain('earned_2025_total');
  });

  it('generatePolicy2025In2026Query: policyYear=2025, earnedYear=2026', () => {
    const sql = generatePolicy2025In2026Query();
    expect(sql).toContain('earned_2026_total');
  });

  it('generatePolicy2026In2026Query: policyYear=2026, earnedYear=2026', () => {
    const sql = generatePolicy2026In2026Query();
    expect(sql).toContain('earned_2026_total');
  });

  it('generatePolicy2026In2027Query: policyYear=2026, earnedYear=2027', () => {
    const sql = generatePolicy2026In2027Query();
    expect(sql).toContain('earned_2027_total');
  });

  it('所有包装器接受 whereClause', () => {
    const where = "org_level_3 = '天府'";
    for (const fn of [
      generatePolicy2025In2025Query,
      generatePolicy2025In2026Query,
      generatePolicy2026In2026Query,
      generatePolicy2026In2027Query,
    ]) {
      const sql = fn({ whereClause: where });
      expect(sql).toContain(where);
    }
  });
});

// ═══════════════════════════════════════════════════
// 4. 月度已赚/费用明细（4 个函数）
// ═══════════════════════════════════════════════════

describe('generatePolicy2025EarnedPremiumQuery', () => {
  it('筛选 2025 年保单', () => {
    const sql = generatePolicy2025EarnedPremiumQuery();
    expect(sql).toContain('EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2025');
  });

  it('输出 12 个月增量字段 + 验证差异', () => {
    const sql = generatePolicy2025EarnedPremiumQuery();
    expect(sql).toContain('earned_2025_12'); // 截至25年末
    expect(sql).toContain('earned_2026_01'); // 26年1月增量
    expect(sql).toContain('earned_2026_12'); // 26年12月增量
    expect(sql).toContain('earned_total');
    expect(sql).toContain('validation_diff');
  });

  it('按起保月分组', () => {
    const sql = generatePolicy2025EarnedPremiumQuery();
    expect(sql).toContain('GROUP BY policy_month');
    expect(sql).toContain('ORDER BY policy_month');
  });
});

describe('generatePolicy2026EarnedPremiumQuery', () => {
  it('筛选 2026 年保单', () => {
    const sql = generatePolicy2026EarnedPremiumQuery();
    expect(sql).toContain('EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2026');
  });

  it('输出 26 年 + 27 年各 12 个月字段', () => {
    const sql = generatePolicy2026EarnedPremiumQuery();
    expect(sql).toContain('earned_2026_01');
    expect(sql).toContain('earned_2026_12');
    expect(sql).toContain('earned_2027_01');
    expect(sql).toContain('earned_2027_12');
  });
});

describe('generateNewEarnedPremiumSummaryQuery', () => {
  it('12 个月 UNION ALL', () => {
    const sql = generateNewEarnedPremiumSummaryQuery();
    // 12 个月 = 11 个 UNION ALL
    const unionCount = (sql.match(/UNION ALL/g) || []).length;
    expect(unionCount).toBe(11);
  });

  it('输出滚动保费 + 分年已赚 + 已赚率', () => {
    const sql = generateNewEarnedPremiumSummaryQuery();
    expect(sql).toContain('rolling_12m_premium');
    expect(sql).toContain('earned_from_2025');
    expect(sql).toContain('earned_from_2026');
    expect(sql).toContain('total_earned_premium');
    expect(sql).toContain('earned_ratio');
  });

  it('统计月份从 2026-01 到 2026-12', () => {
    const sql = generateNewEarnedPremiumSummaryQuery();
    expect(sql).toContain("'2026-01'");
    expect(sql).toContain("'2026-12'");
  });
});

describe('generateMonthlyExpenseQuery', () => {
  it('按起保月分组', () => {
    const sql = generateMonthlyExpenseQuery();
    expect(sql).toContain("STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m') AS policy_month");
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('ORDER BY policy_month');
  });

  it('输出保费 + 费用 + 税金', () => {
    const sql = generateMonthlyExpenseQuery();
    expect(sql).toContain('total_premium');
    expect(sql).toContain('total_fee');
    expect(sql).toContain('tax');
    expect(sql).toContain('total_expense');
  });

  it('税率 1.6%', () => {
    const sql = generateMonthlyExpenseQuery();
    expect(sql).toContain('SUM(premium) * 0.016');
  });

  it('覆盖 2025 + 2026 两年', () => {
    const sql = generateMonthlyExpenseQuery();
    expect(sql).toContain('EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2025');
    expect(sql).toContain('EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2026');
  });

  it('接受 whereClause', () => {
    const sql = generateMonthlyExpenseQuery({ whereClause: "org_level_3 = '天府'" });
    expect(sql).toContain("org_level_3 = '天府'");
  });
});

// ═══════════════════════════════════════════════════
// 5. 导出常量与预设
// ═══════════════════════════════════════════════════

describe('导出常量', () => {
  it('DIMENSION_LABELS 覆盖 5 种维度', () => {
    expect(Object.keys(DIMENSION_LABELS)).toHaveLength(5);
    expect(DIMENSION_LABELS.customer_category).toBe('客户类别');
    expect(DIMENSION_LABELS.org_level_3).toBe('三级机构');
  });

  it('COST_ANALYSIS_PRESETS 包含 3 种预设', () => {
    expect(COST_ANALYSIS_PRESETS.claimByCustomer.dimension).toBe('customer_category');
    expect(COST_ANALYSIS_PRESETS.claimByOrg.dimension).toBe('org_level_3');
    expect(COST_ANALYSIS_PRESETS.claimByCoverage.dimension).toBe('coverage_combination');
  });
});

// ═══════════════════════════════════════════════════
// 6. 安全性 & 防御性
// ═══════════════════════════════════════════════════

describe('安全性', () => {
  it('insurance_start_date IS NOT NULL 防护', () => {
    // 所有含 CTE 的函数都应过滤空起保日
    for (const fn of [generateClaimRatioQuery, generateComprehensiveCostQuery, generateVariableCostQuery]) {
      const sql = fn(BASE_CONFIG);
      expect(sql).toContain('insurance_start_date IS NOT NULL');
    }
  });

  it('所有 SQL 返回非空字符串', () => {
    for (const fn of [
      () => generateClaimRatioQuery(BASE_CONFIG),
      () => generateExpenseRatioQuery(BASE_CONFIG),
      () => generateComprehensiveCostQuery(BASE_CONFIG),
      () => generateVariableCostQuery(BASE_CONFIG),
      () => generateEarnedPremiumQuery({ cutoffDate: '2026-03-31' }),
      () => generateEarnedPremiumSummaryQuery({ cutoffDate: '2026-03-31' }),
      () => generatePolicy2025EarnedPremiumQuery(),
      () => generatePolicy2026EarnedPremiumQuery(),
      () => generateNewEarnedPremiumSummaryQuery(),
      () => generateMonthlyExpenseQuery(),
    ]) {
      const sql = fn();
      expect(sql.length).toBeGreaterThan(50);
      expect(sql).not.toMatch(/^\s*$/);
    }
  });
});
