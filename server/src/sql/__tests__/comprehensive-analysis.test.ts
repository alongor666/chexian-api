import { describe, expect, it } from 'vitest';
import {
  generateComprehensiveDimensionMetricsQuery,
  generateComprehensiveSummaryQuery,
  generateComprehensiveLossTrendQuery,
  generateComprehensivePlanByOrgQuery,
  type ComprehensiveMetricQueryConfig,
  type ComprehensiveDimension,
  type ComprehensiveGranularity,
} from '../comprehensive-analysis.js';

// ── 共享配置 ──

const BASE_WHERE = "policy_date >= '2026-01-01' AND policy_date <= '2026-03-31'";
const BASE_CUTOFF = '2026-03-31';

const BASE_DIM_CONFIG: ComprehensiveMetricQueryConfig = {
  dimension: 'org',
  whereClause: BASE_WHERE,
  cutoffDate: BASE_CUTOFF,
};

// ═══════════════════════════════════════════════════
// 1. generateComprehensiveDimensionMetricsQuery
// ═══════════════════════════════════════════════════

describe('generateComprehensiveDimensionMetricsQuery', () => {
  it('基本结构：包含 policy_exposure CTE 和 PolicyFact', () => {
    const sql = generateComprehensiveDimensionMetricsQuery(BASE_DIM_CONFIG);
    expect(sql).toContain('policy_exposure AS');
    expect(sql).toContain('FROM PolicyFact');
  });

  it('包含 dim_agg 和 totals CTE', () => {
    const sql = generateComprehensiveDimensionMetricsQuery(BASE_DIM_CONFIG);
    expect(sql).toContain('dim_agg AS');
    expect(sql).toContain('totals AS');
  });

  it('org 维度使用 org_level_3 字段', () => {
    const sql = generateComprehensiveDimensionMetricsQuery({
      ...BASE_DIM_CONFIG,
      dimension: 'org',
    });
    expect(sql).toContain('org_level_3');
  });

  it('category 维度使用 customer_category 字段', () => {
    const sql = generateComprehensiveDimensionMetricsQuery({
      ...BASE_DIM_CONFIG,
      dimension: 'category',
    });
    expect(sql).toContain('customer_category');
  });

  it('business 维度使用 coverage_combination 字段', () => {
    const sql = generateComprehensiveDimensionMetricsQuery({
      ...BASE_DIM_CONFIG,
      dimension: 'business',
    });
    expect(sql).toContain('coverage_combination');
  });

  it('输出包含核心财务指标列', () => {
    const sql = generateComprehensiveDimensionMetricsQuery(BASE_DIM_CONFIG);
    expect(sql).toContain('signed_premium');
    expect(sql).toContain('reported_claims');
    expect(sql).toContain('fee_amount');
    expect(sql).toContain('earned_premium');
  });

  it('输出包含赔付率和费用率', () => {
    const sql = generateComprehensiveDimensionMetricsQuery(BASE_DIM_CONFIG);
    expect(sql).toContain('earned_claim_ratio');
    expect(sql).toContain('expense_ratio');
    expect(sql).toContain('variable_cost_ratio');
  });

  it('输出包含份额指标', () => {
    const sql = generateComprehensiveDimensionMetricsQuery(BASE_DIM_CONFIG);
    expect(sql).toContain('premium_share');
    expect(sql).toContain('claim_share');
    expect(sql).toContain('expense_share');
  });

  it('输出包含案均赔款和出险频率', () => {
    const sql = generateComprehensiveDimensionMetricsQuery(BASE_DIM_CONFIG);
    expect(sql).toContain('avg_claim_amount');
    expect(sql).toContain('claim_frequency');
  });

  it('WHERE 子句正确注入', () => {
    const sql = generateComprehensiveDimensionMetricsQuery({
      ...BASE_DIM_CONFIG,
      whereClause: "customer_category = '非营业个人客车'",
    });
    expect(sql).toContain("customer_category = '非营业个人客车'");
  });

  it('cutoffDate 正确注入到满期天数计算', () => {
    const sql = generateComprehensiveDimensionMetricsQuery({
      ...BASE_DIM_CONFIG,
      cutoffDate: '2026-06-30',
    });
    expect(sql).toContain("DATE '2026-06-30'");
  });

  it('dim_type 列输出维度类型标识', () => {
    const sql = generateComprehensiveDimensionMetricsQuery({
      ...BASE_DIM_CONFIG,
      dimension: 'category',
    });
    expect(sql).toContain("'category' AS dim_type");
  });

  it('ORDER BY signed_premium DESC', () => {
    const sql = generateComprehensiveDimensionMetricsQuery(BASE_DIM_CONFIG);
    expect(sql).toContain('ORDER BY d.signed_premium DESC');
  });

  it('使用 COALESCE 处理空维度值', () => {
    const sql = generateComprehensiveDimensionMetricsQuery(BASE_DIM_CONFIG);
    expect(sql).toContain("COALESCE(");
    expect(sql).toContain("'未知'");
  });

  it('三种维度都能生成有效 SQL', () => {
    const dimensions: ComprehensiveDimension[] = ['org', 'category', 'business'];
    for (const dimension of dimensions) {
      const sql = generateComprehensiveDimensionMetricsQuery({
        ...BASE_DIM_CONFIG,
        dimension,
      });
      expect(sql.length).toBeGreaterThan(100);
      expect(sql).toContain('PolicyFact');
    }
  });
});

// ═══════════════════════════════════════════════════
// 2. generateComprehensiveSummaryQuery
// ═══════════════════════════════════════════════════

describe('generateComprehensiveSummaryQuery', () => {
  it('基本结构：包含 policy_exposure CTE 和 PolicyFact', () => {
    const sql = generateComprehensiveSummaryQuery(BASE_WHERE, BASE_CUTOFF);
    expect(sql).toContain('policy_exposure AS');
    expect(sql).toContain('FROM PolicyFact');
  });

  it('输出汇总级财务指标', () => {
    const sql = generateComprehensiveSummaryQuery(BASE_WHERE, BASE_CUTOFF);
    expect(sql).toContain('signed_premium');
    expect(sql).toContain('reported_claims');
    expect(sql).toContain('earned_premium');
    expect(sql).toContain('policy_count');
  });

  it('输出汇总级赔付率和费用率', () => {
    const sql = generateComprehensiveSummaryQuery(BASE_WHERE, BASE_CUTOFF);
    expect(sql).toContain('earned_claim_ratio');
    expect(sql).toContain('expense_ratio');
    expect(sql).toContain('variable_cost_ratio');
  });

  it('WHERE 子句正确注入', () => {
    const sql = generateComprehensiveSummaryQuery(
      "org_level_3 = '天府'",
      BASE_CUTOFF
    );
    expect(sql).toContain("org_level_3 = '天府'");
  });

  it('cutoffDate 正确注入', () => {
    const sql = generateComprehensiveSummaryQuery(BASE_WHERE, '2026-12-31');
    expect(sql).toContain("DATE '2026-12-31'");
  });

  it('使用 SUM 聚合（汇总行，无 GROUP BY）', () => {
    const sql = generateComprehensiveSummaryQuery(BASE_WHERE, BASE_CUTOFF);
    expect(sql).toContain('SUM(premium)');
    expect(sql).toContain('SUM(reported_claims)');
  });

  it('不包含 GROUP BY（汇总行）', () => {
    const sql = generateComprehensiveSummaryQuery(BASE_WHERE, BASE_CUTOFF);
    // 汇总查询是全量聚合，不需要 GROUP BY
    expect(sql).not.toMatch(/GROUP BY(?!.*policy_exposure)/);
  });
});

// ═══════════════════════════════════════════════════
// 3. generateComprehensiveLossTrendQuery
// ═══════════════════════════════════════════════════

describe('generateComprehensiveLossTrendQuery', () => {
  it('基本结构：包含 period_agg 和 total_claims CTE', () => {
    const sql = generateComprehensiveLossTrendQuery(BASE_WHERE, BASE_CUTOFF, 'monthly');
    expect(sql).toContain('period_agg AS');
    expect(sql).toContain('total_claims AS');
  });

  it('monthly 粒度使用 DATE_TRUNC month + STRFTIME %Y-%m', () => {
    const sql = generateComprehensiveLossTrendQuery(BASE_WHERE, BASE_CUTOFF, 'monthly');
    expect(sql).toContain("DATE_TRUNC('month'");
    expect(sql).toContain("'%Y-%m'");
  });

  it('weekly 粒度使用 DATE_TRUNC week', () => {
    const sql = generateComprehensiveLossTrendQuery(BASE_WHERE, BASE_CUTOFF, 'weekly');
    expect(sql).toContain("DATE_TRUNC('week'");
  });

  it('daily 粒度使用 STRFTIME %Y-%m-%d（无 DATE_TRUNC）', () => {
    const sql = generateComprehensiveLossTrendQuery(BASE_WHERE, BASE_CUTOFF, 'daily');
    expect(sql).toContain("'%Y-%m-%d'");
    // daily 不使用 DATE_TRUNC，直接 STRFTIME
    expect(sql).not.toContain("DATE_TRUNC('day'");
  });

  it('输出 time_period、reported_claims、earned_premium、earned_claim_ratio', () => {
    const sql = generateComprehensiveLossTrendQuery(BASE_WHERE, BASE_CUTOFF, 'monthly');
    expect(sql).toContain('time_period');
    expect(sql).toContain('reported_claims');
    expect(sql).toContain('earned_premium');
    expect(sql).toContain('earned_claim_ratio');
  });

  it('输出 claim_share（赔款份额占比）', () => {
    const sql = generateComprehensiveLossTrendQuery(BASE_WHERE, BASE_CUTOFF, 'monthly');
    expect(sql).toContain('claim_share');
    expect(sql).toContain('total_reported_claims');
  });

  it('ORDER BY time_period ASC 保证时序', () => {
    const sql = generateComprehensiveLossTrendQuery(BASE_WHERE, BASE_CUTOFF, 'monthly');
    expect(sql).toContain('ORDER BY p.time_period ASC');
  });

  it('三种粒度都能生成有效 SQL', () => {
    const granularities: ComprehensiveGranularity[] = ['daily', 'weekly', 'monthly'];
    for (const granularity of granularities) {
      const sql = generateComprehensiveLossTrendQuery(BASE_WHERE, BASE_CUTOFF, granularity);
      expect(sql.length).toBeGreaterThan(100);
      expect(sql).toContain('PolicyFact');
    }
  });
});

// ═══════════════════════════════════════════════════
// 4. generateComprehensivePlanByOrgQuery
// ═══════════════════════════════════════════════════

describe('generateComprehensivePlanByOrgQuery', () => {
  it('基本结构：查询 achievement_cache 表', () => {
    const sql = generateComprehensivePlanByOrgQuery(2026);
    expect(sql).toContain('FROM achievement_cache');
  });

  it('plan_year 参数正确注入', () => {
    const sql = generateComprehensivePlanByOrgQuery(2026);
    expect(sql).toContain('plan_year = 2026');
  });

  it('输出 dim_key 和 plan_premium 列', () => {
    const sql = generateComprehensivePlanByOrgQuery(2026);
    expect(sql).toContain('org_name AS dim_key');
    expect(sql).toContain('plan_premium');
  });

  it('无机构筛选时不生成 IN 子句', () => {
    const sql = generateComprehensivePlanByOrgQuery(2026, []);
    expect(sql).not.toContain('IN (');
  });

  it('单个机构筛选生成 IN 子句', () => {
    const sql = generateComprehensivePlanByOrgQuery(2026, ['天府']);
    expect(sql).toContain("IN (");
    expect(sql).toContain("'天府'");
  });

  it('多个机构筛选生成逗号分隔的 IN 列表', () => {
    const sql = generateComprehensivePlanByOrgQuery(2026, ['天府', '乐山', '自贡']);
    expect(sql).toContain("'天府'");
    expect(sql).toContain("'乐山'");
    expect(sql).toContain("'自贡'");
  });

  it("机构名含单引号时自动转义（SQL 注入防护）", () => {
    const sql = generateComprehensivePlanByOrgQuery(2026, ["O'Brien机构"]);
    expect(sql).toContain("O''Brien机构");
  });

  it('GROUP BY org_name', () => {
    const sql = generateComprehensivePlanByOrgQuery(2026);
    expect(sql).toContain('GROUP BY org_name');
  });

  it('不同计划年度正确注入', () => {
    const sql2025 = generateComprehensivePlanByOrgQuery(2025);
    const sql2026 = generateComprehensivePlanByOrgQuery(2026);
    expect(sql2025).toContain('plan_year = 2025');
    expect(sql2026).toContain('plan_year = 2026');
    expect(sql2025).not.toContain('plan_year = 2026');
  });
});
