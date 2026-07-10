/**
 * useForecastScenario — Copilot 经营利润情景测算 hook
 *
 * 调用 POST /api/agent/forecast/profit-scenario（PR #300 提供的确定性 calculator）。
 * 不接 LLM、不查 DuckDB、不生成 SQL — 纯算术响应。
 *
 * 状态机：idle → submitting → success | error。
 *
 * 输入字段以 string 存储（避免 number 输入"1."中间态丢失），
 * submit 时再 parse 并由后端 Zod 二次校验（前端校验仅用于禁用按钮）。
 *
 * localStorage：草稿持久化到 `copilot.forecastScenario.draft`，关闭抽屉后再打开仍可恢复。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../../shared/api/client';

const DRAFT_STORAGE_KEY = 'copilot.forecastScenario.draft';

export type AssumptionSource =
  | 'caller_provided'
  | 'pricing_redline_default'
  | 'derived_from_metric_registry';

export interface EarningPeriodInput {
  period: string;
  earnedRatio: string;
}

export interface ForecastScenarioInput {
  scenarioName: string;
  premium: string;
  ultimateVariableCostRatio: string;
  ultimateFixedCostRatio: string;
  earningSchedule: EarningPeriodInput[];
  assumptionSource: AssumptionSource;
}

export interface ForecastPerPeriod {
  period: string;
  earnedRatio: number;
  forecastOperatingProfit: number;
}

export interface ForecastSensitivity {
  period: string;
  sensitivity: number;
}

export interface ForecastScenarioResult {
  scenarioName: string;
  ultimateCombinedCostRatio: number;
  forecastOperatingProfitMargin: number;
  perPeriodForecast: ForecastPerPeriod[];
  fullCycleForecastOperatingProfit: number;
  onePctSensitivity: ForecastSensitivity[];
  warnings: string[];
  forbiddenInterpretations: string[];
  assumptionSource: AssumptionSource;
}

export interface ForecastScenarioState {
  status: 'idle' | 'submitting' | 'success' | 'error';
  result: ForecastScenarioResult | null;
  error: string | null;
}

const INITIAL_INPUT: ForecastScenarioInput = {
  scenarioName: '',
  premium: '',
  ultimateVariableCostRatio: '',
  ultimateFixedCostRatio: '',
  earningSchedule: [
    { period: '', earnedRatio: '' },
    { period: '', earnedRatio: '' },
  ],
  assumptionSource: 'caller_provided',
};

const INITIAL_STATE: ForecastScenarioState = {
  status: 'idle',
  result: null,
  error: null,
};

function loadDraftFromStorage(): ForecastScenarioInput | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ForecastScenarioInput>;
    if (!parsed || typeof parsed !== 'object') return null;
    // 防御：只接受已知字段，丢弃未知字段，缺失字段回退默认。
    const earningSchedule = Array.isArray(parsed.earningSchedule)
      ? parsed.earningSchedule
          .filter((item): item is EarningPeriodInput => !!item && typeof item === 'object')
          .map((item) => ({
            period: typeof item.period === 'string' ? item.period : '',
            earnedRatio: typeof item.earnedRatio === 'string' ? item.earnedRatio : '',
          }))
      : INITIAL_INPUT.earningSchedule;
    return {
      scenarioName: typeof parsed.scenarioName === 'string' ? parsed.scenarioName : '',
      premium: typeof parsed.premium === 'string' ? parsed.premium : '',
      ultimateVariableCostRatio:
        typeof parsed.ultimateVariableCostRatio === 'string' ? parsed.ultimateVariableCostRatio : '',
      ultimateFixedCostRatio:
        typeof parsed.ultimateFixedCostRatio === 'string' ? parsed.ultimateFixedCostRatio : '',
      earningSchedule: earningSchedule.length > 0 ? earningSchedule : INITIAL_INPUT.earningSchedule,
      assumptionSource:
        parsed.assumptionSource === 'pricing_redline_default'
        || parsed.assumptionSource === 'derived_from_metric_registry'
          ? parsed.assumptionSource
          : 'caller_provided',
    };
  } catch {
    return null;
  }
}

function saveDraftToStorage(input: ForecastScenarioInput) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(input));
  } catch {
    // localStorage 满 / 隐私模式：静默忽略，不阻塞输入
  }
}

function clearDraftFromStorage() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function isInputBlank(input: ForecastScenarioInput): boolean {
  if (input.scenarioName.trim() !== '') return false;
  if (input.premium.trim() !== '') return false;
  if (input.ultimateVariableCostRatio.trim() !== '') return false;
  if (input.ultimateFixedCostRatio.trim() !== '') return false;
  for (const item of input.earningSchedule) {
    if (item.period.trim() !== '' || item.earnedRatio.trim() !== '') return false;
  }
  return true;
}

export function isEarningScheduleSumValid(items: EarningPeriodInput[]): boolean {
  // 已赚率合计必须 = 100（容差 0.01，与后端 Zod refine 同步）
  const sum = items.reduce((acc, item) => {
    const value = Number.parseFloat(item.earnedRatio);
    return Number.isFinite(value) ? acc + value : acc;
  }, 0);
  return Math.abs(sum - 100) < 0.01;
}

function isPositiveNumber(value: string): boolean {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0;
}

function isRatioInRange(value: string): boolean {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 && n <= 150;
}

export function isInputSubmittable(input: ForecastScenarioInput): boolean {
  if (!input.scenarioName.trim()) return false;
  if (!isPositiveNumber(input.premium)) return false;
  if (!isRatioInRange(input.ultimateVariableCostRatio)) return false;
  if (!isRatioInRange(input.ultimateFixedCostRatio)) return false;
  if (input.earningSchedule.length === 0) return false;
  for (const item of input.earningSchedule) {
    if (!item.period.trim()) return false;
    const ratio = Number.parseFloat(item.earnedRatio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 100) return false;
  }
  return isEarningScheduleSumValid(input.earningSchedule);
}

export interface UseForecastScenarioReturn {
  input: ForecastScenarioInput;
  state: ForecastScenarioState;
  setField: <K extends keyof ForecastScenarioInput>(key: K, value: ForecastScenarioInput[K]) => void;
  setEarningPeriod: (index: number, patch: Partial<EarningPeriodInput>) => void;
  addEarningPeriod: () => void;
  removeEarningPeriod: (index: number) => void;
  submit: () => Promise<void>;
  resetInput: () => void;
  resetResult: () => void;
}

export function useForecastScenario(): UseForecastScenarioReturn {
  const [input, setInput] = useState<ForecastScenarioInput>(() => loadDraftFromStorage() ?? INITIAL_INPUT);
  const [state, setState] = useState<ForecastScenarioState>(INITIAL_STATE);
  // 输入与持久化解耦：useEffect 才 write，避免 setField 时函数体内的副作用
  const inputRef = useRef(input);

  useEffect(() => {
    inputRef.current = input;
    // Don't persist a blank input — restoring it on next mount would be a no-op
    // and a stale draft confuses the "clear" UX. Skip storage when no meaningful
    // user input has been entered yet.
    if (isInputBlank(input)) {
      clearDraftFromStorage();
    } else {
      saveDraftToStorage(input);
    }
  }, [input]);

  const setField = useCallback(<K extends keyof ForecastScenarioInput>(key: K, value: ForecastScenarioInput[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setEarningPeriod = useCallback((index: number, patch: Partial<EarningPeriodInput>) => {
    setInput((prev) => {
      const next = prev.earningSchedule.map((item, i) => (i === index ? { ...item, ...patch } : item));
      return { ...prev, earningSchedule: next };
    });
  }, []);

  const addEarningPeriod = useCallback(() => {
    setInput((prev) => ({
      ...prev,
      earningSchedule: [...prev.earningSchedule, { period: '', earnedRatio: '' }],
    }));
  }, []);

  const removeEarningPeriod = useCallback((index: number) => {
    setInput((prev) => {
      if (prev.earningSchedule.length <= 1) return prev;
      return {
        ...prev,
        earningSchedule: prev.earningSchedule.filter((_, i) => i !== index),
      };
    });
  }, []);

  const submit = useCallback(async () => {
    const current = inputRef.current;
    if (!isInputSubmittable(current)) {
      setState({ status: 'error', result: null, error: '请补全输入：所有字段必填，已赚率合计必须等于 100。' });
      return;
    }

    setState({ status: 'submitting', result: null, error: null });

    const body = {
      scenarioName: current.scenarioName.trim(),
      premium: Number.parseFloat(current.premium),
      ultimateVariableCostRatio: Number.parseFloat(current.ultimateVariableCostRatio),
      ultimateFixedCostRatio: Number.parseFloat(current.ultimateFixedCostRatio),
      earningSchedule: current.earningSchedule.map((item) => ({
        period: item.period.trim(),
        earnedRatio: Number.parseFloat(item.earnedRatio),
      })),
      assumptionSource: current.assumptionSource,
    };

    try {
      const result = await apiClient.copilot.profitScenario<ForecastScenarioResult>(body);
      setState({ status: 'success', result, error: null });
    } catch (err) {
      setState({
        status: 'error',
        result: null,
        error: `测算失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, []);

  const resetInput = useCallback(() => {
    setInput(INITIAL_INPUT);
    setState(INITIAL_STATE);
    clearDraftFromStorage();
  }, []);

  const resetResult = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return {
    input,
    state,
    setField,
    setEarningPeriod,
    addEarningPeriod,
    removeEarningPeriod,
    submit,
    resetInput,
    resetResult,
  };
}

// 导出常量供测试与 panel 使用
export const FORECAST_DRAFT_STORAGE_KEY = DRAFT_STORAGE_KEY;
