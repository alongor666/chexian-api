import { describe, expect, it } from 'vitest';
import {
  normalizeExpenseSurplusRows,
  normalizeLossTrendRows,
  normalizeMetricRow,
  normalizeMetricRows,
  normalizeRoiRows,
  toSummaryNullableNumber,
  toSummaryNumber,
} from '../../src/features/comprehensive-analysis/adapters/common';

describe('normalizeMetricRow · 逐字段边界', () => {
  it('快乐路径：完整 snake_case 原始行逐字段映射为 camelCase', () => {
    const raw = {
      dim_type: 'business',
      dim_key: '团队A',
      rank: 2,
      policy_count: 120,
      signed_premium: 1000,
      reported_claims: 300,
      fee_amount: 90,
      claim_cases: 12,
      earned_premium: 500,
      earned_claim_ratio: 60,
      expense_ratio: 9,
      variable_cost_ratio: 69,
      avg_claim_amount: 25,
      claim_frequency: 0.3,
      premium_share: 35,
      claim_share: 33,
      expense_share: 30,
      plan_premium: 1200,
      achievement_rate: 83.3,
    };
    expect(normalizeMetricRow(raw)).toEqual({
      dimType: 'business',
      dimKey: '团队A',
      rank: 2,
      policyCount: 120,
      signedPremium: 1000,
      reportedClaims: 300,
      feeAmount: 90,
      claimCases: 12,
      earnedPremium: 500,
      earnedClaimRatio: 60,
      expenseRatio: 9,
      variableCostRatio: 69,
      avgClaimAmount: 25,
      claimFrequency: 0.3,
      premiumShare: 35,
      claimShare: 33,
      expenseShare: 30,
      planPremium: 1200,
      achievementRate: 83.3,
    });
  });

  it('数值字段 fallback：undefined / 非数字串 / Infinity / NaN → 0；null → 0（Number(null)===0）', () => {
    expect(normalizeMetricRow({ signed_premium: undefined }).signedPremium).toBe(0);
    expect(normalizeMetricRow({ signed_premium: 'abc' }).signedPremium).toBe(0);
    expect(normalizeMetricRow({ signed_premium: Infinity }).signedPremium).toBe(0);
    expect(normalizeMetricRow({ signed_premium: NaN }).signedPremium).toBe(0);
    expect(normalizeMetricRow({ signed_premium: null }).signedPremium).toBe(0);
    expect(normalizeMetricRow({ signed_premium: '1234' }).signedPremium).toBe(1234);
  });

  it('可空数值字段：null / undefined / 非数字 / Infinity → null；0 与有效数字串保留', () => {
    expect(normalizeMetricRow({ earned_claim_ratio: null }).earnedClaimRatio).toBeNull();
    expect(normalizeMetricRow({ earned_claim_ratio: undefined }).earnedClaimRatio).toBeNull();
    expect(normalizeMetricRow({ earned_claim_ratio: 'abc' }).earnedClaimRatio).toBeNull();
    expect(normalizeMetricRow({ earned_claim_ratio: Infinity }).earnedClaimRatio).toBeNull();
    expect(normalizeMetricRow({ earned_claim_ratio: 0 }).earnedClaimRatio).toBe(0);
    expect(normalizeMetricRow({ earned_claim_ratio: '5.5' }).earnedClaimRatio).toBe(5.5);
  });

  it('dimType 白名单：org / category / business 保留，其余与缺省 → org', () => {
    expect(normalizeMetricRow({ dim_type: 'org' }).dimType).toBe('org');
    expect(normalizeMetricRow({ dim_type: 'category' }).dimType).toBe('category');
    expect(normalizeMetricRow({ dim_type: 'business' }).dimType).toBe('business');
    expect(normalizeMetricRow({ dim_type: 'team' }).dimType).toBe('org');
    expect(normalizeMetricRow({}).dimType).toBe('org');
  });

  it('dimKey：nullish → 未知；0 → "0"；空串保留为空串（空串非 nullish）', () => {
    expect(normalizeMetricRow({ dim_key: undefined }).dimKey).toBe('未知');
    expect(normalizeMetricRow({ dim_key: null }).dimKey).toBe('未知');
    expect(normalizeMetricRow({ dim_key: 0 }).dimKey).toBe('0');
    expect(normalizeMetricRow({ dim_key: '' }).dimKey).toBe('');
    expect(normalizeMetricRow({ dim_key: '高新' }).dimKey).toBe('高新');
  });

  it('rank：缺省 → 1；0 / 负数 → 1（Math.max(1,..)）；小数四舍五入', () => {
    expect(normalizeMetricRow({}).rank).toBe(1);
    expect(normalizeMetricRow({ rank: 0 }).rank).toBe(1);
    expect(normalizeMetricRow({ rank: -5 }).rank).toBe(1);
    expect(normalizeMetricRow({ rank: 3.6 }).rank).toBe(4);
    expect(normalizeMetricRow({ rank: 2 }).rank).toBe(2);
  });

  it('policyCount / claimCases：缺省 → 0；负数 → 0（Math.max(0,..)）；小数四舍五入', () => {
    expect(normalizeMetricRow({}).policyCount).toBe(0);
    expect(normalizeMetricRow({ policy_count: -3 }).policyCount).toBe(0);
    expect(normalizeMetricRow({ policy_count: 3.4 }).policyCount).toBe(3);
    expect(normalizeMetricRow({ claim_cases: 2.5 }).claimCases).toBe(3);
    expect(normalizeMetricRow({ claim_cases: -1 }).claimCases).toBe(0);
  });
});

describe('normalizeMetricRows · 数组与默认空', () => {
  it('undefined → []（默认参数）', () => {
    expect(normalizeMetricRows(undefined)).toEqual([]);
  });
  it('[] → []', () => {
    expect(normalizeMetricRows([])).toEqual([]);
  });
  it('多行保持长度与顺序', () => {
    const out = normalizeMetricRows([{ dim_key: 'A' }, { dim_key: 'B' }]);
    expect(out.map((r) => r.dimKey)).toEqual(['A', 'B']);
  });
});

describe('normalizeLossTrendRows', () => {
  it('undefined → []（默认参数）', () => {
    expect(normalizeLossTrendRows(undefined)).toEqual([]);
  });
  it('time_period 缺省 → 空串；数值字段 fallback', () => {
    expect(normalizeLossTrendRows([{ reported_claims: 'x' }])).toEqual([
      { timePeriod: '', reportedClaims: 0, earnedPremium: 0, earnedClaimRatio: null, claimShare: 0 },
    ]);
  });
  it('完整行映射', () => {
    expect(
      normalizeLossTrendRows([
        { time_period: '2026-01', reported_claims: 100, earned_premium: 500, earned_claim_ratio: 20, claim_share: 10 },
      ])
    ).toEqual([{ timePeriod: '2026-01', reportedClaims: 100, earnedPremium: 500, earnedClaimRatio: 20, claimShare: 10 }]);
  });
});

describe('normalizeExpenseSurplusRows · camelCase ?? snake_case 回退', () => {
  it('undefined → []（默认参数）', () => {
    expect(normalizeExpenseSurplusRows(undefined)).toEqual([]);
  });
  it('仅 snake_case → 采用', () => {
    expect(
      normalizeExpenseSurplusRows([{ dim_key: 'A', expense_rate_deviation: 2, expense_surplus_amount: 9 }])
    ).toEqual([{ dimType: 'org', dimKey: 'A', expenseRateDeviation: 2, expenseSurplusAmount: 9 }]);
  });
  it('仅 camelCase → 采用', () => {
    expect(
      normalizeExpenseSurplusRows([{ dim_key: 'A', expenseRateDeviation: 3, expenseSurplusAmount: 8 }])
    ).toEqual([{ dimType: 'org', dimKey: 'A', expenseRateDeviation: 3, expenseSurplusAmount: 8 }]);
  });
  it('两者都给 → camelCase 优先（?? 左值非 nullish 取左）', () => {
    expect(
      normalizeExpenseSurplusRows([{ expenseRateDeviation: 3, expense_rate_deviation: 99 }])[0].expenseRateDeviation
    ).toBe(3);
  });
  it('camelCase 为 0 → 保留 0（?? 不回退；锁住勿误改成 ||）', () => {
    expect(
      normalizeExpenseSurplusRows([{ expenseRateDeviation: 0, expense_rate_deviation: 99 }])[0].expenseRateDeviation
    ).toBe(0);
  });
  it('camelCase 为 null → 回退 snake_case', () => {
    expect(
      normalizeExpenseSurplusRows([{ expenseRateDeviation: null, expense_rate_deviation: 7 }])[0].expenseRateDeviation
    ).toBe(7);
  });

  it('兄弟字段 expenseSurplusAmount 同样 0 保留 / null 回退', () => {
    expect(
      normalizeExpenseSurplusRows([{ expenseSurplusAmount: 0, expense_surplus_amount: 99 }])[0].expenseSurplusAmount
    ).toBe(0);
    expect(
      normalizeExpenseSurplusRows([{ expenseSurplusAmount: null, expense_surplus_amount: 7 }])[0].expenseSurplusAmount
    ).toBe(7);
  });
});

describe('normalizeRoiRows · camelCase ?? snake_case 回退', () => {
  it('undefined → []（默认参数）', () => {
    expect(normalizeRoiRows(undefined)).toEqual([]);
  });
  it('snake_case 全字段映射', () => {
    expect(
      normalizeRoiRows([
        {
          dim_key: 'A',
          signed_premium: 1000,
          expense_amount: 100,
          margin_contribution: 200,
          expense_output_premium_ratio: 10,
          expense_output_margin_ratio: 2,
          margin_rate: 20,
        },
      ])
    ).toEqual([
      {
        dimType: 'org',
        dimKey: 'A',
        signedPremium: 1000,
        expenseAmount: 100,
        marginContribution: 200,
        expenseOutputPremiumRatio: 10,
        expenseOutputMarginRatio: 2,
        marginRate: 20,
      },
    ]);
  });
  it('camelCase 0 左值保留（?? 语义）', () => {
    expect(normalizeRoiRows([{ marginRate: 0, margin_rate: 50 }])[0].marginRate).toBe(0);
  });
  it('camelCase null → 回退 snake_case', () => {
    expect(normalizeRoiRows([{ marginContribution: null, margin_contribution: 5 }])[0].marginContribution).toBe(5);
  });

  it('兄弟字段 expenseOutputPremiumRatio / expenseOutputMarginRatio 同样 0 保留 / null 回退', () => {
    const zero = normalizeRoiRows([
      {
        expenseOutputPremiumRatio: 0,
        expense_output_premium_ratio: 9,
        expenseOutputMarginRatio: 0,
        expense_output_margin_ratio: 9,
      },
    ])[0];
    expect(zero.expenseOutputPremiumRatio).toBe(0);
    expect(zero.expenseOutputMarginRatio).toBe(0);

    const fallback = normalizeRoiRows([
      {
        expenseOutputPremiumRatio: null,
        expense_output_premium_ratio: 3,
        expenseOutputMarginRatio: null,
        expense_output_margin_ratio: 4,
      },
    ])[0];
    expect(fallback.expenseOutputPremiumRatio).toBe(3);
    expect(fallback.expenseOutputMarginRatio).toBe(4);
  });
});

describe('toSummaryNumber / toSummaryNullableNumber', () => {
  it('toSummaryNumber：undefined / null / 非数字 → 0；有效值保留', () => {
    expect(toSummaryNumber(undefined)).toBe(0);
    expect(toSummaryNumber(null)).toBe(0);
    expect(toSummaryNumber('abc')).toBe(0);
    expect(toSummaryNumber('12')).toBe(12);
  });
  it('toSummaryNullableNumber：null / undefined / 非数字 → null；0 保留', () => {
    expect(toSummaryNullableNumber(undefined)).toBeNull();
    expect(toSummaryNullableNumber(null)).toBeNull();
    expect(toSummaryNullableNumber('abc')).toBeNull();
    expect(toSummaryNullableNumber(0)).toBe(0);
  });
});
