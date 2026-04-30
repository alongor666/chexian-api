/**
 * ForecastBaselinePanel — Copilot v2 经营利润情景测算面板
 *
 * 与 v1 ForecastScenarioPanel 的根本差异（产品决策见 docs/AGENT_FORECAST_BC_HANDOFF.md §四 v2）：
 *
 *  v1 让用户从零手输 premium / vc / fc / schedule —— 等同于"网页 Excel"。
 *  v2 区分 已发生 vs 未来变量：
 *    - 已发生（actual）由 baseline 端点系统精确给出，UI 只读展示
 *    - 4 个未知变量（V1-V4）通过 mode picker（乐观/中观/悲观/自定义/历史回放）选择
 *    - 终极固定成本率单独手输（4 变量未涵盖）
 *    - 派生 profit-scenario 入参 → 调 profit-scenario 出预测利润
 *
 * 红线：
 *  - actual 区不可编辑（防止"网页 Excel"产品反模式）
 *  - warnings + forbiddenInterpretations 强制展示
 *  - assumptionSource 自动标记 derived_from_metric_registry，让审计可识别
 *  - 不展示"承保利润 / 法定承保利润 / 审计利润"任何映射（后端 forbiddenInterpretations 覆盖）
 */

import { useMemo } from 'react';
import { formatPremiumWan, formatPercent } from '../../../shared/utils/formatters';
import {
  deriveScenario,
  useForecastBaseline,
  type LossRatioMode,
  type GrowthMode,
  type ExpenseMode,
} from '../hooks/useForecastBaseline';

const LOSS_RATIO_MODE_LABELS: Record<LossRatioMode, string> = {
  optimistic: '乐观（p25）',
  median: '中观（p50）',
  pessimistic: '悲观（p75）',
  custom: '自定义',
  historical: '历史回放',
};

const GROWTH_MODE_LABELS: Record<GrowthMode, string> = {
  optimistic: '乐观（p75）',
  median: '中观（p50）',
  pessimistic: '悲观（p25）',
  custom: '自定义',
};

const EXPENSE_MODE_LABELS: Record<ExpenseMode, string> = {
  historical_mean: '近期均值',
  custom: '自定义',
};

function fmtWan(value: number): string {
  return `${formatPremiumWan(value)} 万元`;
}

function fmtPct(value: number): string {
  return formatPercent(value, 2);
}

export function ForecastBaselinePanel() {
  const {
    config,
    scenario,
    loadState,
    runState,
    setConfig,
    setScenario,
    loadBaseline,
    runScenario,
    resetAll,
  } = useForecastBaseline();

  const isLoading = loadState.status === 'loading';
  const isSubmitting = runState.status === 'submitting';
  const baselineData = loadState.data;

  // 每次 mode 变化即时派生预览（不触发 fetch）
  const derivedPreview = useMemo(() => {
    if (!baselineData) return null;
    const out = deriveScenario(baselineData, scenario);
    return out;
  }, [baselineData, scenario]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <section
        data-testid="forecast-baseline-config"
        className="px-4 py-3 border-b border-neutral-200 dark:border-subtle space-y-3"
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            数据快照（cutoff）
          </h3>
          <button
            type="button"
            onClick={resetAll}
            disabled={isLoading || isSubmitting}
            className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
          >
            清空
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">截止日期</span>
            <input
              type="date"
              value={config.cutoffDate}
              onChange={(e) => setConfig('cutoffDate', e.target.value)}
              disabled={isLoading || isSubmitting}
              className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">历史窗口（年）</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              value={config.historyWindowYears}
              onChange={(e) => setConfig('historyWindowYears', e.target.value)}
              disabled={isLoading || isSubmitting}
              className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">近期窗口（月）</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={24}
              value={config.recentExpenseMonths}
              onChange={(e) => setConfig('recentExpenseMonths', e.target.value)}
              disabled={isLoading || isSubmitting}
              className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
            />
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => void loadBaseline()}
            disabled={isLoading || isSubmitting}
            data-testid="forecast-baseline-load-button"
            className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? '拉取中…' : baselineData ? '刷新 baseline' : '拉取 baseline'}
          </button>
          {loadState.error && (
            <span className="text-xs text-danger self-center" role="alert">
              {loadState.error}
            </span>
          )}
        </div>
      </section>

      <section className="flex-1 overflow-auto px-4 py-3 space-y-4">
        {!baselineData && loadState.status === 'idle' && (
          <p className="text-sm text-neutral-400 text-center pt-4">
            选择 cutoff，点击「拉取 baseline」从系统加载已发生数据 + 4 变量历史分位数。
          </p>
        )}

        {isLoading && (
          <p className="text-sm text-neutral-500 text-center pt-4">baseline 拉取中…</p>
        )}

        {baselineData && (
          <>
            <ActualFactsBlock data={baselineData} />
            <ScenarioModePickers
              data={baselineData}
              scenario={scenario}
              setScenario={setScenario}
            />
            <FixedCostInput
              fixedCostRatio={scenario.ultimateFixedCostRatio}
              forecastPeriod={scenario.forecastPeriod}
              setScenario={setScenario}
              disabled={isSubmitting}
            />

            {derivedPreview && derivedPreview.ok && (
              <DerivedPreview preview={derivedPreview.scenario} />
            )}
            {derivedPreview && !derivedPreview.ok && (
              <div className="px-3 py-2 text-xs bg-warning-bg border border-warning rounded text-warning-dark" role="status">
                派生入参不完整：{derivedPreview.error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void runScenario()}
                disabled={isSubmitting || !derivedPreview || !derivedPreview.ok}
                data-testid="forecast-baseline-run-button"
                className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? '测算中…' : '测算情景'}
              </button>
              {runState.error && (
                <span className="text-xs text-danger self-center" role="alert">
                  {runState.error}
                </span>
              )}
            </div>

            {runState.result && <ForecastResultBlock result={runState.result} />}

            {/* baseline 自己的 warnings + forbidden 永远展示在底部，让审计可识别 */}
            {baselineData.warnings.length > 0 && (
              <div className="px-3 py-2 bg-warning-bg border border-warning rounded text-xs">
                <h5 className="font-medium text-warning-dark mb-1">⚠ baseline 警示</h5>
                <ul className="list-disc list-inside space-y-0.5 text-warning-dark">
                  {baselineData.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {baselineData.forbiddenInterpretations.length > 0 && (
              <div className="px-3 py-2 bg-danger-bg border border-danger rounded text-xs">
                <h5 className="font-medium text-danger-dark mb-1">禁止解释（baseline）</h5>
                <p className="text-danger-dark">
                  baseline 数据不得被解释为：{baselineData.forbiddenInterpretations.join('、')}。
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-component: actual 已发生（不可改）
// ──────────────────────────────────────────────

interface ActualFactsBlockProps {
  data: import('../hooks/useForecastBaseline').ForecastBaselineData;
}

function ActualFactsBlock({ data }: ActualFactsBlockProps) {
  const a = data.actual;
  return (
    <div data-testid="forecast-baseline-actual">
      <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
        已发生（系统精确给出 · 不可编辑）
      </h4>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <FactCard label="签单保费" value={fmtWan(a.signedPremium)} />
        <FactCard label="已赚保费" value={fmtWan(a.earnedPremium)} />
        <FactCard label="已赚率" value={fmtPct(a.earnedRatioPct)} />
        <FactCard label="累计已报告赔款" value={fmtWan(a.cumulativeReportedClaims)} />
        <FactCard label="满期赔付率（已发生）" value={fmtPct(a.earnedClaimRatioPct)} />
        <FactCard label="累计费用" value={fmtWan(a.cumulativeFee)} />
        <FactCard label="费用率（已发生）" value={fmtPct(a.feeRatioPct)} />
        <FactCard label="剩余敞口（万元×天）" value={Number.isFinite(a.remainingExposure) ? a.remainingExposure.toFixed(0) : '—'} />
        <FactCard label="保单数" value={String(a.policyCount)} />
      </div>
      <p className="text-[10px] text-neutral-500 mt-1">
        cutoff: {data.cutoffDate} · 历史窗口 {data.historyWindowYears} 年 · 近期窗口 {data.recentExpenseMonths} 月
      </p>
    </div>
  );
}

interface FactCardProps {
  label: string;
  value: string;
}

function FactCard({ label, value }: FactCardProps) {
  return (
    <div className="px-2 py-1.5 bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-subtle rounded">
      <div className="text-[10px] text-neutral-500">{label}</div>
      <div className="text-sm font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{value}</div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-component: 4 个变量 mode picker
// ──────────────────────────────────────────────

interface ScenarioModePickersProps {
  data: import('../hooks/useForecastBaseline').ForecastBaselineData;
  scenario: import('../hooks/useForecastBaseline').ScenarioModeInput;
  setScenario: <K extends keyof import('../hooks/useForecastBaseline').ScenarioModeInput>(
    key: K,
    value: import('../hooks/useForecastBaseline').ScenarioModeInput[K],
  ) => void;
}

function ScenarioModePickers({ data, scenario, setScenario }: ScenarioModePickersProps) {
  const v1Pcts = data.variables.historicalLossRatio.percentiles;
  const v2Pcts = data.variables.newSigningPremiumGrowth.percentiles;
  const v3Pcts = data.variables.newSigningLossRatio.percentiles;
  const v4Mean = data.variables.newSigningExpenseRatio.meanExpenseRatioPct;

  return (
    <div data-testid="forecast-baseline-mode-pickers">
      <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
        未来变量假设（V1-V4）
      </h4>

      {/* V1 历史保单残赔率 */}
      <LossRatioPicker
        testid="picker-v1"
        title="V1 · 历史保单剩余敞口终极赔付率"
        hint={`p25 ${fmtPct(v1Pcts.p25)} / p50 ${fmtPct(v1Pcts.p50)} / p75 ${fmtPct(v1Pcts.p75)}`}
        cohorts={data.variables.historicalLossRatio.cohorts}
        mode={scenario.v1Mode}
        customValue={scenario.v1CustomValue}
        historicalYear={scenario.v1HistoricalYear}
        onModeChange={(m) => setScenario('v1Mode', m)}
        onCustomChange={(v) => setScenario('v1CustomValue', v)}
        onHistoricalYearChange={(y) => setScenario('v1HistoricalYear', y)}
      />

      {/* V2 新签保费 YoY 增速 */}
      <GrowthPicker
        testid="picker-v2"
        title="V2 · 新签保费 YoY 增速"
        hint={`p25 ${fmtPct(v2Pcts.p25)} / p50 ${fmtPct(v2Pcts.p50)} / p75 ${fmtPct(v2Pcts.p75)}（高=好）`}
        mode={scenario.v2Mode}
        customValue={scenario.v2CustomValue}
        onModeChange={(m) => setScenario('v2Mode', m)}
        onCustomChange={(v) => setScenario('v2CustomValue', v)}
      />

      {/* V3 新签业务赔付率 */}
      <LossRatioPicker
        testid="picker-v3"
        title="V3 · 新签业务终极赔付率"
        hint={`p25 ${fmtPct(v3Pcts.p25)} / p50 ${fmtPct(v3Pcts.p50)} / p75 ${fmtPct(v3Pcts.p75)}`}
        cohorts={data.variables.newSigningLossRatio.cohorts}
        mode={scenario.v3Mode}
        customValue={scenario.v3CustomValue}
        historicalYear={scenario.v3HistoricalYear}
        onModeChange={(m) => setScenario('v3Mode', m)}
        onCustomChange={(v) => setScenario('v3CustomValue', v)}
        onHistoricalYearChange={(y) => setScenario('v3HistoricalYear', y)}
      />

      {/* V4 新签业务费用率 */}
      <ExpensePicker
        testid="picker-v4"
        title={`V4 · 新签业务费用率（近 ${data.variables.newSigningExpenseRatio.windowMonths} 月）`}
        meanValue={v4Mean}
        mode={scenario.v4Mode}
        customValue={scenario.v4CustomValue}
        onModeChange={(m) => setScenario('v4Mode', m)}
        onCustomChange={(v) => setScenario('v4CustomValue', v)}
      />
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-component: 赔付率 mode picker（V1/V3）
// ──────────────────────────────────────────────

interface LossRatioPickerProps {
  testid: string;
  title: string;
  hint: string;
  cohorts: { year: number; lossRatioPct: number }[];
  mode: LossRatioMode;
  customValue: string;
  historicalYear: string;
  onModeChange: (m: LossRatioMode) => void;
  onCustomChange: (v: string) => void;
  onHistoricalYearChange: (y: string) => void;
}

function LossRatioPicker({
  testid,
  title,
  hint,
  cohorts,
  mode,
  customValue,
  historicalYear,
  onModeChange,
  onCustomChange,
  onHistoricalYearChange,
}: LossRatioPickerProps) {
  return (
    <div className="px-3 py-2 bg-white dark:bg-surface-1 border border-neutral-200 dark:border-subtle rounded mb-2" data-testid={testid}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{title}</span>
        <span className="text-[10px] text-neutral-500 tabular-nums">{hint}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-1.5">
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as LossRatioMode)}
          aria-label={`${title} 模式`}
          className="px-2 py-1 text-xs border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
        >
          {(Object.keys(LOSS_RATIO_MODE_LABELS) as LossRatioMode[]).map((m) => (
            <option key={m} value={m}>
              {LOSS_RATIO_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        {mode === 'custom' && (
          <input
            type="number"
            inputMode="decimal"
            value={customValue}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="自定义 %"
            aria-label={`${title} 自定义值`}
            className="px-2 py-1 text-xs border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
          />
        )}
        {mode === 'historical' && (
          <select
            value={historicalYear}
            onChange={(e) => onHistoricalYearChange(e.target.value)}
            aria-label={`${title} 历史年份`}
            className="px-2 py-1 text-xs border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          >
            <option value="">选择年份…</option>
            {cohorts.map((c) => (
              <option key={c.year} value={String(c.year)}>
                {c.year}（{fmtPct(c.lossRatioPct)}）
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-component: 增速 mode picker（V2）
// ──────────────────────────────────────────────

interface GrowthPickerProps {
  testid: string;
  title: string;
  hint: string;
  mode: GrowthMode;
  customValue: string;
  onModeChange: (m: GrowthMode) => void;
  onCustomChange: (v: string) => void;
}

function GrowthPicker({
  testid,
  title,
  hint,
  mode,
  customValue,
  onModeChange,
  onCustomChange,
}: GrowthPickerProps) {
  return (
    <div className="px-3 py-2 bg-white dark:bg-surface-1 border border-neutral-200 dark:border-subtle rounded mb-2" data-testid={testid}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{title}</span>
        <span className="text-[10px] text-neutral-500 tabular-nums">{hint}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-1.5">
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as GrowthMode)}
          aria-label={`${title} 模式`}
          className="px-2 py-1 text-xs border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
        >
          {(Object.keys(GROWTH_MODE_LABELS) as GrowthMode[]).map((m) => (
            <option key={m} value={m}>
              {GROWTH_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        {mode === 'custom' && (
          <input
            type="number"
            inputMode="decimal"
            value={customValue}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="自定义 %"
            aria-label={`${title} 自定义值`}
            className="px-2 py-1 text-xs border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
          />
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-component: 费用率 mode picker（V4）
// ──────────────────────────────────────────────

interface ExpensePickerProps {
  testid: string;
  title: string;
  meanValue: number;
  mode: ExpenseMode;
  customValue: string;
  onModeChange: (m: ExpenseMode) => void;
  onCustomChange: (v: string) => void;
}

function ExpensePicker({
  testid,
  title,
  meanValue,
  mode,
  customValue,
  onModeChange,
  onCustomChange,
}: ExpensePickerProps) {
  return (
    <div className="px-3 py-2 bg-white dark:bg-surface-1 border border-neutral-200 dark:border-subtle rounded mb-2" data-testid={testid}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{title}</span>
        <span className="text-[10px] text-neutral-500 tabular-nums">均值 {fmtPct(meanValue)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-1.5">
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as ExpenseMode)}
          aria-label={`${title} 模式`}
          className="px-2 py-1 text-xs border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
        >
          {(Object.keys(EXPENSE_MODE_LABELS) as ExpenseMode[]).map((m) => (
            <option key={m} value={m}>
              {EXPENSE_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        {mode === 'custom' && (
          <input
            type="number"
            inputMode="decimal"
            value={customValue}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="自定义 %"
            aria-label={`${title} 自定义值`}
            className="px-2 py-1 text-xs border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
          />
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-component: 终极固定成本率手输 + 预测期间
// ──────────────────────────────────────────────

interface FixedCostInputProps {
  fixedCostRatio: string;
  forecastPeriod: string;
  setScenario: <K extends keyof import('../hooks/useForecastBaseline').ScenarioModeInput>(
    key: K,
    value: import('../hooks/useForecastBaseline').ScenarioModeInput[K],
  ) => void;
  disabled: boolean;
}

function FixedCostInput({ fixedCostRatio, forecastPeriod, setScenario, disabled }: FixedCostInputProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-neutral-500">
          终极固定成本率 %（4 变量未涵盖，必填）
        </span>
        <input
          type="number"
          inputMode="decimal"
          value={fixedCostRatio}
          onChange={(e) => setScenario('ultimateFixedCostRatio', e.target.value)}
          disabled={disabled}
          placeholder="如：9"
          aria-label="终极固定成本率"
          className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-neutral-500">预测期间标签</span>
        <input
          type="text"
          value={forecastPeriod}
          onChange={(e) => setScenario('forecastPeriod', e.target.value)}
          disabled={disabled}
          placeholder="如：2027"
          aria-label="预测期间"
          className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
        />
      </label>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-component: 派生入参预览（只读）
// ──────────────────────────────────────────────

interface DerivedPreviewProps {
  preview: NonNullable<ReturnType<typeof deriveScenario> & { ok: true }>['scenario'];
}

function DerivedPreview({ preview }: DerivedPreviewProps) {
  return (
    <div
      data-testid="forecast-baseline-derived-preview"
      className="px-3 py-2 text-xs bg-primary-bg/40 border border-primary-200 dark:border-primary rounded space-y-0.5"
    >
      <div className="text-[10px] text-neutral-500">派生入参预览（提交前再次确认）</div>
      <div className="grid grid-cols-2 gap-x-4 tabular-nums">
        <span>派生保费 ≈ <strong>{fmtWan(preview.premium)}</strong></span>
        <span>vc = V3 + V4 = <strong>{fmtPct(preview.ultimateVariableCostRatio)}</strong></span>
        <span>fc = <strong>{fmtPct(preview.ultimateFixedCostRatio)}</strong></span>
        <span>cc = vc + fc = <strong>{fmtPct(preview.ultimateVariableCostRatio + preview.ultimateFixedCostRatio)}</strong></span>
      </div>
      <div className="text-[10px] text-neutral-500">
        V1={fmtPct(preview.resolved.v1)} · V2={fmtPct(preview.resolved.v2)} ·
        V3={fmtPct(preview.resolved.v3)} · V4={fmtPct(preview.resolved.v4)}
      </div>
      <p className="text-[10px] text-neutral-500">
        预测口径：未来一年新签业务情景。actual + V1 仅作上下文展示，不进入算法。
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-component: 测算结果
// ──────────────────────────────────────────────

// 直接引用 useForecastScenario 的 ForecastScenarioResult 类型；profit-scenario 响应在 v1/v2 之间共享。
type ForecastResultProps = {
  result: import('../hooks/useForecastScenario').ForecastScenarioResult;
};

function ForecastResultBlock({ result }: ForecastResultProps) {
  return (
    <div data-testid="forecast-baseline-result" className="space-y-3">
      <div className="px-3 py-2 bg-primary-bg border border-primary-200 dark:bg-primary-dark/20 dark:border-primary rounded">
        <h4 className="text-sm font-medium text-primary-dark dark:text-primary-light">{result.scenarioName}</h4>
        <p className="text-[10px] text-neutral-500 mt-0.5">
          假设来源：<code>derived_from_metric_registry</code>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <ResultCard label="终极综合成本率" value={fmtPct(result.ultimateCombinedCostRatio)} />
        <ResultCard label="预测经营利润率" value={fmtPct(result.forecastOperatingProfitMargin)} />
        <ResultCard
          label="全周期预测经营利润"
          value={fmtWan(result.fullCycleForecastOperatingProfit)}
          hint="不是财务报表利润"
        />
      </div>

      {result.warnings.length > 0 && (
        <div className="px-3 py-2 bg-warning-bg border border-warning rounded text-xs">
          <h5 className="font-medium text-warning-dark mb-1">⚠ 预测警示</h5>
          <ul className="list-disc list-inside space-y-0.5 text-warning-dark">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {result.forbiddenInterpretations.length > 0 && (
        <div className="px-3 py-2 bg-danger-bg border border-danger rounded text-xs">
          <h5 className="font-medium text-danger-dark mb-1">禁止解释（预测）</h5>
          <p className="text-danger-dark">
            该预测结果不得被解释为：{result.forbiddenInterpretations.join('、')}。
          </p>
        </div>
      )}
    </div>
  );
}

interface ResultCardProps {
  label: string;
  value: string;
  hint?: string;
}

function ResultCard({ label, value, hint }: ResultCardProps) {
  return (
    <div className="px-3 py-2 bg-white dark:bg-surface-1 border border-neutral-200 dark:border-subtle rounded">
      <div className="text-[10px] text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="text-base font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</div>
      {hint && <div className="text-[10px] text-neutral-400 mt-0.5">{hint}</div>}
    </div>
  );
}
