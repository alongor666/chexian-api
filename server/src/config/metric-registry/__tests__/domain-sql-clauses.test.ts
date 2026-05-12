/**
 * 领域断言 — SQL 表达式关键词强制
 *
 * 验证关键指标的 SQL 表达式包含正确的业务逻辑关键词。
 * 捕获公式漂移：如赔付率分子被换成 settled_amount、出险率分母被改成 COUNT(*) 等。
 * Layer 1: 零 DuckDB 依赖，CI 安全。
 */

import { describe, expect, it } from 'vitest';
import { getMetric, getMetricsByCategory } from '../index.js';
import { L4_METRIC_IDS } from './test-helpers.js';

// ═══════════════════════════════════════════════════
// 1. 赔付率 SQL
// ═══════════════════════════════════════════════════

describe('赔付率 (earned_claim_ratio) SQL 关键词', () => {
  const sql = getMetric('earned_claim_ratio')!.sql.expression;

  it('分子引用 reported_claims', () => {
    expect(sql).toContain('reported_claims');
  });

  it('分子不以 settled_amount 作独立分子', () => {
    // settled_amount 可能出现在 notes 中，但不应是 SUM 的主参数
    expect(sql).not.toMatch(/SUM\s*\(\s*settled_amount\s*\)/i);
  });

  it('分母含 earned_days + policy_term（CTE 预计算闰年感知满期因子）', () => {
    expect(sql).toContain('earned_days');
    expect(sql).toContain('policy_term');
  });

  it('分母不硬编码 / 365（闰年感知：必须用 policy_term）', () => {
    expect(sql).not.toMatch(/\/\s*365(?:\.0)?/);
  });

  it('分母非裸 SUM(premium) 独立做除数', () => {
    // 正确：SUM(premium * earned_days / policy_term)
    // 错误：SUM(reported_claims) / SUM(premium) — 缺少满期因子
    expect(sql).not.toMatch(
      /SUM\s*\(\s*reported_claims\s*\)\s*\*?\s*100\.?0?\s*\/\s*SUM\s*\(\s*premium\s*\)\s/i,
    );
  });
});

// ═══════════════════════════════════════════════════
// 2. 满期保费 SQL — 闰年感知
// ═══════════════════════════════════════════════════

describe('满期保费 (earned_premium) SQL 闰年感知', () => {
  const sql = getMetric('earned_premium')!.sql.expression;

  it('使用 earned_days（动态满期天数）', () => {
    expect(sql).toContain('earned_days');
  });

  it('使用 policy_term（动态保险期限）', () => {
    expect(sql).toContain('policy_term');
  });

  it('不固定 / 365 做分母', () => {
    // earned_premium 应用 policy_term(365或366)，不用硬编码 365
    expect(sql).not.toMatch(/\/\s*365(?:\.0)?\s*\)/);
  });
});

// ═══════════════════════════════════════════════════
// 3. 基准保费 SQL — 商业险先归一，再进入满期口径
// ═══════════════════════════════════════════════════

describe('基准保费 SQL — 商业险自主系数归一', () => {
  const baselinePremiumSql = getMetric('baseline_premium')!.sql.expression;
  const baselineEarnedPremiumSql = getMetric('baseline_earned_premium')!.sql.expression;
  const baselineEarnedClaimRatioSql = getMetric('baseline_earned_claim_ratio')!.sql.expression;

  it('baseline_premium 仅商业险除以 commercial_pricing_factor', () => {
    expect(baselinePremiumSql).toContain('insurance_type');
    expect(baselinePremiumSql).toContain('commercial_pricing_factor');
    expect(baselinePremiumSql).toMatch(/premium\s*\/\s*NULLIF\s*\(\s*commercial_pricing_factor/i);
  });

  it('baseline_earned_premium 自包含 SQL（内联 commercial_pricing_factor CASE + 满期因子）', () => {
    expect(baselineEarnedPremiumSql).toContain('commercial_pricing_factor');
    expect(baselineEarnedPremiumSql).toContain('earned_days');
    expect(baselineEarnedPremiumSql).toContain('policy_term');
  });

  it('baseline_earned_claim_ratio 自包含 SQL（reported_claims 分子 + 内联满期基准保费分母）', () => {
    expect(baselineEarnedClaimRatioSql).toContain('reported_claims');
    expect(baselineEarnedClaimRatioSql).toContain('commercial_pricing_factor');
    expect(baselineEarnedClaimRatioSql).not.toMatch(/\/\s*SUM\s*\(\s*premium\s*\)/i);
  });
});

// ═══════════════════════════════════════════════════
// 4. 满期出险率 SQL — 年化公式
// ═══════════════════════════════════════════════════

describe('满期出险率 (earned_loss_frequency) SQL 年化公式', () => {
  const sql = getMetric('earned_loss_frequency')!.sql.expression;

  it('含 policy_term（年化放大因子）', () => {
    expect(sql).toContain('policy_term');
  });

  it('含 earned_days（暴露天数）', () => {
    expect(sql).toContain('earned_days');
  });

  it('含 claim_cases（赔案件数）', () => {
    expect(sql).toContain('claim_cases');
  });

  it('分母用 COUNT(DISTINCT policy_no)（保单去重）', () => {
    expect(sql).toMatch(/COUNT\s*\(\s*DISTINCT\s+policy_no\s*\)/i);
  });

  it('不以 COUNT(*) 做主分母', () => {
    expect(sql).not.toMatch(/\/\s*NULLIF\s*\(\s*COUNT\s*\(\s*\*\s*\)/i);
  });
});

// ═══════════════════════════════════════════════════
// 4. 推介率 SQL — 预计算计数器
// ═══════════════════════════════════════════════════

describe('推介率 SQL — 预计算计数器', () => {
  it('cross_sell_total_rate 分母用 auto_count，不用 COUNT(*)', () => {
    const sql = getMetric('cross_sell_total_rate')!.sql.expression;
    expect(sql).toContain('auto_count');
    expect(sql).not.toMatch(/\/\s*NULLIF\s*\(\s*COUNT\s*\(\s*\*\s*\)/i);
  });

  it('cross_sell_danjiao_rate 分母用 danjiao_auto_count', () => {
    const sql = getMetric('cross_sell_danjiao_rate')!.sql.expression;
    expect(sql).toContain('danjiao_auto_count');
  });

  it('cross_sell_jiaosan_rate 分母用 jiaosan_auto_count', () => {
    const sql = getMetric('cross_sell_jiaosan_rate')!.sql.expression;
    expect(sql).toContain('jiaosan_auto_count');
  });

  it('cross_sell_zhuquan_rate 分母用 zhuquan_auto_count', () => {
    const sql = getMetric('cross_sell_zhuquan_rate')!.sql.expression;
    expect(sql).toContain('zhuquan_auto_count');
  });
});

// ═══════════════════════════════════════════════════
// 5. 变动成本率 SQL — 绝对值除法
// ═══════════════════════════════════════════════════

describe('变动成本率 (variable_cost_ratio) SQL 绝对值除法', () => {
  const sql = getMetric('variable_cost_ratio')!.sql.expression;

  it('含 SUM(reported_claims)（赔付率分子）', () => {
    expect(sql).toMatch(/SUM\s*\(\s*reported_claims\s*\)/i);
  });

  it('含 SUM(.*fee_amount.*)（费用率分子）', () => {
    expect(sql).toMatch(/SUM\s*\(\s*COALESCE\s*\(\s*fee_amount/i);
  });

  it('不直接引用 earned_claim_ratio 或 expense_ratio 做加法', () => {
    // 变动成本率应从绝对值 SUM/SUM 计算，不是率值相加
    expect(sql).not.toMatch(/earned_claim_ratio\s*\+\s*expense_ratio/i);
  });
});

// ═══════════════════════════════════════════════════
// 6. 边际贡献额 SQL — 从绝对值计算
// ═══════════════════════════════════════════════════

describe('边际贡献额 SQL — 从绝对值计算', () => {
  it('earned_margin_amount 含 SUM(reported_claims)', () => {
    const sql = getMetric('earned_margin_amount')!.sql.expression;
    expect(sql).toMatch(/SUM\s*\(\s*reported_claims\s*\)/i);
  });

  it('projected_margin_amount 含 SUM(reported_claims)', () => {
    const sql = getMetric('projected_margin_amount')!.sql.expression;
    expect(sql).toMatch(/SUM\s*\(\s*reported_claims\s*\)/i);
  });

  it('边际贡献额不直接引用 variable_cost_ratio', () => {
    const earned = getMetric('earned_margin_amount')!.sql.expression;
    const projected = getMetric('projected_margin_amount')!.sql.expression;
    expect(earned).not.toContain('variable_cost_ratio');
    expect(projected).not.toContain('variable_cost_ratio');
  });
});

// ═══════════════════════════════════════════════════
// 7. 费用率 SQL — 引用 fee_amount
// ═══════════════════════════════════════════════════

describe('费用率 (expense_ratio) SQL', () => {
  const sql = getMetric('expense_ratio')!.sql.expression;

  it('分子含 fee_amount', () => {
    expect(sql).toContain('fee_amount');
  });

  it('分母含 SUM(premium)', () => {
    expect(sql).toMatch(/SUM\s*\(\s*premium\s*\)/i);
  });
});

// ═══════════════════════════════════════════════════
// 8. cost 类非 L4 指标: 无 AVG 聚合
// ═══════════════════════════════════════════════════

describe('cost 类非 L4 指标: 无 AVG 聚合率值', () => {
  const executableCost = getMetricsByCategory('cost').filter(
    (m) => !L4_METRIC_IDS.has(m.id),
  );

  it.each(executableCost.map((m) => [m.id, m] as const))(
    '%s — SQL 不含 AVG() 聚合',
    (_id, metric) => {
      expect(metric.sql.expression).not.toMatch(/\bAVG\s*\(/i);
    },
  );
});
