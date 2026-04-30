/**
 * useForecastBaseline 派生函数测试
 *
 * 重点覆盖 v2 panel 的算法核心 —— mode picker 到 profit-scenario 入参的派生逻辑：
 *  - pickLossRatioByMode (5 模式：optimistic / median / pessimistic / custom / historical)
 *  - pickGrowthByMode (4 模式：optimistic / median / pessimistic / custom)
 *  - pickExpenseRatioByMode (2 模式：historical_mean / custom)
 *  - deriveScenario：组合 V1-V4 + actual + 用户输入 fc → 单情景 profit-scenario 入参
 *
 * 不依赖 fetch / DOM / React，纯函数测试。
 */

import { describe, it, expect } from 'vitest';
import {
  pickLossRatioByMode,
  pickGrowthByMode,
  pickExpenseRatioByMode,
  deriveScenario,
  type ForecastBaselineData,
  type ScenarioModeInput,
  FORECAST_BASELINE_INITIAL_SCENARIO,
} from '../../../src/features/copilot/hooks/useForecastBaseline';

// ──────────────────────────────────────────────
// Fixture: 模拟 baseline 响应
// ──────────────────────────────────────────────

const FIXTURE_BASELINE: ForecastBaselineData = {
  cutoffDate: '2026-06-30',
  filters: {},
  historyWindowYears: 3,
  recentExpenseMonths: 6,
  actual: {
    signedPremium: 20_000_000,
    earnedPremium: 10_400_000,
    earnedRatioPct: 52.0,
    cumulativeReportedClaims: 8_500_000,
    earnedClaimRatioPct: 81.73,
    cumulativeFee: 3_000_000,
    feeRatioPct: 15.0,
    remainingExposure: 9_600_000,
    policyCount: 12345,
  },
  variables: {
    historicalLossRatio: {
      windowYears: 3,
      cohorts: [
        { year: 2023, premium: 18_000_000, claims: 14_400_000, lossRatioPct: 80.0 },
        { year: 2024, premium: 19_000_000, claims: 15_770_000, lossRatioPct: 83.0 },
        { year: 2025, premium: 19_500_000, claims: 17_160_000, lossRatioPct: 88.0 },
      ],
      percentiles: { p25: 81.5, p50: 83.0, p75: 85.5 },
      cohortCount: 3,
    },
    newSigningPremiumGrowth: {
      windowYears: 3,
      samples: [],
      percentiles: { p25: 2.0, p50: 5.0, p75: 8.0 },
      sampleCount: 3,
    },
    newSigningLossRatio: {
      windowYears: 3,
      cohorts: [
        { year: 2023, premium: 18_000_000, claims: 14_400_000, lossRatioPct: 80.0 },
        { year: 2024, premium: 19_000_000, claims: 15_770_000, lossRatioPct: 83.0 },
        { year: 2025, premium: 19_500_000, claims: 17_160_000, lossRatioPct: 88.0 },
      ],
      percentiles: { p25: 81.5, p50: 83.0, p75: 85.5 },
      cohortCount: 3,
    },
    newSigningExpenseRatio: {
      windowMonths: 6,
      recentSignedPremium: 10_000_000,
      recentFee: 1_500_000,
      meanExpenseRatioPct: 15.0,
      policyCount: 6000,
    },
  },
  defaults: {
    v1HistoricalLossRatio: { p25: 81.5, p50: 83.0, p75: 85.5 },
    v2NewSigningPremiumGrowth: { p25: 2.0, p50: 5.0, p75: 8.0 },
    v3NewSigningLossRatio: { p25: 81.5, p50: 83.0, p75: 85.5 },
    v4NewSigningExpenseRatio: 15.0,
  },
  warnings: ['baseline forecast 仅供参考，非财务报表利润。'],
  forbiddenInterpretations: ['财务报表利润', '法定承保利润', '审计利润'],
};

const PCTS = { p25: 81.5, p50: 83.0, p75: 85.5 };

// ──────────────────────────────────────────────
// pickLossRatioByMode
// ──────────────────────────────────────────────

describe('pickLossRatioByMode', () => {
  it('returns p25 for optimistic (lower loss = better)', () => {
    expect(pickLossRatioByMode('optimistic', PCTS, '', [], '')).toBe(81.5);
  });

  it('returns p50 for median', () => {
    expect(pickLossRatioByMode('median', PCTS, '', [], '')).toBe(83.0);
  });

  it('returns p75 for pessimistic (higher loss = worse)', () => {
    expect(pickLossRatioByMode('pessimistic', PCTS, '', [], '')).toBe(85.5);
  });

  it('parses custom value', () => {
    expect(pickLossRatioByMode('custom', PCTS, '90.5', [], '')).toBe(90.5);
  });

  it('returns null for invalid custom value', () => {
    expect(pickLossRatioByMode('custom', PCTS, '', [], '')).toBeNull();
    expect(pickLossRatioByMode('custom', PCTS, 'abc', [], '')).toBeNull();
  });

  it('finds historical cohort year', () => {
    const cohorts = FIXTURE_BASELINE.variables.historicalLossRatio.cohorts;
    expect(pickLossRatioByMode('historical', PCTS, '', cohorts, '2024')).toBe(83.0);
    expect(pickLossRatioByMode('historical', PCTS, '', cohorts, '2025')).toBe(88.0);
  });

  it('returns null if historical year not in cohorts', () => {
    const cohorts = FIXTURE_BASELINE.variables.historicalLossRatio.cohorts;
    expect(pickLossRatioByMode('historical', PCTS, '', cohorts, '2099')).toBeNull();
    expect(pickLossRatioByMode('historical', PCTS, '', cohorts, '')).toBeNull();
  });
});

// ──────────────────────────────────────────────
// pickGrowthByMode
// ──────────────────────────────────────────────

describe('pickGrowthByMode', () => {
  it('returns p75 for optimistic (higher growth = better)', () => {
    expect(pickGrowthByMode('optimistic', { p25: 2, p50: 5, p75: 8 }, '')).toBe(8);
  });

  it('returns p50 for median', () => {
    expect(pickGrowthByMode('median', { p25: 2, p50: 5, p75: 8 }, '')).toBe(5);
  });

  it('returns p25 for pessimistic (lower growth = worse)', () => {
    expect(pickGrowthByMode('pessimistic', { p25: 2, p50: 5, p75: 8 }, '')).toBe(2);
  });

  it('parses custom value (can be negative)', () => {
    expect(pickGrowthByMode('custom', { p25: 2, p50: 5, p75: 8 }, '-3.5')).toBe(-3.5);
  });

  it('returns null for invalid custom value', () => {
    expect(pickGrowthByMode('custom', { p25: 2, p50: 5, p75: 8 }, '')).toBeNull();
  });
});

// ──────────────────────────────────────────────
// pickExpenseRatioByMode
// ──────────────────────────────────────────────

describe('pickExpenseRatioByMode', () => {
  it('returns mean for historical_mean', () => {
    expect(pickExpenseRatioByMode('historical_mean', 15.0, '')).toBe(15.0);
  });

  it('parses custom value', () => {
    expect(pickExpenseRatioByMode('custom', 15.0, '12')).toBe(12);
  });

  it('returns null for invalid custom value', () => {
    expect(pickExpenseRatioByMode('custom', 15.0, '')).toBeNull();
  });
});

// ──────────────────────────────────────────────
// deriveScenario - golden path
// ──────────────────────────────────────────────

describe('deriveScenario - golden path', () => {
  const baseScenario: ScenarioModeInput = {
    ...FORECAST_BASELINE_INITIAL_SCENARIO,
    v1Mode: 'median',
    v2Mode: 'median',
    v3Mode: 'median',
    v4Mode: 'historical_mean',
    ultimateFixedCostRatio: '9',
    forecastPeriod: '2027',
  };

  it('derives premium = signedPremium × (1 + V2/100)', () => {
    const result = deriveScenario(FIXTURE_BASELINE, baseScenario);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // V2 median = 5%, signedPremium = 20_000_000 → premium = 21_000_000
      expect(result.scenario.premium).toBeCloseTo(21_000_000, 2);
    }
  });

  it('derives ultimateVariableCostRatio = V3 + V4', () => {
    const result = deriveScenario(FIXTURE_BASELINE, baseScenario);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // V3 median = 83.0, V4 mean = 15.0 → vc = 98.0
      expect(result.scenario.ultimateVariableCostRatio).toBeCloseTo(98.0, 2);
    }
  });

  it('passes through user-input fc to ultimateFixedCostRatio', () => {
    const result = deriveScenario(FIXTURE_BASELINE, baseScenario);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.ultimateFixedCostRatio).toBe(9);
    }
  });

  it('builds single-period earningSchedule with earnedRatio=100', () => {
    const result = deriveScenario(FIXTURE_BASELINE, baseScenario);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.earningSchedule).toEqual([{ period: '2027', earnedRatio: 100 }]);
    }
  });

  it('marks assumptionSource as derived_from_metric_registry', () => {
    const result = deriveScenario(FIXTURE_BASELINE, baseScenario);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.assumptionSource).toBe('derived_from_metric_registry');
    }
  });

  it('exposes resolved V1-V4 values for UI回显', () => {
    const result = deriveScenario(FIXTURE_BASELINE, baseScenario);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.resolved).toEqual({ v1: 83.0, v2: 5.0, v3: 83.0, v4: 15.0 });
    }
  });

  it('combines optimistic mode → uses p25 for V1/V3, p75 for V2', () => {
    const optimistic: ScenarioModeInput = {
      ...baseScenario,
      v1Mode: 'optimistic',
      v2Mode: 'optimistic',
      v3Mode: 'optimistic',
    };
    const result = deriveScenario(FIXTURE_BASELINE, optimistic);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.resolved.v1).toBe(81.5);
      expect(result.scenario.resolved.v2).toBe(8.0); // p75 (high growth = optimistic)
      expect(result.scenario.resolved.v3).toBe(81.5);
    }
  });

  it('combines pessimistic mode → uses p75 for V1/V3, p25 for V2', () => {
    const pessimistic: ScenarioModeInput = {
      ...baseScenario,
      v1Mode: 'pessimistic',
      v2Mode: 'pessimistic',
      v3Mode: 'pessimistic',
    };
    const result = deriveScenario(FIXTURE_BASELINE, pessimistic);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.resolved.v1).toBe(85.5);
      expect(result.scenario.resolved.v2).toBe(2.0); // p25 (low growth = pessimistic)
      expect(result.scenario.resolved.v3).toBe(85.5);
    }
  });

  it('historical replay picks the cohort year value', () => {
    const replay: ScenarioModeInput = {
      ...baseScenario,
      v3Mode: 'historical',
      v3HistoricalYear: '2025',
    };
    const result = deriveScenario(FIXTURE_BASELINE, replay);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.resolved.v3).toBe(88.0);
    }
  });
});

// ──────────────────────────────────────────────
// deriveScenario - validation failures
// ──────────────────────────────────────────────

describe('deriveScenario - validation failures', () => {
  const goodBase: ScenarioModeInput = {
    ...FORECAST_BASELINE_INITIAL_SCENARIO,
    v1Mode: 'median',
    v2Mode: 'median',
    v3Mode: 'median',
    v4Mode: 'historical_mean',
    ultimateFixedCostRatio: '9',
    forecastPeriod: '2027',
  };

  it('rejects missing fc', () => {
    const bad = { ...goodBase, ultimateFixedCostRatio: '' };
    const result = deriveScenario(FIXTURE_BASELINE, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/固定成本率/);
    }
  });

  it('rejects fc out of [0, 150]', () => {
    const bad = { ...goodBase, ultimateFixedCostRatio: '200' };
    const result = deriveScenario(FIXTURE_BASELINE, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/\[0,\s*150\]/);
    }
  });

  it('rejects missing forecastPeriod', () => {
    const bad = { ...goodBase, forecastPeriod: '' };
    const result = deriveScenario(FIXTURE_BASELINE, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/期间/);
    }
  });

  it('rejects missing custom V1', () => {
    const bad = { ...goodBase, v1Mode: 'custom' as const, v1CustomValue: '' };
    const result = deriveScenario(FIXTURE_BASELINE, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/V1/);
    }
  });

  it('rejects historical V3 without selected year', () => {
    const bad = { ...goodBase, v3Mode: 'historical' as const, v3HistoricalYear: '' };
    const result = deriveScenario(FIXTURE_BASELINE, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/V3/);
    }
  });

  it('rejects derived vc > 150 with extreme inputs', () => {
    const bad: ScenarioModeInput = {
      ...goodBase,
      v3Mode: 'custom',
      v3CustomValue: '140',
      v4Mode: 'custom',
      v4CustomValue: '20',
    };
    const result = deriveScenario(FIXTURE_BASELINE, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/变动成本率.*150/);
    }
  });
});
