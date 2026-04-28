/**
 * ForecastScenarioPanel — Copilot 经营利润情景测算面板
 *
 * 调用 POST /api/agent/forecast/profit-scenario（确定性 calculator，无 LLM/SQL/DuckDB）。
 *
 * UX 红线：
 *  - 已赚率合计必须等于 100 才允许提交（前后端双校验）
 *  - warnings + forbiddenInterpretations 强制展示，不可折叠
 *  - "终极变动 / 终极固定 / 已赚率" 三类假设是调用方输入，前端必须把假设来源（assumptionSource）连同结果展示
 *  - 边际贡献额（仅扣变动成本）联动展示，让用户看清"扣变动 → 边际 → 扣固定 → 利润"的层次
 *
 * 不展示"承保利润 / 法定承保利润 / 审计利润"任何映射 — 那是后端 forbiddenInterpretations 的覆盖范围。
 */

import { useMemo } from 'react';
import { formatPremiumWan, formatPercent } from '../../../shared/utils/formatters';
import {
  isEarningScheduleSumValid,
  isInputSubmittable,
  useForecastScenario,
  type AssumptionSource,
} from '../hooks/useForecastScenario';

const ASSUMPTION_LABELS: Record<AssumptionSource, string> = {
  caller_provided: '调用方提供（手工录入）',
  pricing_redline_default: '定价红线默认值',
  derived_from_metric_registry: '指标注册表派生',
};

function formatYuanWan(value: number): string {
  return `${formatPremiumWan(value)} 万元`;
}

function formatRatioPct(value: number): string {
  return formatPercent(value, 2);
}

export function ForecastScenarioPanel() {
  const {
    input,
    state,
    setField,
    setEarningPeriod,
    addEarningPeriod,
    removeEarningPeriod,
    submit,
    resetInput,
  } = useForecastScenario();

  const earningSum = useMemo(() => {
    return input.earningSchedule.reduce((acc, item) => {
      const value = Number.parseFloat(item.earnedRatio);
      return Number.isFinite(value) ? acc + value : acc;
    }, 0);
  }, [input.earningSchedule]);

  const earningSumValid = isEarningScheduleSumValid(input.earningSchedule);
  const submittable = isInputSubmittable(input);
  const isBusy = state.status === 'submitting';

  // 派生：边际贡献额 = 签单保费 × (1 - 终极变动成本率/100)
  // 仅扣变动成本，不扣固定成本；与"利润"概念有本质区别（结果区会强制提示）
  const projectedMarginAmount = useMemo(() => {
    const premium = Number.parseFloat(input.premium);
    const vc = Number.parseFloat(input.ultimateVariableCostRatio);
    if (!Number.isFinite(premium) || !Number.isFinite(vc)) return null;
    return premium * (1 - vc / 100);
  }, [input.premium, input.ultimateVariableCostRatio]);

  return (
    <div className="flex flex-col h-full">
      <section className="px-4 py-3 border-b border-neutral-200 dark:border-subtle space-y-3 overflow-y-auto">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">情景输入</h3>
          <button
            type="button"
            onClick={resetInput}
            disabled={isBusy}
            className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
          >
            清空
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-neutral-500">情景名称</span>
          <input
            type="text"
            value={input.scenarioName}
            onChange={(e) => setField('scenarioName', e.target.value)}
            disabled={isBusy}
            placeholder="如：2026 终极假设 vc=85% fc=9%"
            className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-neutral-500">签单保费（元）</span>
          <input
            type="number"
            inputMode="decimal"
            value={input.premium}
            onChange={(e) => setField('premium', e.target.value)}
            disabled={isBusy}
            placeholder="如：20000000"
            className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
          />
        </label>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">终极变动成本率 %</span>
            <input
              type="number"
              inputMode="decimal"
              value={input.ultimateVariableCostRatio}
              onChange={(e) => setField('ultimateVariableCostRatio', e.target.value)}
              disabled={isBusy}
              placeholder="如：85"
              className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">终极固定成本率 %</span>
            <input
              type="number"
              inputMode="decimal"
              value={input.ultimateFixedCostRatio}
              onChange={(e) => setField('ultimateFixedCostRatio', e.target.value)}
              disabled={isBusy}
              placeholder="必填，无默认值"
              className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
            />
          </label>
        </div>

        {projectedMarginAmount !== null && (
          <div className="px-3 py-2 text-xs bg-neutral-50 dark:bg-white/5 rounded border border-neutral-200 dark:border-subtle">
            <span className="text-neutral-500">联动预览：</span>
            <span className="text-neutral-700 dark:text-neutral-300">
              签单保费 × (1 − 终极变动成本率) = 边际贡献额 ≈ <strong className="tabular-nums">{formatYuanWan(projectedMarginAmount)}</strong>
            </span>
            <p className="mt-1 text-[10px] text-neutral-500">
              边际贡献仅扣变动成本（赔付 + 费用），不扣固定成本，不是承保利润、财务利润或净利润。
            </p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-neutral-500">已赚率切分（合计必须 = 100）</span>
            <span
              data-testid="earning-sum-indicator"
              className={
                earningSumValid
                  ? 'text-xs text-success'
                  : 'text-xs text-danger'
              }
            >
              当前合计：{Number.isFinite(earningSum) ? earningSum.toFixed(2) : '0'}
            </span>
          </div>
          {input.earningSchedule.map((item, index) => (
            <div key={index} className="flex gap-2 items-center">
              <input
                type="text"
                value={item.period}
                onChange={(e) => setEarningPeriod(index, { period: e.target.value })}
                disabled={isBusy}
                placeholder={`期 ${index + 1}（如 2026）`}
                aria-label={`期间 ${index + 1}`}
                className="flex-1 px-2 py-1 text-sm border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
              />
              <input
                type="number"
                inputMode="decimal"
                value={item.earnedRatio}
                onChange={(e) => setEarningPeriod(index, { earnedRatio: e.target.value })}
                disabled={isBusy}
                placeholder="已赚率%"
                aria-label={`期 ${index + 1} 已赚率`}
                className="w-24 px-2 py-1 text-sm border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-right tabular-nums"
              />
              <button
                type="button"
                onClick={() => removeEarningPeriod(index)}
                disabled={isBusy || input.earningSchedule.length <= 1}
                aria-label={`删除期 ${index + 1}`}
                className="text-neutral-400 hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addEarningPeriod}
            disabled={isBusy}
            className="text-xs text-primary hover:text-primary-light disabled:opacity-50"
          >
            + 加期
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-neutral-500">假设来源</span>
          <select
            value={input.assumptionSource}
            onChange={(e) => setField('assumptionSource', e.target.value as AssumptionSource)}
            disabled={isBusy}
            className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          >
            {(Object.keys(ASSUMPTION_LABELS) as AssumptionSource[]).map((key) => (
              <option key={key} value={key}>
                {ASSUMPTION_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!submittable || isBusy}
            className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? '测算中…' : '测算情景'}
          </button>
          {state.status === 'error' && (
            <span className="text-xs text-danger self-center" role="alert">
              {state.error}
            </span>
          )}
        </div>
      </section>

      <section className="flex-1 overflow-auto px-4 py-3">
        {state.status === 'idle' && (
          <p className="text-sm text-neutral-400 text-center pt-8">
            填写情景假设，点击「测算情景」查看预测利润、敏感性与边际贡献。
          </p>
        )}
        {state.status === 'submitting' && (
          <p className="text-sm text-neutral-500 text-center pt-8">情景测算中…</p>
        )}
        {state.result && <ForecastResult result={state.result} />}
      </section>
    </div>
  );
}

interface ForecastResultProps {
  result: NonNullable<ReturnType<typeof useForecastScenario>['state']['result']>;
}

function ForecastResult({ result }: ForecastResultProps) {
  return (
    <div className="space-y-3">
      <div className="px-3 py-2 bg-primary-bg border border-primary-200 dark:bg-primary-dark/20 dark:border-primary rounded">
        <h4 className="text-sm font-medium text-primary-dark dark:text-primary-light">{result.scenarioName}</h4>
        <p className="text-[10px] text-neutral-500 mt-0.5">
          假设来源：<code>{ASSUMPTION_LABELS[result.assumptionSource]}</code>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <ResultCard label="终极综合成本率" value={formatRatioPct(result.ultimateCombinedCostRatio)} />
        <ResultCard label="预测经营利润率" value={formatRatioPct(result.forecastOperatingProfitMargin)} />
        <ResultCard label="全周期预测经营利润" value={formatYuanWan(result.fullCycleForecastOperatingProfit)} hint="不是财务报表利润" />
      </div>

      {result.perPeriodForecast.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">每期预测</h5>
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 dark:bg-white/5">
              <tr>
                <th className="px-2 py-1 text-left text-neutral-600 dark:text-neutral-400">期间</th>
                <th className="px-2 py-1 text-right text-neutral-600 dark:text-neutral-400">已赚率</th>
                <th className="px-2 py-1 text-right text-neutral-600 dark:text-neutral-400">预测利润</th>
                <th className="px-2 py-1 text-right text-neutral-600 dark:text-neutral-400">1pct 敏感性</th>
              </tr>
            </thead>
            <tbody>
              {result.perPeriodForecast.map((row, i) => {
                const sens = result.onePctSensitivity[i];
                return (
                  <tr key={row.period} className="border-t border-neutral-100 dark:border-subtle">
                    <td className="px-2 py-1 text-neutral-700 dark:text-neutral-300">{row.period}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {row.earnedRatio.toFixed(2)}%
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {formatYuanWan(row.forecastOperatingProfit)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-500">
                      {sens ? formatYuanWan(sens.sensitivity) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="px-3 py-2 bg-warning-bg border border-warning rounded text-xs">
          <h5 className="font-medium text-warning-dark mb-1">⚠ 警示</h5>
          <ul className="list-disc list-inside space-y-0.5 text-warning-dark">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {result.forbiddenInterpretations.length > 0 && (
        <div className="px-3 py-2 bg-danger-bg border border-danger rounded text-xs">
          <h5 className="font-medium text-danger-dark mb-1">禁止解释</h5>
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
