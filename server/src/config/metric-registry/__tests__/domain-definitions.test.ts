/**
 * 领域断言 — 公式语义验证
 *
 * 验证每个指标的 testCase assertion 字段与 SQL AS alias 匹配，
 * 以及关键指标的公式分子分母语义正确性。
 * Layer 1: 零 DuckDB 依赖，CI 安全。
 */

import { describe, expect, it } from 'vitest';
import { getAllMetrics, getMetric, getMetricsByCategory } from '../index.js';
import type { TestAssertion } from '../types.js';
import { L4_METRIC_IDS, extractAliases } from './test-helpers.js';

// ═══════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════

/** 校验 TestAssertion op 是否合法 */
const VALID_OPS = new Set(['gt', 'gte', 'between', 'type', 'notNull']);
function isValidAssertion(assertion: TestAssertion): boolean {
  if (typeof assertion === 'number') return true;
  return VALID_OPS.has(assertion.op);
}

// ═══════════════════════════════════════════════════
// 1. 全局: testCase assertion 字段与 SQL AS alias 匹配
// ═══════════════════════════════════════════════════

describe('所有指标: testCase assertion 字段匹配 SQL AS alias', () => {
  const executableMetrics = getAllMetrics().filter((m) => !L4_METRIC_IDS.has(m.id));

  it.each(executableMetrics.map((m) => [m.id, m] as const))(
    '%s — assertion keys ⊆ SQL aliases',
    (_id, metric) => {
      const aliases = extractAliases(metric.sql.expression);
      for (const tc of metric.testCases) {
        for (const field of Object.keys(tc.assertions)) {
          expect(
            aliases.has(field.toLowerCase()),
            `${metric.id} / ${tc.name}: assertion field "${field}" 不在 SQL aliases [${[...aliases].join(', ')}] 中`,
          ).toBe(true);
        }
      }
    },
  );
});

// ═══════════════════════════════════════════════════
// 2. 全局: testCase assertion 结构合法性
// ═══════════════════════════════════════════════════

describe('所有指标: testCase assertion 结构合法', () => {
  const allMetrics = getAllMetrics();

  it.each(allMetrics.map((m) => [m.id, m] as const))(
    '%s — assertion op 类型合法',
    (_id, metric) => {
      for (const tc of metric.testCases) {
        for (const [field, assertion] of Object.entries(tc.assertions)) {
          expect(
            isValidAssertion(assertion),
            `${metric.id} / ${tc.name}: field "${field}" assertion op 不合法`,
          ).toBe(true);
        }
      }
    },
  );
});

// ═══════════════════════════════════════════════════
// 3. 赔付率 (earned_claim_ratio): 分子分母正确性
// ═══════════════════════════════════════════════════

describe('赔付率 (earned_claim_ratio) 公式语义', () => {
  const m = getMetric('earned_claim_ratio')!;

  it('formula.numerator 含 reported_claims（已报告赔款）', () => {
    expect(m.formula.numerator).toContain('reported_claims');
  });

  it('formula.numerator 不含 settled_amount（仅已决赔款）', () => {
    expect(m.formula.numerator).not.toContain('settled_amount');
  });

  it('formula.description 含 "已报告赔款"', () => {
    expect(m.formula.description).toContain('已报告赔款');
  });

  it('requiredColumns 含 reported_claims 与闰年感知天数（earned_days + policy_term）', () => {
    expect(m.sql.requiredColumns).toContain('reported_claims');
    expect(m.sql.requiredColumns).toContain('earned_days');
    expect(m.sql.requiredColumns).toContain('policy_term');
  });
});

// ═══════════════════════════════════════════════════
// 4. 满期保费 (earned_premium): 闰年感知
// ═══════════════════════════════════════════════════

describe('满期保费 (earned_premium) 闰年感知', () => {
  const m = getMetric('earned_premium')!;

  it('sql.expression 含 earned_days', () => {
    expect(m.sql.expression).toContain('earned_days');
  });

  it('sql.expression 含 policy_term', () => {
    expect(m.sql.expression).toContain('policy_term');
  });

  it('requiredColumns 含 earned_days 和 policy_term', () => {
    expect(m.sql.requiredColumns).toContain('earned_days');
    expect(m.sql.requiredColumns).toContain('policy_term');
  });

  it('formula.description 含 "闰年"', () => {
    expect(m.formula.description).toContain('闰年');
  });
});

describe('满期率 (maturity_rate) 与满期保费同源', () => {
  const m = getMetric('maturity_rate')!;

  it('注册为截止日口径的不可加百分比指标', () => {
    expect(m).toBeDefined();
    expect(m.timeWindow).toBe('cutoff-based');
    expect(m.additive).toBe(false);
    expect(m.formula.unit).toBe('%');
  });

  it('分子闰年感知且分母为同口径签单保费', () => {
    expect(m.formula.numerator).toContain('earned_days / policy_term');
    expect(m.formula.denominator).toBe('SUM(premium)');
    expect(m.sql.requiredColumns).toEqual(['premium', 'earned_days', 'policy_term']);
  });
});

// ═══════════════════════════════════════════════════
// 5. 基准保费链路: 基准保费 → 满期基准保费 → 满期基准赔付率
// ═══════════════════════════════════════════════════

describe('商业险基准保费链路', () => {
  const baselinePremium = getMetric('baseline_premium');
  const baselineEarnedPremium = getMetric('baseline_earned_premium');
  const baselineEarnedClaimRatio = getMetric('baseline_earned_claim_ratio');

  it('注册 baseline_premium（基准保费）', () => {
    expect(baselinePremium).toBeDefined();
    expect(baselinePremium!.formula.description).toContain('基准保费');
  });

  it('注册 baseline_earned_premium（满期基准保费）', () => {
    expect(baselineEarnedPremium).toBeDefined();
    expect(baselineEarnedPremium!.formula.description).toContain('满期基准保费');
  });

  it('注册 baseline_earned_claim_ratio（满期基准赔付率）', () => {
    expect(baselineEarnedClaimRatio).toBeDefined();
    expect(baselineEarnedClaimRatio!.formula.description).toContain('满期基准赔付率');
  });

  it('满期基准保费由基准保费乘满期因子得到', () => {
    expect(baselineEarnedPremium!.formula.numerator).toContain('baseline_premium');
    // SQL 自包含展开（codex P1 修复）：直接消费底表字段而非引用别名
    expect(baselineEarnedPremium!.sql.requiredColumns).toContain('premium');
    expect(baselineEarnedPremium!.sql.requiredColumns).toContain('commercial_pricing_factor');
    expect(baselineEarnedPremium!.sql.requiredColumns).toContain('earned_days');
    expect(baselineEarnedPremium!.sql.requiredColumns).toContain('policy_term');
  });

  it('满期基准赔付率分母使用满期基准保费', () => {
    expect(baselineEarnedClaimRatio!.formula.denominator).toContain('baseline_earned_premium');
    expect(baselineEarnedClaimRatio!.sql.requiredColumns).toContain('reported_claims');
    // SQL 自包含展开（codex P1 修复）
    expect(baselineEarnedClaimRatio!.sql.requiredColumns).toContain('premium');
    expect(baselineEarnedClaimRatio!.sql.requiredColumns).toContain('commercial_pricing_factor');
  });
});

// ═══════════════════════════════════════════════════
// 6. 满期出险率 (earned_loss_frequency): 已赚暴露 + 年化
// ═══════════════════════════════════════════════════

describe('满期出险率 (earned_loss_frequency) 年化公式', () => {
  const m = getMetric('earned_loss_frequency')!;

  it('formula.numerator 含 policy_term / earned_days（年化因子）', () => {
    expect(m.formula.numerator).toMatch(/policy_term/);
    expect(m.formula.numerator).toMatch(/earned_days/);
  });

  it('formula.denominator 是 COUNT(DISTINCT policy_no) 但结合年化使用', () => {
    expect(m.formula.denominator).toContain('policy_no');
  });

  it('sql.notes 含 "闰年"', () => {
    expect(m.sql.notes).toContain('闰年');
  });
});

// ═══════════════════════════════════════════════════
// 6. 整体推介率 (cross_sell_total_rate): 预聚合来源
// ═══════════════════════════════════════════════════

describe('整体推介率 (cross_sell_total_rate) 预聚合来源', () => {
  const m = getMetric('cross_sell_total_rate')!;

  it('sql.notes 含 CrossSellDailyAgg（说明数据源）', () => {
    expect(m.sql.notes).toContain('CrossSellDailyAgg');
  });

  it('分子分母限定主全/交三（红线：分母不含纯交强/单交）', () => {
    expect(m.sql.expression).toContain("coverage_combination IN ('主全', '交三')");
    expect(m.sql.requiredColumns).toContain('coverage_combination');
  });

  it('requiredColumns 含 auto_count 和 driver_count', () => {
    expect(m.sql.requiredColumns).toContain('auto_count');
    expect(m.sql.requiredColumns).toContain('driver_count');
  });
});

// ═══════════════════════════════════════════════════
// 7. 车均保费 (per_vehicle_premium): 车架号回退
// ═══════════════════════════════════════════════════

describe('车均保费 (per_vehicle_premium) 车架号回退', () => {
  const m = getMetric('per_vehicle_premium')!;

  it('requiredColumns 含 vehicle_frame_no 和 policy_no', () => {
    expect(m.sql.requiredColumns).toContain('vehicle_frame_no');
    expect(m.sql.requiredColumns).toContain('policy_no');
  });

  it('sql.expression 含 COALESCE（车架号为空时回退保单号）', () => {
    expect(m.sql.expression).toContain('COALESCE');
  });
});

// ═══════════════════════════════════════════════════
// 8. ratio 类: between 断言值域合理
// ═══════════════════════════════════════════════════

describe('ratio 类指标: between 断言值域合理', () => {
  const ratioMetrics = getMetricsByCategory('ratio');

  it.each(ratioMetrics.map((m) => [m.id, m] as const))(
    '%s — between 值域 min>=0',
    (_id, metric) => {
      for (const tc of metric.testCases) {
        for (const [, assertion] of Object.entries(tc.assertions)) {
          if (typeof assertion === 'object' && assertion.op === 'between') {
            expect(assertion.min).toBeGreaterThanOrEqual(0);
          }
        }
      }
    },
  );
});
