/**
 * 领域断言 — 业务治理规则
 *
 * 强制执行保险领域约束：定价系数范围、风险等级语义、出险率口径。
 * Layer 1: 零 DuckDB 依赖，CI 安全。
 */

import { describe, expect, it } from 'vitest';
import { getAllMetrics, getMetric } from '../index.js';

// ═══════════════════════════════════════════════════
// 1. 定价系数仅适用商业险
// ═══════════════════════════════════════════════════

describe('定价系数仅适用商业险', () => {
  it('含 pricing_factor 的指标 requiredColumns 必含 insurance_type', () => {
    const metricsWithPricing = getAllMetrics().filter((m) =>
      m.sql.requiredColumns.includes('pricing_factor'),
    );
    for (const m of metricsWithPricing) {
      expect(
        m.sql.requiredColumns,
        `${m.id} 使用 pricing_factor 但缺少 insurance_type 约束`,
      ).toContain('insurance_type');
    }
  });
});

// ═══════════════════════════════════════════════════
// 2. 风险等级是结构性数据，非可控因子
// ═══════════════════════════════════════════════════

describe('风险等级 (insurance_grade) 是结构性数据', () => {
  it('无指标 SQL 含 SET/UPDATE insurance_grade', () => {
    for (const m of getAllMetrics()) {
      expect(
        m.sql.expression,
        `${m.id} SQL 试图修改 insurance_grade`,
      ).not.toMatch(/(?:SET|UPDATE)\s+insurance_grade/i);
    }
  });

  it('无指标将 insurance_grade 作为可修改因子', () => {
    for (const m of getAllMetrics()) {
      expect(
        m.formula.description,
        `${m.id} 公式描述不应将风险等级视为可控输入`,
      ).not.toMatch(/调整.*insurance_grade|修改.*风险等级/i);
    }
  });
});

// ═══════════════════════════════════════════════════
// 3. 出险率口径: 已赚暴露，非签单件数
// ═══════════════════════════════════════════════════

describe('出险率口径: 已赚暴露', () => {
  const lossFreq = getMetric('earned_loss_frequency');

  it('earned_loss_frequency 存在于注册表', () => {
    expect(lossFreq).toBeDefined();
  });

  it('SQL 含 earned_days（暴露天数）', () => {
    expect(lossFreq!.sql.expression).toContain('earned_days');
  });

  it('SQL 含 policy_term（年化因子）', () => {
    expect(lossFreq!.sql.expression).toContain('policy_term');
  });

  it('SQL 不以 COUNT(*) 做主分母', () => {
    // 出险率分母应基于暴露量，非简单计数
    expect(lossFreq!.sql.expression).not.toMatch(
      /\/\s*NULLIF\s*\(\s*COUNT\s*\(\s*\*\s*\)/i,
    );
  });

  it('requiredColumns 含 earned_days', () => {
    expect(lossFreq!.sql.requiredColumns).toContain('earned_days');
  });
});

// ═══════════════════════════════════════════════════
// 4. 增长率允许负值
// ═══════════════════════════════════════════════════

describe('增长率指标: 允许负值', () => {
  const GROWTH_IDS = ['growth_rate_yoy', 'growth_rate_mom'];

  it.each(GROWTH_IDS)('%s testCase 不断言 gte:0', (id) => {
    const m = getMetric(id);
    expect(m).toBeDefined();
    for (const tc of m!.testCases) {
      for (const [field, assertion] of Object.entries(tc.assertions)) {
        if (typeof assertion === 'object' && assertion.op === 'gte') {
          expect(
            assertion.value,
            `${id} / ${field}: 增长率不应断言 >=0，允许负增长`,
          ).not.toBe(0);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════
// 5. 赔付率分子: 已报告赔款
// ═══════════════════════════════════════════════════

describe('赔付率分子必须是已报告赔款', () => {
  const claimRatio = getMetric('earned_claim_ratio');

  it('formula.numerator 含 reported_claims', () => {
    expect(claimRatio!.formula.numerator).toContain('reported_claims');
  });

  it('formula.description 含 "已报告赔款"', () => {
    expect(claimRatio!.formula.description).toContain('已报告赔款');
  });
});

// ═══════════════════════════════════════════════════
// 6. 所有非 L4 指标 SQL 含 AS alias
// ═══════════════════════════════════════════════════

describe('所有非 L4 指标 SQL 含 AS alias', () => {
  const L4_IDS = new Set([
    'fixed_cost_amount', 'fixed_cost_ratio',
    'combined_cost_amount', 'combined_cost_ratio',
    'earned_profit_amount',
  ]);

  it('每个可执行指标 SQL 含 AS 关键字', () => {
    const executableMetrics = getAllMetrics().filter((m) => !L4_IDS.has(m.id));
    for (const m of executableMetrics) {
      expect(
        m.sql.expression,
        `${m.id} SQL 缺少 AS alias`,
      ).toMatch(/\bAS\b/i);
    }
  });
});
