import { describe, expect, it } from 'vitest';
import {
  generateOverviewQuery,
  generateOverviewTotalQuery,
  generateTrendQuery,
  generateFunnelQuery,
  generateLossReasonQuery,
  generateCompetitionLossQuery,
  generateCompetitionGainQuery,
  generateActionListQuery,
  generateActionListCountQuery,
} from '../renewal-universe.js';

describe('renewal-universe SQL generators', () => {
  // ── 基本 SQL 结构 ──

  it('generateOverviewQuery: 默认按机构分组', () => {
    const sql = generateOverviewQuery();
    expect(sql).toContain('FROM RenewalUniverse');
    expect(sql).toContain('org_level_3 AS group_name');
    expect(sql).toContain('due_count');
    expect(sql).toContain('renewed_count');
    expect(sql).toContain('renewal_rate');
    expect(sql).toContain('quote_coverage_rate');
    expect(sql).toContain('GROUP BY org_level_3');
  });

  it('generateOverviewQuery: groupBy=salesman', () => {
    const sql = generateOverviewQuery({ groupBy: 'salesman' });
    expect(sql).toContain('salesman_name AS group_name');
    expect(sql).toContain('GROUP BY salesman_name');
  });

  it('generateOverviewQuery: groupBy=category', () => {
    const sql = generateOverviewQuery({ groupBy: 'category' });
    expect(sql).toContain('customer_category AS group_name');
  });

  it('generateOverviewQuery: groupBy=grade', () => {
    const sql = generateOverviewQuery({ groupBy: 'grade' });
    expect(sql).toContain('insurance_grade AS group_name');
  });

  it('generateOverviewTotalQuery: 返回单行汇总', () => {
    const sql = generateOverviewTotalQuery();
    expect(sql).toContain('FROM RenewalUniverse');
    expect(sql).not.toContain('GROUP BY');
    expect(sql).toContain('p1_count');
    expect(sql).toContain('p4_count');
  });

  it('generateTrendQuery: 按月分组', () => {
    const sql = generateTrendQuery();
    expect(sql).toContain('expiry_month');
    expect(sql).toContain('GROUP BY expiry_month');
    expect(sql).toContain('ORDER BY expiry_month');
    expect(sql).toContain('due_premium_wan');
  });

  // ── 漏斗 ──

  it('generateFunnelQuery: 三级漏斗', () => {
    const sql = generateFunnelQuery();
    expect(sql).toContain('funnel_stage');
    expect(sql).toContain('GROUP BY funnel_stage');
    expect(sql).toContain('premium_wan');
  });

  it('generateLossReasonQuery: 流失归因', () => {
    const sql = generateLossReasonQuery();
    expect(sql).toContain('not_quoted_count');
    expect(sql).toContain('quoted_not_renewed_count');
    expect(sql).toContain('org_level_3 AS group_name');
  });

  // ── 竞争 ──

  it('generateCompetitionLossQuery: 流失去向', () => {
    const sql = generateCompetitionLossQuery();
    expect(sql).toContain('lost_to_insurer');
    expect(sql).toContain('NOT is_renewed');
    expect(sql).toContain('LIMIT 20');
  });

  it('generateCompetitionGainQuery: 转入来源', () => {
    const sql = generateCompetitionGainQuery();
    expect(sql).toContain('source_insurer');
    expect(sql).toContain('is_renewed');
    expect(sql).toContain('gain_count');
  });

  // ── 行动看板 ──

  it('generateActionListQuery: 分页', () => {
    const sql = generateActionListQuery({ page: 2, pageSize: 20 });
    expect(sql).toContain('LIMIT 20');
    expect(sql).toContain('OFFSET 20');
    expect(sql).not.toContain('total_count');
    expect(sql).toContain('action_priority');
  });

  it('generateActionListCountQuery: 独立计数', () => {
    const sql = generateActionListCountQuery({ orgName: '天府' });
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('total_count');
    expect(sql).toContain("org_level_3 = '天府'");
    expect(sql).not.toContain('LIMIT');
  });

  it('generateActionListQuery: 默认第1页', () => {
    const sql = generateActionListQuery();
    expect(sql).toContain('LIMIT 20');
    expect(sql).toContain('OFFSET 0');
  });

  it('generateActionListQuery: pageSize 上限 100', () => {
    const sql = generateActionListQuery({ pageSize: 500 });
    expect(sql).toContain('LIMIT 100');
  });

  // ── 筛选器 ──

  it('所有筛选器正确注入 WHERE 子句', () => {
    const sql = generateOverviewQuery({
      orgName: '天府',
      salesmanName: '张三',
      customerCategory: '非营业个人客车',
      expiryMonth: 3,
      funnelStage: 'not_quoted',
      actionPriority: 'P1',
      insuranceGrade: 'A',
    });
    expect(sql).toContain("org_level_3 = '天府'");
    expect(sql).toContain("salesman_name = '张三'");
    expect(sql).toContain("customer_category = '非营业个人客车'");
    expect(sql).toContain('expiry_month = 3');
    expect(sql).toContain("funnel_stage = 'not_quoted'");
    expect(sql).toContain("action_priority = 'P1'");
    expect(sql).toContain("insurance_grade = 'A'");
  });

  it('SQL 注入防护：单引号转义', () => {
    const sql = generateOverviewQuery({ orgName: "O'Brien" });
    expect(sql).toContain("org_level_3 = 'O''Brien'");
    expect(sql).not.toContain("O'Brien'");
  });

  it('日期范围筛选', () => {
    const sql = generateTrendQuery({
      expiryDateStart: '2026-01-01',
      expiryDateEnd: '2026-04-30',
    });
    expect(sql).toContain("expiry_date >= '2026-01-01'");
    expect(sql).toContain("expiry_date <= '2026-04-30'");
  });

  // ── 防御性验证 ──

  it('funnelStage 白名单：拒绝非法值', () => {
    const sql = generateOverviewQuery({ funnelStage: 'hacked' as any });
    expect(sql).not.toContain('hacked');
  });

  it('actionPriority 白名单：拒绝非法值', () => {
    const sql = generateOverviewQuery({ actionPriority: 'P99' });
    expect(sql).not.toContain('P99');
  });

  it('expiryMonth NaN 防护', () => {
    const sql = generateOverviewQuery({ expiryMonth: NaN });
    expect(sql).not.toContain('NaN');
  });

  it('expiryMonth 范围防护：13 月被忽略', () => {
    const sql = generateOverviewQuery({ expiryMonth: 13 });
    expect(sql).not.toContain('expiry_month');
  });
});
