/**
 * B252 回归测试：PolicyFact 去重 CTE 生成器
 *
 * 覆盖范围：
 * 1. 默认结构（policy_no + start_date GROUP BY, SUM(premium)/fee_amount, HAVING > 0）
 * 2. ANY_VALUE 结构字段
 * 3. 批改可变字段（insurance_grade / commercial_pricing_factor）优先取原单值
 * 4. whereClause 注入
 * 5. requireStartDate 开关
 * 6. 3 个主要生成器的 SQL 是否已采用 policy_dedup（集成断言）
 */

import { describe, expect, it } from 'vitest';
import {
  buildPolicyDedupCTE,
  dedupFieldSql,
} from '../shared/policy-dedup.js';
import {
  generateClaimRatioQuery,
  generateComprehensiveCostQuery,
  generateVariableCostQuery,
} from '../cost/cost-ratios.js';
import {
  generateComprehensiveDimensionMetricsQuery,
  generateComprehensiveSummaryQuery,
} from '../comprehensive-analysis.js';
import { generateKpiQuery } from '../kpi.js';
import {
  generatePendingOverviewQuery,
  generatePendingByOrgQuery,
  generatePendingAgingQuery,
  generateCauseAnalysisQuery,
  generateGeoRiskByAccidentQuery,
  generateGeoRiskByPlateQuery,
  generateGeoComparisonQuery,
  generateClaimCycleQuery,
  generateFrequencyYoyQuery,
} from '../claims-detail.js';
import { generateRepairDiversionListQuery } from '../repair.js';

// ═══════════════════════════════════════════════════
// 1. dedupFieldSql：字段 ANY_VALUE 表达式生成
// ═══════════════════════════════════════════════════

describe('dedupFieldSql', () => {
  it('普通结构字段使用 ANY_VALUE', () => {
    expect(dedupFieldSql('org_level_3')).toBe(
      'ANY_VALUE(org_level_3) AS org_level_3'
    );
  });

  it('customer_category 也用 ANY_VALUE（批改通常不改）', () => {
    expect(dedupFieldSql('customer_category')).toBe(
      'ANY_VALUE(customer_category) AS customer_category'
    );
  });

  it('insurance_grade 优先取原单值（批改可能变）', () => {
    const sql = dedupFieldSql('insurance_grade');
    expect(sql).toContain('CASE WHEN premium > 0 THEN insurance_grade END');
    expect(sql).toContain('ANY_VALUE(CASE WHEN premium > 0 THEN insurance_grade END)');
    expect(sql).toContain('ANY_VALUE(insurance_grade)');
    expect(sql).toContain('COALESCE(');
  });

  it('commercial_pricing_factor 优先取原单值（批改可能变）', () => {
    const sql = dedupFieldSql('commercial_pricing_factor');
    expect(sql).toContain('CASE WHEN premium > 0 THEN commercial_pricing_factor END');
    expect(sql).toContain('COALESCE(');
  });

  it('支持自定义 alias', () => {
    expect(dedupFieldSql('org_level_3', 'org3')).toBe(
      'ANY_VALUE(org_level_3) AS org3'
    );
  });
});

// ═══════════════════════════════════════════════════
// 2. buildPolicyDedupCTE：CTE 结构生成
// ═══════════════════════════════════════════════════

describe('buildPolicyDedupCTE', () => {
  it('默认结构：policy_no + start_date GROUP BY, SUM(premium)/fee_amount, HAVING > 0', () => {
    const sql = buildPolicyDedupCTE('policy_dedup');
    expect(sql).toContain('policy_dedup AS (');
    expect(sql).toContain('SELECT');
    expect(sql).toContain('policy_no,');
    expect(sql).toContain('CAST(insurance_start_date AS DATE) AS insurance_start_date');
    expect(sql).toContain('SUM(premium) AS premium');
    expect(sql).toContain('SUM(COALESCE(fee_amount, 0)) AS fee_amount');
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('GROUP BY policy_no, CAST(insurance_start_date AS DATE)');
    expect(sql).toContain('HAVING SUM(premium) > 0');
  });

  it('默认 WHERE = 1=1 + insurance_start_date IS NOT NULL', () => {
    const sql = buildPolicyDedupCTE('policy_dedup');
    expect(sql).toContain('WHERE 1=1');
    expect(sql).toContain('AND insurance_start_date IS NOT NULL');
  });

  it('whereClause 正确注入', () => {
    const sql = buildPolicyDedupCTE('policy_dedup', {
      whereClause: "customer_category = '非营业个人客车'",
    });
    expect(sql).toContain("WHERE customer_category = '非营业个人客车'");
  });

  it('extraFields 追加 ANY_VALUE 表达式', () => {
    const sql = buildPolicyDedupCTE('policy_dedup', {
      extraFields: ['org_level_3', 'customer_category', 'coverage_combination'],
    });
    expect(sql).toContain('ANY_VALUE(org_level_3) AS org_level_3');
    expect(sql).toContain('ANY_VALUE(customer_category) AS customer_category');
    expect(sql).toContain('ANY_VALUE(coverage_combination) AS coverage_combination');
  });

  it('extraFields 含 insurance_grade 时使用原单优先表达式', () => {
    const sql = buildPolicyDedupCTE('policy_dedup', {
      extraFields: ['insurance_grade'],
    });
    expect(sql).toContain(
      'COALESCE(ANY_VALUE(CASE WHEN premium > 0 THEN insurance_grade END), ANY_VALUE(insurance_grade))'
    );
  });

  it('requireStartDate=false 时不加 IS NOT NULL 过滤', () => {
    const sql = buildPolicyDedupCTE('policy_dedup', {
      requireStartDate: false,
    });
    expect(sql).not.toContain('AND insurance_start_date IS NOT NULL');
  });

  it('自定义 sourceTable 生效', () => {
    const sql = buildPolicyDedupCTE('policy_dedup', {
      sourceTable: 'filtered',
    });
    expect(sql).toContain('FROM filtered');
    expect(sql).not.toContain('FROM PolicyFact');
  });

  it('自定义 CTE 名生效', () => {
    const sql = buildPolicyDedupCTE('my_dedup');
    expect(sql).toContain('my_dedup AS (');
    expect(sql).not.toContain('policy_dedup AS (');
  });
});

// ═══════════════════════════════════════════════════
// 3. 集成断言：3 个主生成器已采用 policy_dedup
// ═══════════════════════════════════════════════════

describe('B252 集成：3 个主生成器采用 policy_dedup', () => {
  const BASE_COST = {
    dimension: 'customer_category' as const,
    cutoffDate: '2026-03-31',
    whereClause: '1=1',
  };

  it('generateClaimRatioQuery 包含 policy_dedup CTE + HAVING SUM(premium)>0', () => {
    const sql = generateClaimRatioQuery(BASE_COST);
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain('FROM policy_dedup p');
    // 确保没有残留的直接 JOIN PolicyFact 的模式
    expect(sql).not.toMatch(/FROM PolicyFact p\s+LEFT JOIN ClaimsAgg/);
  });

  it('generateComprehensiveCostQuery 包含 policy_dedup CTE', () => {
    const sql = generateComprehensiveCostQuery(BASE_COST);
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain('FROM policy_dedup p');
    expect(sql).not.toMatch(/FROM PolicyFact p\s+LEFT JOIN ClaimsAgg/);
  });

  it('generateVariableCostQuery 包含 policy_dedup CTE', () => {
    const sql = generateVariableCostQuery(BASE_COST);
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain('FROM policy_dedup p');
    expect(sql).not.toMatch(/FROM PolicyFact p\s+LEFT JOIN ClaimsAgg/);
  });

  it('generateComprehensiveDimensionMetricsQuery 包含 policy_dedup CTE', () => {
    const sql = generateComprehensiveDimensionMetricsQuery({
      dimension: 'org',
      whereClause: "policy_date >= '2026-01-01'",
      cutoffDate: '2026-03-31',
    });
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain('FROM policy_dedup p');
  });

  it('generateComprehensiveSummaryQuery 包含 policy_dedup CTE', () => {
    const sql = generateComprehensiveSummaryQuery(
      "policy_date >= '2026-01-01'",
      '2026-03-31'
    );
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('HAVING SUM(premium) > 0');
  });

  it('generateKpiQuery 包含 filtered_dedup CTE（KPI 专用去重：不离开 filtered）', () => {
    const sql = generateKpiQuery();
    expect(sql).toContain('filtered_dedup AS');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain('FROM filtered_dedup f');
    // variable_cost_base 必须从 dedup 后取数，而非直接 filtered
    expect(sql).toMatch(/variable_cost_base AS[\s\S]*?FROM filtered_dedup/);
  });
});

// ═══════════════════════════════════════════════════
// 4. Phase 2 集成：claims-detail 9 处反向 JOIN 已去重
// ═══════════════════════════════════════════════════

describe('B252 Phase 2 集成：claims-detail 反向 JOIN 去重', () => {
  const generators: Array<[string, () => string]> = [
    ['generatePendingOverviewQuery', () => generatePendingOverviewQuery({})],
    ['generatePendingByOrgQuery', () => generatePendingByOrgQuery({})],
    ['generatePendingAgingQuery', () => generatePendingAgingQuery({})],
    ['generateCauseAnalysisQuery', () => generateCauseAnalysisQuery({})],
    ['generateGeoRiskByAccidentQuery', () => generateGeoRiskByAccidentQuery({})],
    ['generateGeoRiskByPlateQuery', () => generateGeoRiskByPlateQuery({})],
    ['generateGeoComparisonQuery', () => generateGeoComparisonQuery({})],
    ['generateClaimCycleQuery', () => generateClaimCycleQuery({})],
    ['generateFrequencyYoyQuery', () => generateFrequencyYoyQuery({})],
  ];

  it.each(generators)('%s 不再直接 JOIN PolicyFact p（仅子查询 JOIN）', (_name, fn) => {
    const sql = fn();
    // 禁止出现直连的反模式
    expect(sql).not.toMatch(/JOIN PolicyFact p ON c\.policy_no = p\.policy_no/);
  });

  it.each(generators)('%s 采用去重子查询（FROM PolicyFact + GROUP BY policy_no + HAVING）', (_name, fn) => {
    const sql = fn();
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('GROUP BY policy_no');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain(') p ON c.policy_no = p.policy_no');
  });

  it.each(generators)('%s 子查询带出 policyWhere 引用的结构字段', (_name, fn) => {
    const sql = fn();
    expect(sql).toContain('ANY_VALUE(org_level_3)');
    expect(sql).toContain('ANY_VALUE(customer_category)');
    expect(sql).toContain('ANY_VALUE(plate_no)');
  });

  it('insurance_grade 采用原单优先取值策略（决策 3）', () => {
    const sql = generatePendingOverviewQuery({});
    expect(sql).toContain('ANY_VALUE(CASE WHEN premium > 0 THEN insurance_grade END)');
  });
});

// ═══════════════════════════════════════════════════
// 5. Phase 3 集成：repair.ts diversion 列表去重
// ═══════════════════════════════════════════════════

describe('B252 Phase 3 集成：repair 导流列表去重', () => {
  it('generateRepairDiversionListQuery 采用 policy_dedup CTE（按 policy_no 聚合，HAVING premium>0）', () => {
    const sql = generateRepairDiversionListQuery({ timeWindow: 'rolling12' });
    // B252：diversion 列表不应 LEFT JOIN 原始 PolicyFact
    expect(sql).not.toMatch(/LEFT JOIN PolicyFact p ON dc\.policy_no = p\.policy_no/);
    // 应采用去重 CTE
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('GROUP BY policy_no');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain('LEFT JOIN policy_dedup p ON dc.policy_no = p.policy_no');
  });

  it('列表 premium 用 SUM(premium) 净值（排除退保，避免展示 0 元副本）', () => {
    const sql = generateRepairDiversionListQuery({ timeWindow: 'rolling12' });
    expect(sql).toContain('SUM(premium) AS premium');
  });

  it('带出 org_level_3 / salesman_name / customer_category 供展示', () => {
    const sql = generateRepairDiversionListQuery({ timeWindow: 'rolling12' });
    expect(sql).toContain('ANY_VALUE(org_level_3)');
    expect(sql).toContain('ANY_VALUE(salesman_name)');
    expect(sql).toContain('ANY_VALUE(customer_category)');
  });
});
