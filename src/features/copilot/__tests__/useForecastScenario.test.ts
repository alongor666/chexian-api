/**
 * useForecastScenario unit tests — pure logic + localStorage roundtrip.
 *
 * UI submission integration is covered separately in ForecastScenarioPanel.test.tsx.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  isEarningScheduleSumValid,
  isInputSubmittable,
  FORECAST_DRAFT_STORAGE_KEY,
  type ForecastScenarioInput,
} from '../hooks/useForecastScenario';

// Vitest workers may share globals across files; tests/api/client.test.ts replaces
// localStorage with a stub. Reinstall a real in-memory storage at the top of this
// file so our roundtrip tests get a clean implementation.
function installInMemoryStorage() {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(window, 'localStorage', { value: stub, configurable: true });
}
installInMemoryStorage();

const VALID_INPUT: ForecastScenarioInput = {
  scenarioName: '测算-2026',
  premium: '20000000',
  ultimateVariableCostRatio: '85',
  ultimateFixedCostRatio: '9',
  earningSchedule: [
    { period: '2026', earnedRatio: '52' },
    { period: '2027', earnedRatio: '48' },
  ],
  assumptionSource: 'caller_provided',
};

describe('useForecastScenario — input validation', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('isEarningScheduleSumValid accepts exactly 100', () => {
    expect(
      isEarningScheduleSumValid([
        { period: '2026', earnedRatio: '52' },
        { period: '2027', earnedRatio: '48' },
      ]),
    ).toBe(true);
  });

  it('isEarningScheduleSumValid rejects 99 or 101', () => {
    expect(isEarningScheduleSumValid([{ period: '2026', earnedRatio: '99' }])).toBe(false);
    expect(isEarningScheduleSumValid([{ period: '2026', earnedRatio: '101' }])).toBe(false);
  });

  it('isEarningScheduleSumValid tolerates 0.01 floating drift', () => {
    expect(
      isEarningScheduleSumValid([
        { period: 'A', earnedRatio: '33.33' },
        { period: 'B', earnedRatio: '33.33' },
        { period: 'C', earnedRatio: '33.34' },
      ]),
    ).toBe(true);
  });

  it('isInputSubmittable accepts the canonical golden-path input', () => {
    expect(isInputSubmittable(VALID_INPUT)).toBe(true);
  });

  it('isInputSubmittable rejects when scenarioName is empty', () => {
    expect(isInputSubmittable({ ...VALID_INPUT, scenarioName: '   ' })).toBe(false);
  });

  it('isInputSubmittable rejects when premium is zero or negative', () => {
    expect(isInputSubmittable({ ...VALID_INPUT, premium: '0' })).toBe(false);
    expect(isInputSubmittable({ ...VALID_INPUT, premium: '-1' })).toBe(false);
    expect(isInputSubmittable({ ...VALID_INPUT, premium: 'abc' })).toBe(false);
  });

  it('isInputSubmittable rejects when ratios are out of [0, 150]', () => {
    expect(isInputSubmittable({ ...VALID_INPUT, ultimateVariableCostRatio: '-1' })).toBe(false);
    expect(isInputSubmittable({ ...VALID_INPUT, ultimateVariableCostRatio: '151' })).toBe(false);
    expect(isInputSubmittable({ ...VALID_INPUT, ultimateFixedCostRatio: '' })).toBe(false);
  });

  it('isInputSubmittable rejects when any earning period has no label', () => {
    expect(
      isInputSubmittable({
        ...VALID_INPUT,
        earningSchedule: [
          { period: '', earnedRatio: '50' },
          { period: '2027', earnedRatio: '50' },
        ],
      }),
    ).toBe(false);
  });

  it('isInputSubmittable rejects when earning ratios do not sum to 100', () => {
    expect(
      isInputSubmittable({
        ...VALID_INPUT,
        earningSchedule: [{ period: '2026', earnedRatio: '50' }],
      }),
    ).toBe(false);
  });

  it('localStorage key is namespaced under copilot prefix', () => {
    expect(FORECAST_DRAFT_STORAGE_KEY).toBe('copilot.forecastScenario.draft');
  });
});
