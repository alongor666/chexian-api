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
// 1. 累计发展口径核心断言
// ═══════════════════════════════════════════════════

describe('generateClaimsHeatmapQuery — 累计发展口径', () => {
  it('cur_premium_cumulative 按 insurance_start_date ≤ cutoff 累计', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time', 2026);
    expect(sql).toMatch(/cur_premium_cumulative AS[\s\S]*?CAST\(p\.insurance_start_date AS DATE\) <= ac\.cutoff/);
  });

  it('cur_claims_cumulative 同 cohort 且赔案 claimsDateField ≤ cutoff', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time', 2026);
    expect(sql).toMatch(/cur_claims_cumulative AS[\s\S]*?CAST\(p\.insurance_start_date AS DATE\) <= ac\.cutoff/);
    expect(sql).toMatch(/cur_claims_cumulative AS[\s\S]*?CAST\(c\.report_time AS DATE\) <= ac\.cutoff/);
  });

  it('claimsDateField=accident_time 生效', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'accident_time', 2026);
    expect(sql).toMatch(/cur_claims_cumulative AS[\s\S]*?CAST\(c\.accident_time AS DATE\) <= ac\.cutoff/);
    expect(sql).not.toMatch(/cur_claims_cumulative AS[\s\S]*?CAST\(c\.report_time AS DATE\) <= ac\.cutoff/);
  });

  it('保费 earned 分母按 cutoff 结算（elapsed = cutoff - start + 1）', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY);
    expect(sql).toMatch(/DATE_DIFF\('day', CAST\(p\.insurance_start_date AS DATE\), ac\.cutoff \+ INTERVAL 1 DAY\)/);
  });
});

// ═══════════════════════════════════════════════════
// 2. policyYear 注入与白名单
// ═══════════════════════════════════════════════════

describe('generateClaimsHeatmapQuery — policyYear', () => {
  it('显式 policyYear=2025 注入到 year_bounds 子查询', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time', 2025);
    expect(sql).toContain('2025 AS policy_year');
  });

  it('policyYear 不传时走 max_date 所在年（EXTRACT YEAR from ref_date）', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY);
    expect(sql).toMatch(/EXTRACT\(YEAR FROM \(SELECT max_date FROM ref_date\)\)::INT[\s\S]*?AS policy_year/);
  });

  it('policyYear 越界（<2020）兜底为 max_date 年份', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time', 1999);
    expect(sql).not.toContain('1999');
    expect(sql).toMatch(/EXTRACT\(YEAR FROM \(SELECT max_date FROM ref_date\)\)::INT[\s\S]*?AS policy_year/);
  });

  it('policyYear 越界（>2030）兜底', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time', 2050);
    expect(sql).not.toContain('2050');
  });
});

// ═══════════════════════════════════════════════════
// 3. YoY 对称性（累计口径，偏移 -1 年）
// ═══════════════════════════════════════════════════

describe('generateClaimsHeatmapQuery — YoY 对称', () => {
  it('prev_premium_cumulative 使用 (cutoff - 1 YEAR) 结算', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time', 2026);
    expect(sql).toMatch(
      /prev_premium_cumulative AS[\s\S]*?CAST\(p\.insurance_start_date AS DATE\) <= \(ac\.cutoff - INTERVAL 1 YEAR\)::DATE/
    );
  });

  it('prev_claims_cumulative 的 claimsDateField ≤ (cutoff - 1 YEAR)', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time', 2026);
    expect(sql).toMatch(
      /prev_claims_cumulative AS[\s\S]*?CAST\(c\.report_time AS DATE\) <= \(ac\.cutoff - INTERVAL 1 YEAR\)::DATE/
    );
  });

  it('prev 年份 = policy_year - 1', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'report_time', 2026);
    expect(sql).toMatch(/prev_premium_cumulative AS[\s\S]*?\(SELECT policy_year FROM year_bounds\) - 1/);
  });
});

// ═══════════════════════════════════════════════════
// 4. 输出列
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

  it('period_idx/period_label/period_end/period_type 保留以兼容前端', () => {
    expect(sql).toContain('AS period_idx');
    expect(sql).toContain('AS period_label');
    expect(sql).toContain('AS period_end');
    expect(sql).toContain('AS period_type');
  });

  it('新增 policy_year 字段（累计口径标识）', () => {
    expect(sql).toContain('AS policy_year');
  });

  it('列 cutoff 月度标签为 "X月末"', () => {
    expect(sql).toContain("'月末'");
  });
});

// ═══════════════════════════════════════════════════
// 5. 维度与筛选注入
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
// 6. 安全：白名单兜底
// ═══════════════════════════════════════════════════

describe('generateClaimsHeatmapQuery — 安全', () => {
  it('非法 dateField 兜底（cohort 锚点恒为 insurance_start_date）', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'evil; DROP TABLE--');
    expect(sql).not.toContain('evil');
    expect(sql).toContain('p.insurance_start_date');
  });

  it('非法 claimsDateField 兜底为 report_time', () => {
    const sql = generateClaimsHeatmapQuery(EMPTY, 'org_level_3', 'insurance_start_date', 'evil' as ClaimsDateField);
    expect(sql).not.toContain('c.evil');
    expect(sql).toContain('c.report_time');
  });

  it('SQL 单引号转义生效', () => {
    const sql = generateClaimsHeatmapQuery({ orgName: "天'府" });
    expect(sql).toContain("p.org_level_3 = '天''府'");
  });
});
