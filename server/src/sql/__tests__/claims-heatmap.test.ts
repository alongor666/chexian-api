import { describe, expect, it } from 'vitest';
import {
  generateClaimsHeatmapQuery,
  type ClaimsHeatmapFilters,
  type ClaimsDateField,
} from '../claims-heatmap.js';
import type { HeatmapGroupDimension } from '../performance-heatmap.js';

const EMPTY: ClaimsHeatmapFilters = {};

const FULL: ClaimsHeatmapFilters = {
  orgName: '天府',
  customerCategory: '非营业个人客车',
  isNev: '1',
  coverageCombination: '主全',
  isTransfer: 'false',
  vehicleQuickFilter: 'home_car',
  businessNature: 'non_commercial',
  isNewCar: 'false',
  isRenewal: 'true',
};

// ═══════════════════════════════════════════════════
// 1. cohort 口径核心断言：分子分母均按 insurance_start_date 归期
// ═══════════════════════════════════════════════════

describe('generateClaimsHeatmapQuery — cohort 口径', () => {
  it('保费侧 cur_premium_data 按 insurance_start_date 归 period', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time');
    expect(sql).toMatch(/cur_premium_data AS[\s\S]*?CAST\(p\.insurance_start_date AS DATE\) >= ap\.period_start/);
  });

  it('赔案侧 cur_claims_data 按 p.insurance_start_date 归 period（不再按 claimsDateField）', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time');
    expect(sql).toMatch(/cur_claims_data AS[\s\S]*?CAST\(p\.insurance_start_date AS DATE\) >= ap\.period_start/);
    expect(sql).toMatch(/cur_claims_data AS[\s\S]*?CAST\(p\.insurance_start_date AS DATE\) <= ap\.period_end/);
  });

  it('赔案侧 cur_claims_data 不包含按 c.report_time/c.accident_time 归期的 JOIN 条件', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time');
    expect(sql).not.toMatch(/cur_claims_data AS[\s\S]*?CAST\(c\.report_time AS DATE\) >= ap\.period_start/);
    expect(sql).not.toMatch(/cur_claims_data AS[\s\S]*?CAST\(c\.accident_time AS DATE\) >= ap\.period_start/);
  });

  it('claimsDateField 仅作为纳入过滤：c.{field} <= max_date 出现在 WHERE', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time');
    expect(sql).toMatch(/cur_claims_data AS[\s\S]*?CAST\(c\.report_time AS DATE\) <= \(SELECT max_date FROM ref_date\)/);
  });

  it('claimsDateField=accident_time 时 WHERE 用 c.accident_time 而非 c.report_time', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'accident_time');
    expect(sql).toMatch(/cur_claims_data AS[\s\S]*?CAST\(c\.accident_time AS DATE\) <= \(SELECT max_date FROM ref_date\)/);
    expect(sql).not.toMatch(/cur_claims_data AS[\s\S]*?CAST\(c\.report_time AS DATE\) <= \(SELECT max_date FROM ref_date\)/);
  });
});

// ═══════════════════════════════════════════════════
// 2. 去年同期对称性
// ═══════════════════════════════════════════════════

describe('generateClaimsHeatmapQuery — YoY 对称', () => {
  it('prev_claims_data 同样按 insurance_start_date - 1 年归期', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY);
    expect(sql).toMatch(
      /prev_claims_data AS[\s\S]*?CAST\(p\.insurance_start_date AS DATE\) >= \(ap\.period_start - INTERVAL 1 YEAR\)::DATE/
    );
    expect(sql).toMatch(
      /prev_claims_data AS[\s\S]*?CAST\(p\.insurance_start_date AS DATE\) <= \(ap\.period_end - INTERVAL 1 YEAR\)::DATE/
    );
  });

  it('prev_claims_data 的 claimsDateField 截止 = max_date - 1 YEAR', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time');
    expect(sql).toMatch(
      /prev_claims_data AS[\s\S]*?CAST\(c\.report_time AS DATE\) <= \(SELECT max_date FROM ref_date\) - INTERVAL 1 YEAR/
    );
  });

  it('prev_claims_data 不再按 c.{claimsDateField} 归期', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY);
    expect(sql).not.toMatch(/prev_claims_data AS[\s\S]*?CAST\(c\.report_time AS DATE\) >= \(ap\.period_start/);
    expect(sql).not.toMatch(/prev_claims_data AS[\s\S]*?CAST\(c\.accident_time AS DATE\) >= \(ap\.period_start/);
  });
});

// ═══════════════════════════════════════════════════
// 3. 5 个指标的输出列与公式
// ═══════════════════════════════════════════════════

describe('generateClaimsHeatmapQuery — 输出列', () => {
  const sql = generateClaimsHeatmapQuery(EMPTY);

  it('5 个当年指标列名齐全', () => {
    expect(sql).toContain('AS loss_ratio_pct');
    expect(sql).toContain('AS avg_claim');
    expect(sql).toContain('AS incident_rate_pct');
    expect(sql).toContain('AS claim_count');
    expect(sql).toContain('AS total_claims_wan');
  });

  it('5 个 YoY 指标列名齐全', () => {
    expect(sql).toContain('AS yoy_loss_ratio_pct');
    expect(sql).toContain('AS yoy_avg_claim');
    expect(sql).toContain('AS yoy_incident_rate_pct');
    expect(sql).toContain('AS yoy_claim_count');
    expect(sql).toContain('AS yoy_total_claims_wan');
  });

  it('满期出险率公式：claim_count / earned_exposure', () => {
    expect(sql).toMatch(/COALESCE\(cc\.claim_count, 0\) \* 100\.0 \/ cp\.earned_exposure/);
  });

  it('满期赔付率公式：total_claims_wan / earned_premium_wan', () => {
    expect(sql).toMatch(/COALESCE\(cc\.total_claims_wan, 0\) \* 100\.0 \/ cp\.earned_premium_wan/);
  });
});

// ═══════════════════════════════════════════════════
// 4. 维度与筛选注入（防回归）
// ═══════════════════════════════════════════════════

describe('generateClaimsHeatmapQuery — 维度切片', () => {
  const dims: HeatmapGroupDimension[] = [
    'org_level_3', 'team', 'salesman', 'customer_category',
    'coverage_combination', 'energy_type', 'business_nature', 'insurance_grade',
  ];

  it.each(dims)('维度 %s 生成的 SQL 含 dimension_value AS', (d) => {
    const sql = generateClaimsHeatmapQuery(EMPTY, d);
    expect(sql).toContain('AS dimension_value');
  });

  it('team 维度触发 SalesmanTeamMapping LEFT JOIN', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'team');
    expect(sql).toContain('LEFT JOIN SalesmanTeamMapping tm');
  });

  it('FULL 筛选器全部注入', () => {
    const sql = generateClaimsHeatmapQuery(FULL);
    expect(sql).toContain("p.org_level_3 = '天府'");
    expect(sql).toContain("p.customer_category = '非营业个人客车'");
    expect(sql).toContain('p.is_nev = true');
    expect(sql).toContain("p.coverage_combination = '主全'");
    expect(sql).toContain('p.is_transfer = false');
    expect(sql).toContain('p.is_new_car = false');
    expect(sql).toContain('p.is_renewal = true');
  });

  it('vehicleQuickFilter=motorcycle 注入摩托车筛选', () => {
    const sql = generateClaimsHeatmapQuery({ vehicleQuickFilter: 'motorcycle' });
    expect(sql).toContain("p.customer_category = '摩托车'");
  });
});

// ═══════════════════════════════════════════════════
// 5. 安全：白名单兜底
// ═══════════════════════════════════════════════════

describe('generateClaimsHeatmapQuery — 安全', () => {
  it('非法 dateField 兜底为 insurance_start_date', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'evil; DROP TABLE--');
    expect(sql).not.toContain('evil');
    expect(sql).toContain('p.insurance_start_date');
  });

  it('非法 claimsDateField 兜底为 report_time', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'evil' as ClaimsDateField);
    expect(sql).not.toContain("c.evil");
    expect(sql).toContain('c.report_time');
  });

  it('SQL 单引号转义生效（escapeSqlValue）', () => {
    const sql = generateClaimsHeatmapQuery({ orgName: "天'府" });
    expect(sql).toContain("p.org_level_3 = '天''府'");
  });
});
