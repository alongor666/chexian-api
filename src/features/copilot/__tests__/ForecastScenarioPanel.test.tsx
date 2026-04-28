/**
 * ForecastScenarioPanel integration tests
 *
 * Covers:
 *  - submit-disabled when earning schedule does not sum to 100
 *  - localStorage draft persistence between mounts
 *  - successful API call renders warnings + forbiddenInterpretations
 *  - API failure path surfaces error
 *  - margin contribution preview reacts to vc/premium input
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { ForecastScenarioPanel } from '../components/ForecastScenarioPanel';
import { FORECAST_DRAFT_STORAGE_KEY } from '../hooks/useForecastScenario';

// Reinstall a real in-memory localStorage; vitest workers can share globals with
// tests/api/client.test.ts which replaces it with a vi.fn-backed stub.
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

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = vi.fn((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fillGoldenPathInputs() {
  const scenarioInput = screen.getByPlaceholderText(/2026 终极假设/);
  fireEvent.change(scenarioInput, { target: { value: 'test-scenario' } });

  const premiumInput = screen.getByPlaceholderText(/20000000/);
  fireEvent.change(premiumInput, { target: { value: '20000000' } });

  const vcInput = screen.getByPlaceholderText(/^如：85$/);
  fireEvent.change(vcInput, { target: { value: '85' } });

  const fcInput = screen.getByPlaceholderText('必填，无默认值');
  fireEvent.change(fcInput, { target: { value: '9' } });

  const periodOne = screen.getByLabelText('期间 1');
  fireEvent.change(periodOne, { target: { value: '2026' } });
  const ratioOne = screen.getByLabelText('期 1 已赚率');
  fireEvent.change(ratioOne, { target: { value: '52' } });

  const periodTwo = screen.getByLabelText('期间 2');
  fireEvent.change(periodTwo, { target: { value: '2027' } });
  const ratioTwo = screen.getByLabelText('期 2 已赚率');
  fireEvent.change(ratioTwo, { target: { value: '48' } });
}

describe('ForecastScenarioPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('disables submit button until inputs are valid (earning schedule sums to 100)', () => {
    render(<ForecastScenarioPanel />);

    const submitButton = screen.getByRole('button', { name: '测算情景' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    // Partial input: earning schedule sums to 99 should keep button disabled
    fillGoldenPathInputs();
    fireEvent.change(screen.getByLabelText('期 2 已赚率'), { target: { value: '47' } });

    expect(screen.getByTestId('earning-sum-indicator').textContent).toContain('99.00');
    expect(submitButton.disabled).toBe(true);

    // Fix: sum = 100 enables submit
    fireEvent.change(screen.getByLabelText('期 2 已赚率'), { target: { value: '48' } });
    expect(submitButton.disabled).toBe(false);
  });

  it('renders margin contribution preview when premium and variable cost ratio are present', () => {
    render(<ForecastScenarioPanel />);

    // Premium and vc both present
    fireEvent.change(screen.getByPlaceholderText(/20000000/), { target: { value: '10000000' } });
    fireEvent.change(screen.getByPlaceholderText(/^如：85$/), { target: { value: '80' } });

    // Margin = 10M * (1 - 80%) = 2M = 200 万元
    expect(screen.getByText(/边际贡献额/)).toBeTruthy();
    expect(screen.getByText(/200 万元/)).toBeTruthy();
    expect(screen.getByText(/不是承保利润/)).toBeTruthy();
  });

  it('persists input to localStorage and restores on remount', () => {
    const { unmount } = render(<ForecastScenarioPanel />);
    fireEvent.change(screen.getByPlaceholderText(/2026 终极假设/), { target: { value: 'persist-me' } });

    // Draft must be in localStorage
    const stored = window.localStorage.getItem(FORECAST_DRAFT_STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!).scenarioName).toBe('persist-me');

    unmount();

    render(<ForecastScenarioPanel />);
    expect((screen.getByPlaceholderText(/2026 终极假设/) as HTMLInputElement).value).toBe('persist-me');
  });

  it('clear button resets input and removes draft', () => {
    render(<ForecastScenarioPanel />);
    fireEvent.change(screen.getByPlaceholderText(/2026 终极假设/), { target: { value: 'transient' } });
    expect(window.localStorage.getItem(FORECAST_DRAFT_STORAGE_KEY)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '清空' }));

    expect((screen.getByPlaceholderText(/2026 终极假设/) as HTMLInputElement).value).toBe('');
    expect(window.localStorage.getItem(FORECAST_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('renders warnings + forbiddenInterpretations from successful API response', async () => {
    const apiResponse = {
      success: true,
      data: {
        scenarioName: 'test-scenario',
        ultimateCombinedCostRatio: 94,
        forecastOperatingProfitMargin: 6,
        perPeriodForecast: [
          { period: '2026', earnedRatio: 52, forecastOperatingProfit: 624000 },
          { period: '2027', earnedRatio: 48, forecastOperatingProfit: 576000 },
        ],
        fullCycleForecastOperatingProfit: 1200000,
        onePctSensitivity: [
          { period: '2026', sensitivity: 104000 },
          { period: '2027', sensitivity: 96000 },
        ],
        warnings: [
          'forecast 是基于调用方假设的情景计算结果，不是财务报表利润、法定承保利润或审计利润。',
          '已赚率切分仅按调用方提供的 earningSchedule 分摊，不做自动跨期插值。',
        ],
        forbiddenInterpretations: ['财务报表利润', '法定承保利润', '审计利润', '承保利润'],
        assumptionSource: 'caller_provided',
      },
    };

    let capturedRequest: { url: string; body: string } | null = null;
    mockFetch((url, init) => {
      capturedRequest = { url, body: typeof init?.body === 'string' ? init.body : '' };
      return jsonResponse(apiResponse);
    });

    render(<ForecastScenarioPanel />);
    fillGoldenPathInputs();

    const submitButton = screen.getByRole('button', { name: '测算情景' });
    fireEvent.click(submitButton);

    // Result heading appears
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-scenario' })).toBeTruthy();
    });

    // Warnings rendered
    expect(screen.getByText(/不是财务报表利润、法定承保利润或审计利润/)).toBeTruthy();

    // Forbidden interpretations rendered as a non-collapsible block
    expect(screen.getByText(/禁止解释/)).toBeTruthy();
    expect(screen.getByText(/财务报表利润、法定承保利润、审计利润、承保利润/)).toBeTruthy();

    // Per-period table contains both years
    expect(screen.getByText('2026')).toBeTruthy();
    expect(screen.getByText('2027')).toBeTruthy();

    // Request body sent to backend echoes the parsed numbers (not strings)
    expect(capturedRequest).toBeTruthy();
    expect(capturedRequest!.url).toContain('/agent/forecast/profit-scenario');
    const sentBody = JSON.parse(capturedRequest!.body) as Record<string, unknown>;
    expect(sentBody.premium).toBe(20000000);
    expect(sentBody.ultimateVariableCostRatio).toBe(85);
    expect(sentBody.ultimateFixedCostRatio).toBe(9);
  });

  it('surfaces error message when API responds with failure', async () => {
    mockFetch(() => jsonResponse({ success: false, error: { message: '权限不足' } }, 403));

    render(<ForecastScenarioPanel />);
    fillGoldenPathInputs();

    fireEvent.click(screen.getByRole('button', { name: '测算情景' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/测算失败/);
    });
  });
});
