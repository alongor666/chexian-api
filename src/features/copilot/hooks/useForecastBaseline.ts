/**
 * useForecastBaseline — Copilot v2 forecast 面板专用 hook
 *
 * 产品定位（与 v1 useForecastScenario 的根本差异）：
 *   v1 面板让用户从零手工输入 premium / vc / fc / schedule —— 等同于"网页 Excel"。
 *   v2 把"已发生的事实"（actual）从用户输入中剥离，让用户只对真正的未知做模式选择：
 *     - V1 历史保单剩余敞口终极赔付率
 *     - V2 新签保费 YoY 增速
 *     - V3 新签业务终极赔付率
 *     - V4 新签业务费用率
 *
 * 架构：
 *   1. fetch POST /api/agent/forecast/baseline          → actual + 4 变量的历史分位数 + defaults
 *   2. 用户选 mode（乐观=p25 / 中观=p50 / 悲观=p75 / 自定义 / 历史回放）
 *   3. 用 mode → 派生单一 profit-scenario 入参（premium / vc / fc / schedule）
 *   4. fetch POST /api/agent/forecast/profit-scenario   → 单情景结果
 *
 * 注意：profit-scenario 是单情景 calculator，不能同时混合"剩余敞口"和"新签业务"两种 vc。
 *       v2 第一版聚焦"未来新签业务情景"链路：
 *         premium = actual.signedPremium × (1 + V2/100)   ← 估算下一年新签
 *         vc      = V3 + V4
 *         fc      = 用户手输（4 变量未涵盖，必须显式声明）
 *         schedule= 默认 [{period: nextYear, earnedRatio: 100}]（单期一年）
 *       actual + V1 仅作为决策上下文展示，不直接进入算法。
 *
 * 不接 LLM、不查 DuckDB、不生成 SQL — 纯 fetch + 派生算术。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../../shared/api/client';
import type { ForecastScenarioResult, AssumptionSource } from './useForecastScenario';

const BASELINE_DRAFT_STORAGE_KEY = 'copilot.forecastBaseline.draft';

// ──────────────────────────────────────────────
// Mode 类型
// ──────────────────────────────────────────────

/** 赔付率类（V1/V3）：乐观=低 p25，悲观=高 p75。 */
export type LossRatioMode = 'optimistic' | 'median' | 'pessimistic' | 'custom' | 'historical';

/** 保费增速（V2）：乐观=高 p75，悲观=低 p25。 */
export type GrowthMode = 'optimistic' | 'median' | 'pessimistic' | 'custom';

/** 费用率（V4）：baseline 只给均值，无分布；只支持均值 + 自定义。 */
export type ExpenseMode = 'historical_mean' | 'custom';

// ──────────────────────────────────────────────
// Baseline 响应类型（与 server schema 对齐）
// ──────────────────────────────────────────────

export interface PercentileDistribution {
  p25: number;
  p50: number;
  p75: number;
}

export interface HistoricalCohort {
  year: number;
  premium: number;
  claims: number;
  lossRatioPct: number;
}

export interface YoYGrowthSample {
  year: number;
  premium: number;
  prevYearPremium: number | null;
  yoyGrowthPct: number | null;
}

export interface ForecastBaselineActual {
  signedPremium: number;
  earnedPremium: number;
  earnedRatioPct: number;
  cumulativeReportedClaims: number;
  earnedClaimRatioPct: number;
  cumulativeFee: number;
  feeRatioPct: number;
  remainingExposure: number;
  policyCount: number;
}

export interface ForecastBaselineData {
  cutoffDate: string;
  filters: ForecastBaselineFilters;
  historyWindowYears: number;
  recentExpenseMonths: number;
  actual: ForecastBaselineActual;
  variables: {
    historicalLossRatio: {
      windowYears: number;
      cohorts: HistoricalCohort[];
      percentiles: PercentileDistribution;
      cohortCount: number;
    };
    newSigningPremiumGrowth: {
      windowYears: number;
      samples: YoYGrowthSample[];
      percentiles: PercentileDistribution;
      sampleCount: number;
    };
    newSigningLossRatio: {
      windowYears: number;
      cohorts: HistoricalCohort[];
      percentiles: PercentileDistribution;
      cohortCount: number;
    };
    newSigningExpenseRatio: {
      windowMonths: number;
      recentSignedPremium: number;
      recentFee: number;
      meanExpenseRatioPct: number;
      policyCount: number;
    };
  };
  defaults: {
    v1HistoricalLossRatio: PercentileDistribution;
    v2NewSigningPremiumGrowth: PercentileDistribution;
    v3NewSigningLossRatio: PercentileDistribution;
    v4NewSigningExpenseRatio: number;
  };
  warnings: string[];
  forbiddenInterpretations: string[];
}

// ──────────────────────────────────────────────
// 输入 state
// ──────────────────────────────────────────────

export interface ForecastBaselineFilters {
  orgLevel3?: string[];
  customerCategory?: string[];
  coverageCombination?: string[];
}

export interface BaselineConfigInput {
  cutoffDate: string;
  historyWindowYears: string; // string for input control consistency
  recentExpenseMonths: string;
  filters: ForecastBaselineFilters;
}

export interface ScenarioModeInput {
  v1Mode: LossRatioMode;
  v1CustomValue: string;
  v1HistoricalYear: string; // for historical mode: which cohort year to replay
  v2Mode: GrowthMode;
  v2CustomValue: string;
  v3Mode: LossRatioMode;
  v3CustomValue: string;
  v3HistoricalYear: string;
  v4Mode: ExpenseMode;
  v4CustomValue: string;
  ultimateFixedCostRatio: string;
  forecastPeriod: string; // 默认 cutoffYear + 1
}

const TODAY_YMD = (() => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
})();

const INITIAL_CONFIG: BaselineConfigInput = {
  cutoffDate: TODAY_YMD,
  historyWindowYears: '3',
  recentExpenseMonths: '6',
  filters: {},
};

const INITIAL_SCENARIO: ScenarioModeInput = {
  v1Mode: 'median',
  v1CustomValue: '',
  v1HistoricalYear: '',
  v2Mode: 'median',
  v2CustomValue: '',
  v3Mode: 'median',
  v3CustomValue: '',
  v3HistoricalYear: '',
  v4Mode: 'historical_mean',
  v4CustomValue: '',
  ultimateFixedCostRatio: '',
  forecastPeriod: '',
};

// ──────────────────────────────────────────────
// 状态机
// ──────────────────────────────────────────────

export interface BaselineLoadState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data: ForecastBaselineData | null;
  error: string | null;
}

export interface ScenarioRunState {
  status: 'idle' | 'submitting' | 'success' | 'error';
  result: ForecastScenarioResult | null;
  error: string | null;
}

// ──────────────────────────────────────────────
// 派生：mode → 数值
// ──────────────────────────────────────────────

/** 赔付率/费用率类：乐观=p25 / 中观=p50 / 悲观=p75 */
export function pickLossRatioByMode(
  mode: LossRatioMode,
  percentiles: PercentileDistribution,
  customValue: string,
  cohorts: HistoricalCohort[],
  historicalYear: string,
): number | null {
  if (mode === 'optimistic') return percentiles.p25;
  if (mode === 'median') return percentiles.p50;
  if (mode === 'pessimistic') return percentiles.p75;
  if (mode === 'custom') {
    const n = Number.parseFloat(customValue);
    return Number.isFinite(n) ? n : null;
  }
  if (mode === 'historical') {
    const yearNum = Number.parseInt(historicalYear, 10);
    if (!Number.isFinite(yearNum)) return null;
    const hit = cohorts.find((c) => c.year === yearNum);
    return hit ? hit.lossRatioPct : null;
  }
  return null;
}

/** 增速类：乐观=p75 / 中观=p50 / 悲观=p25 */
export function pickGrowthByMode(
  mode: GrowthMode,
  percentiles: PercentileDistribution,
  customValue: string,
): number | null {
  if (mode === 'optimistic') return percentiles.p75;
  if (mode === 'median') return percentiles.p50;
  if (mode === 'pessimistic') return percentiles.p25;
  if (mode === 'custom') {
    const n = Number.parseFloat(customValue);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 费用率类：均值 / 自定义 */
export function pickExpenseRatioByMode(
  mode: ExpenseMode,
  meanValue: number,
  customValue: string,
): number | null {
  if (mode === 'historical_mean') return meanValue;
  if (mode === 'custom') {
    const n = Number.parseFloat(customValue);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ──────────────────────────────────────────────
// 派生：mode + baseline → profit-scenario 入参
// ──────────────────────────────────────────────

export interface DerivedScenario {
  premium: number;
  ultimateVariableCostRatio: number;
  ultimateFixedCostRatio: number;
  earningSchedule: { period: string; earnedRatio: number }[];
  scenarioName: string;
  assumptionSource: AssumptionSource;
  /** 透出 v1/v2/v3/v4 选定值，便于面板回显 */
  resolved: {
    v1: number;
    v2: number;
    v3: number;
    v4: number;
  };
}

export function deriveScenario(
  baseline: ForecastBaselineData,
  scenario: ScenarioModeInput,
): { ok: true; scenario: DerivedScenario } | { ok: false; error: string } {
  const v1 = pickLossRatioByMode(
    scenario.v1Mode,
    baseline.variables.historicalLossRatio.percentiles,
    scenario.v1CustomValue,
    baseline.variables.historicalLossRatio.cohorts,
    scenario.v1HistoricalYear,
  );
  const v2 = pickGrowthByMode(
    scenario.v2Mode,
    baseline.variables.newSigningPremiumGrowth.percentiles,
    scenario.v2CustomValue,
  );
  const v3 = pickLossRatioByMode(
    scenario.v3Mode,
    baseline.variables.newSigningLossRatio.percentiles,
    scenario.v3CustomValue,
    baseline.variables.newSigningLossRatio.cohorts,
    scenario.v3HistoricalYear,
  );
  const v4 = pickExpenseRatioByMode(
    scenario.v4Mode,
    baseline.variables.newSigningExpenseRatio.meanExpenseRatioPct,
    scenario.v4CustomValue,
  );
  const fc = Number.parseFloat(scenario.ultimateFixedCostRatio);

  if (v1 === null) return { ok: false, error: 'V1（历史保单残赔率）取值无效，请检查 mode/自定义/历史年份。' };
  if (v2 === null) return { ok: false, error: 'V2（新签保费增速）取值无效。' };
  if (v3 === null) return { ok: false, error: 'V3（新签业务赔付率）取值无效。' };
  if (v4 === null) return { ok: false, error: 'V4（新签业务费用率）取值无效。' };
  if (!Number.isFinite(fc)) return { ok: false, error: '终极固定成本率必填（4 变量未涵盖固定成本）。' };
  if (fc < 0 || fc > 150) return { ok: false, error: '终极固定成本率必须在 [0, 150] 之间。' };

  const period = scenario.forecastPeriod.trim();
  if (!period) return { ok: false, error: '预测期间必填（默认 cutoff 年 + 1）。' };

  // 估算下一年新签保费 = 已签发保费 × (1 + V2/100)
  const premium = baseline.actual.signedPremium * (1 + v2 / 100);
  if (!Number.isFinite(premium) || premium <= 0) {
    return { ok: false, error: '派生保费 ≤ 0，无法测算。' };
  }

  // 终极变动成本率 = V3（赔付率）+ V4（费用率）
  const vc = v3 + v4;
  if (vc < 0 || vc > 150) {
    return { ok: false, error: `派生终极变动成本率 ${vc.toFixed(2)} 超出 [0,150]，请检查 V3/V4 取值。` };
  }

  return {
    ok: true,
    scenario: {
      premium,
      ultimateVariableCostRatio: vc,
      ultimateFixedCostRatio: fc,
      earningSchedule: [{ period, earnedRatio: 100 }],
      scenarioName: buildScenarioName(scenario, baseline.cutoffDate),
      assumptionSource: 'derived_from_metric_registry',
      resolved: { v1, v2, v3, v4 },
    },
  };
}

function buildScenarioName(scenario: ScenarioModeInput, cutoffDate: string): string {
  const tag = (m: string) => {
    if (m === 'optimistic') return '乐观';
    if (m === 'median') return '中观';
    if (m === 'pessimistic') return '悲观';
    if (m === 'custom') return '自定义';
    if (m === 'historical') return '历史回放';
    if (m === 'historical_mean') return '近期均值';
    return m;
  };
  return `baseline ${cutoffDate} · V1:${tag(scenario.v1Mode)} V2:${tag(scenario.v2Mode)} V3:${tag(scenario.v3Mode)} V4:${tag(scenario.v4Mode)}`;
}

// ──────────────────────────────────────────────
// localStorage 持久化（仅持久化用户配置，不持久化 baseline data 与结果）
// ──────────────────────────────────────────────

interface PersistedDraft {
  config: BaselineConfigInput;
  scenario: ScenarioModeInput;
}

function loadDraftFromStorage(): PersistedDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BASELINE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedDraft>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      config: { ...INITIAL_CONFIG, ...(parsed.config ?? {}) },
      scenario: { ...INITIAL_SCENARIO, ...(parsed.scenario ?? {}) },
    };
  } catch {
    return null;
  }
}

function saveDraftToStorage(draft: PersistedDraft) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BASELINE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota / privacy errors */
  }
}

function clearDraftFromStorage() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(BASELINE_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ──────────────────────────────────────────────
// API 调用
// ──────────────────────────────────────────────

function fetchForecastBaseline(config: BaselineConfigInput): Promise<ForecastBaselineData> {
  return apiClient.copilot.forecastBaseline<ForecastBaselineData>({
    cutoffDate: config.cutoffDate,
    filters: config.filters,
    historyWindowYears: Number.parseInt(config.historyWindowYears, 10) || 3,
    recentExpenseMonths: Number.parseInt(config.recentExpenseMonths, 10) || 6,
  });
}

function fetchProfitScenario(input: {
  premium: number;
  ultimateVariableCostRatio: number;
  ultimateFixedCostRatio: number;
  earningSchedule: { period: string; earnedRatio: number }[];
  scenarioName: string;
  assumptionSource: AssumptionSource;
}): Promise<ForecastScenarioResult> {
  return apiClient.copilot.profitScenario<ForecastScenarioResult>(input);
}

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

export interface UseForecastBaselineReturn {
  config: BaselineConfigInput;
  scenario: ScenarioModeInput;
  loadState: BaselineLoadState;
  runState: ScenarioRunState;
  setConfig: <K extends keyof BaselineConfigInput>(key: K, value: BaselineConfigInput[K]) => void;
  setScenario: <K extends keyof ScenarioModeInput>(key: K, value: ScenarioModeInput[K]) => void;
  loadBaseline: () => Promise<void>;
  runScenario: () => Promise<void>;
  resetAll: () => void;
}

export function useForecastBaseline(): UseForecastBaselineReturn {
  const [config, setConfigState] = useState<BaselineConfigInput>(() => loadDraftFromStorage()?.config ?? INITIAL_CONFIG);
  const [scenario, setScenarioState] = useState<ScenarioModeInput>(() => loadDraftFromStorage()?.scenario ?? INITIAL_SCENARIO);
  const [loadState, setLoadState] = useState<BaselineLoadState>({ status: 'idle', data: null, error: null });
  const [runState, setRunState] = useState<ScenarioRunState>({ status: 'idle', result: null, error: null });

  const configRef = useRef(config);
  const scenarioRef = useRef(scenario);
  const baselineDataRef = useRef<ForecastBaselineData | null>(null);

  useEffect(() => {
    configRef.current = config;
    scenarioRef.current = scenario;
    saveDraftToStorage({ config, scenario });
  }, [config, scenario]);

  useEffect(() => {
    baselineDataRef.current = loadState.data;
  }, [loadState.data]);

  const setConfig = useCallback(
    <K extends keyof BaselineConfigInput>(key: K, value: BaselineConfigInput[K]) => {
      setConfigState((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const setScenario = useCallback(
    <K extends keyof ScenarioModeInput>(key: K, value: ScenarioModeInput[K]) => {
      setScenarioState((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const loadBaseline = useCallback(async () => {
    setLoadState({ status: 'loading', data: null, error: null });
    setRunState({ status: 'idle', result: null, error: null });
    try {
      const data = await fetchForecastBaseline(configRef.current);
      setLoadState({ status: 'success', data, error: null });
      // 默认预测期间 = cutoff 年 + 1（仅当用户尚未输入时填充）
      const cutoffYear = Number.parseInt(data.cutoffDate.slice(0, 4), 10);
      if (Number.isFinite(cutoffYear) && !scenarioRef.current.forecastPeriod.trim()) {
        setScenarioState((prev) => ({ ...prev, forecastPeriod: String(cutoffYear + 1) }));
      }
    } catch (err) {
      setLoadState({
        status: 'error',
        data: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const runScenario = useCallback(async () => {
    const baselineData = baselineDataRef.current;
    if (!baselineData) {
      setRunState({ status: 'error', result: null, error: '请先拉取 baseline 数据。' });
      return;
    }
    const derived = deriveScenario(baselineData, scenarioRef.current);
    if (!derived.ok) {
      setRunState({ status: 'error', result: null, error: derived.error });
      return;
    }
    setRunState({ status: 'submitting', result: null, error: null });
    try {
      const result = await fetchProfitScenario({
        premium: derived.scenario.premium,
        ultimateVariableCostRatio: derived.scenario.ultimateVariableCostRatio,
        ultimateFixedCostRatio: derived.scenario.ultimateFixedCostRatio,
        earningSchedule: derived.scenario.earningSchedule,
        scenarioName: derived.scenario.scenarioName,
        assumptionSource: derived.scenario.assumptionSource,
      });
      setRunState({ status: 'success', result, error: null });
    } catch (err) {
      setRunState({
        status: 'error',
        result: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const resetAll = useCallback(() => {
    setConfigState(INITIAL_CONFIG);
    setScenarioState(INITIAL_SCENARIO);
    setLoadState({ status: 'idle', data: null, error: null });
    setRunState({ status: 'idle', result: null, error: null });
    clearDraftFromStorage();
  }, []);

  return {
    config,
    scenario,
    loadState,
    runState,
    setConfig,
    setScenario,
    loadBaseline,
    runScenario,
    resetAll,
  };
}

// 测试常量导出
export const FORECAST_BASELINE_DRAFT_STORAGE_KEY = BASELINE_DRAFT_STORAGE_KEY;
export const FORECAST_BASELINE_INITIAL_CONFIG = INITIAL_CONFIG;
export const FORECAST_BASELINE_INITIAL_SCENARIO = INITIAL_SCENARIO;
