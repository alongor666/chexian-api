/**
 * @vitest-environment jsdom
 *
 * ForecastBaselinePanel smoke test
 *
 * 覆盖：
 *  - 初始空态（未拉取）
 *  - 拉取 baseline → 渲染 actual + 4 picker + 派生预览不可用（缺 fc）
 *  - 输入 fc + period → 派生预览可用 → run scenario → 渲染结果
 *
 * mock：
 *  - fetch 序列化响应：第一调返回 baseline，第二调返回 profit-scenario
 *  - apiClient.getToken：返回固定 token，避免触发刷新
 *  - localStorage：注入内存 shim（兄弟测试的 stub 缺 .clear() 会撞 isolation 坑）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// 必须在 import panel 之前装好 localStorage shim — vitest 模块顶层评估顺序会先执行兄弟文件 stub
const memoryStorage = (() => {
  let store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store = new Map();
    },
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  writable: true,
  configurable: true,
});

// vi.mock 工厂提升 — 与 AuditTimeline.test.tsx 同模式
const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(() => 'fake-jwt'),
}));

vi.mock('../../../src/shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/shared/api/client')>(
    '../../../src/shared/api/client',
  );
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getToken: getTokenMock,
    },
  };
});

import { ForecastBaselinePanel } from '../../../src/features/copilot/components/ForecastBaselinePanel';

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────

const BASELINE_FIXTURE = {
  success: true,
  data: {
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
        cohorts: [{ year: 2024, premium: 1, claims: 1, lossRatioPct: 83 }],
        percentiles: { p25: 81.5, p50: 83.0, p75: 85.5 },
        cohortCount: 1,
      },
      newSigningPremiumGrowth: {
        windowYears: 3,
        samples: [],
        percentiles: { p25: 2, p50: 5, p75: 8 },
        sampleCount: 3,
      },
      newSigningLossRatio: {
        windowYears: 3,
        cohorts: [{ year: 2024, premium: 1, claims: 1, lossRatioPct: 83 }],
        percentiles: { p25: 81.5, p50: 83.0, p75: 85.5 },
        cohortCount: 1,
      },
      newSigningExpenseRatio: {
        windowMonths: 6,
        recentSignedPremium: 1,
        recentFee: 1,
        meanExpenseRatioPct: 15.0,
        policyCount: 1,
      },
    },
    defaults: {
      v1HistoricalLossRatio: { p25: 81.5, p50: 83.0, p75: 85.5 },
      v2NewSigningPremiumGrowth: { p25: 2, p50: 5, p75: 8 },
      v3NewSigningLossRatio: { p25: 81.5, p50: 83.0, p75: 85.5 },
      v4NewSigningExpenseRatio: 15.0,
    },
    warnings: ['baseline forecast 仅供参考。'],
    forbiddenInterpretations: ['财务报表利润'],
  },
};

const PROFIT_SCENARIO_FIXTURE = {
  success: true,
  data: {
    scenarioName: 'baseline 2026-06-30 · V1:中观 V2:中观 V3:中观 V4:近期均值',
    ultimateCombinedCostRatio: 107,
    forecastOperatingProfitMargin: -7,
    perPeriodForecast: [],
    fullCycleForecastOperatingProfit: -1_470_000,
    onePctSensitivity: [],
    warnings: ['forecast 是基于调用方假设的情景计算结果，不是财务报表利润。'],
    forbiddenInterpretations: ['财务报表利润', '法定承保利润', '审计利润'],
    assumptionSource: 'derived_from_metric_registry',
  },
};

// ──────────────────────────────────────────────
// Test setup
// ──────────────────────────────────────────────

beforeEach(() => {
  memoryStorage.clear();
  getTokenMock.mockReturnValue('fake-jwt');
  vi.restoreAllMocks();
});

function mockFetchSequence(...responses: unknown[]) {
  let i = 0;
  const fn = vi.fn().mockImplementation(async () => {
    const body = responses[i] ?? { success: false };
    i += 1;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('ForecastBaselinePanel', () => {
  it('renders empty state before baseline is loaded', () => {
    render(<ForecastBaselinePanel />);
    expect(screen.getByText(/从系统加载已发生数据/)).toBeTruthy();
    // actual / pickers 不应渲染
    expect(screen.queryByTestId('forecast-baseline-actual')).toBeNull();
    expect(screen.queryByTestId('forecast-baseline-mode-pickers')).toBeNull();
  });

  it('loads baseline → renders actual facts and 4 pickers', async () => {
    const fetchMock = mockFetchSequence(BASELINE_FIXTURE);
    render(<ForecastBaselinePanel />);

    fireEvent.click(screen.getByTestId('forecast-baseline-load-button'));

    await waitFor(() => {
      expect(screen.getByTestId('forecast-baseline-actual')).toBeTruthy();
    });

    // 4 picker 都渲染
    expect(screen.getByTestId('picker-v1')).toBeTruthy();
    expect(screen.getByTestId('picker-v2')).toBeTruthy();
    expect(screen.getByTestId('picker-v3')).toBeTruthy();
    expect(screen.getByTestId('picker-v4')).toBeTruthy();

    // actual 区显示已签发保费、已赚保费等关键事实
    const actual = screen.getByTestId('forecast-baseline-actual');
    expect(actual.textContent).toContain('签单保费');
    expect(actual.textContent).toContain('已赚保费');
    expect(actual.textContent).toContain('已发生');
    // policyCount=12345 显示
    expect(actual.textContent).toContain('12345');

    // baseline 警示渲染
    expect(screen.getByText(/baseline forecast 仅供参考/)).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/agent/forecast/baseline');
  });

  it('shows derived preview only when fc and forecastPeriod are valid', async () => {
    mockFetchSequence(BASELINE_FIXTURE);
    render(<ForecastBaselinePanel />);

    fireEvent.click(screen.getByTestId('forecast-baseline-load-button'));
    await waitFor(() => screen.getByTestId('forecast-baseline-actual'));

    // forecastPeriod 应被自动填充为 cutoff 年 + 1 = 2027
    const periodInput = screen.getByLabelText('预测期间') as HTMLInputElement;
    expect(periodInput.value).toBe('2027');

    // 缺 fc → 派生预览不应可见
    expect(screen.queryByTestId('forecast-baseline-derived-preview')).toBeNull();
    // run button 应禁用
    expect((screen.getByTestId('forecast-baseline-run-button') as HTMLButtonElement).disabled).toBe(true);

    // 输入 fc=9
    const fcInput = screen.getByLabelText('终极固定成本率') as HTMLInputElement;
    fireEvent.change(fcInput, { target: { value: '9' } });

    await waitFor(() => {
      expect(screen.getByTestId('forecast-baseline-derived-preview')).toBeTruthy();
    });
    // run button 解锁
    expect((screen.getByTestId('forecast-baseline-run-button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('runs profit-scenario and renders result', async () => {
    const fetchMock = mockFetchSequence(BASELINE_FIXTURE, PROFIT_SCENARIO_FIXTURE);
    render(<ForecastBaselinePanel />);

    fireEvent.click(screen.getByTestId('forecast-baseline-load-button'));
    await waitFor(() => screen.getByTestId('forecast-baseline-actual'));

    fireEvent.change(screen.getByLabelText('终极固定成本率'), { target: { value: '9' } });
    await waitFor(() => screen.getByTestId('forecast-baseline-derived-preview'));

    fireEvent.click(screen.getByTestId('forecast-baseline-run-button'));

    await waitFor(() => {
      expect(screen.getByTestId('forecast-baseline-result')).toBeTruthy();
    });

    // 结果区应渲染综合成本率 + 禁止解释
    const result = screen.getByTestId('forecast-baseline-result');
    expect(result.textContent).toContain('终极综合成本率');
    expect(result.textContent).toContain('财务报表利润'); // forbiddenInterpretations
    expect(result.textContent).toContain('forecast 是基于调用方假设'); // warnings

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondCall] = fetchMock.mock.calls;
    expect(String(secondCall![0])).toContain('/agent/forecast/profit-scenario');
    const body = JSON.parse(String((secondCall![1] as RequestInit).body));
    expect(body.assumptionSource).toBe('derived_from_metric_registry');
    // V2 中观=5%, signed=20m → premium=21m
    expect(body.premium).toBeCloseTo(21_000_000, 2);
    // V3 中观=83 + V4 mean=15 → vc=98
    expect(body.ultimateVariableCostRatio).toBeCloseTo(98.0, 2);
    expect(body.ultimateFixedCostRatio).toBe(9);
    expect(body.earningSchedule).toEqual([{ period: '2027', earnedRatio: 100 }]);
  });

  it('persists config + scenario to localStorage', async () => {
    mockFetchSequence(BASELINE_FIXTURE);
    render(<ForecastBaselinePanel />);

    // 修改 cutoff 让 useEffect 触发持久化
    const cutoffInput = screen.getByLabelText('截止日期') as HTMLInputElement;
    fireEvent.change(cutoffInput, { target: { value: '2026-05-31' } });

    await waitFor(() => {
      const raw = memoryStorage.getItem('copilot.forecastBaseline.draft');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as { config: { cutoffDate: string } };
      expect(parsed.config.cutoffDate).toBe('2026-05-31');
    });
  });
});
