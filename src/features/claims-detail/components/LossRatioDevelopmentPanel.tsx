/**
 * 赔付率发展三角形面板（日历发展口径）
 *
 * 发展月 M_N 的观察窗口 = [年初, 年初+N个月)，累计扩展。
 * KPI 表格（5列4行）+ 折线图 + 横向数据表（年份行 × M1~M24 列）
 */
import React, { useEffect, useCallback, useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '@/shared/utils/echarts';
import { cardStyles, colorClasses, cn, fontStyles, tableStyles } from '@/shared/styles';

import type { useClaimsDetail } from '../hooks/useClaimsDetail';

interface Props {
  hook: ReturnType<typeof useClaimsDetail>;
  params?: Record<string, string>;
}

const COHORT_YEARS = [2023, 2024, 2025, 2026];
const MAX_DEV = 24;
const COHORT_COLORS: Record<number, string> = {
  2023: '#38bdf8',
  2024: '#34d399',
  2025: '#fb923c',
  2026: '#f472b6',
};

type Metric = 'loss_ratio_pct' | 'incident_rate_pct' | 'avg_claim';

const METRIC_OPTIONS: { key: Metric; label: string; unit: string; decimals: number }[] = [
  { key: 'loss_ratio_pct', label: '满期赔付率(%)', unit: '%', decimals: 2 },
  { key: 'incident_rate_pct', label: '满期出险率(%)', unit: '%', decimals: 4 },
  { key: 'avg_claim', label: '案均立案金额(元)', unit: '元', decimals: 0 },
];

interface CohortData {
  policyCount: number;
  premiumWan: number;
  maxDev: number;
  months: Record<number, any>;
}

export const LossRatioDevelopmentPanel: React.FC<Props> = ({ hook, params }) => {
  const { lossRatioDev } = hook;
  const [metric, setMetric] = useState<Metric>('loss_ratio_pct');

  const loadData = useCallback(() => {
    hook.fetchLossRatioDev({
      ...params,
      cohortYears: COHORT_YEARS.join(','),
    });
  }, [hook.fetchLossRatioDev, params]);

  useEffect(() => { loadData(); }, [loadData]);

  // 按年份分组
  const cohorts = useMemo(() => {
    const result: Record<number, CohortData> = {};
    for (const yr of COHORT_YEARS) {
      result[yr] = { policyCount: 0, premiumWan: 0, maxDev: 0, months: {} };
    }
    for (const row of lossRatioDev.data) {
      const yr = row.cohort_year ?? 0;
      if (!result[yr]) continue;
      result[yr].policyCount = row.total_policies ?? 0;
      result[yr].premiumWan = row.total_premium_wan ?? 0;
      result[yr].months[row.dev_month] = row;
      if ((row.dev_month ?? 0) > result[yr].maxDev) {
        result[yr].maxDev = row.dev_month;
      }
    }
    return result;
  }, [lossRatioDev.data]);

  const getVal = (yr: number, m: number, key: string): number | null => {
    const row = cohorts[yr]?.months[m];
    if (!row) return null;
    const v = row[key];
    return v != null ? Number(v) : null;
  };

  /** 取每个年份最新可用月的指标值 */
  const getLatestVal = (yr: number, key: string): number | null => {
    const maxM = cohorts[yr]?.maxDev ?? 0;
    return maxM > 0 ? getVal(yr, maxM, key) : null;
  };

  // 图表 option
  const chartOption = useMemo(() => {
    const m = METRIC_OPTIONS.find(o => o.key === metric)!;
    const series = COHORT_YEARS
      .filter(yr => cohorts[yr]?.maxDev > 0)
      .map(yr => ({
        name: String(yr),
        type: 'line' as const,
        data: Array.from({ length: MAX_DEV }, (_, i) => getVal(yr, i + 1, m.key)),
        connectNulls: false,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2.5 },
        itemStyle: { color: COHORT_COLORS[yr] },
      }));

    return {
      tooltip: {
        trigger: 'axis' as const,
        formatter: (params: any[]) => {
          const idx = params[0]?.dataIndex ?? 0;
          const devM = idx + 1;
          let html = `<b>发展月 M${devM}</b><br/>`;
          COHORT_YEARS.forEach(yr => {
            if (!cohorts[yr] || cohorts[yr].maxDev === 0) return;
            const v = getVal(yr, devM, m.key);
            if (v == null) return;
            const cov = getVal(yr, devM, 'coverage_pct');
            const partial = cov != null && cov < 99.9 ? ` <span style="color:#f59e0b">(${cov.toFixed(0)}%覆盖)</span>` : '';
            const vStr = m.decimals > 0 ? v.toFixed(m.decimals) + m.unit : Math.round(v).toLocaleString() + m.unit;
            html += `<span style="color:${COHORT_COLORS[yr]}">●</span> ${yr}: ${vStr}${partial}<br/>`;
          });
          return html;
        },
      },
      legend: {
        data: COHORT_YEARS.filter(yr => cohorts[yr]?.maxDev > 0).map(String),
      },
      grid: { left: 55, right: 20, top: 40, bottom: 30 },
      xAxis: {
        type: 'category' as const,
        data: Array.from({ length: MAX_DEV }, (_, i) => `M${i + 1}`),
      },
      yAxis: {
        type: 'value' as const,
        name: m.label,
        min: (value: any) => Math.floor(value.min * 0.9 / 10) * 10,
        axisLabel: { formatter: (v: number) => m.unit === '%' ? `${v}%` : v.toLocaleString() },
      },
      series,
    };
  }, [metric, cohorts]);

  const isLoading = lossRatioDev.loading;
  const error = lossRatioDev.error;
  const m = METRIC_OPTIONS.find(o => o.key === metric)!;

  // 有数据的年份
  const activeYears = COHORT_YEARS.filter(yr => cohorts[yr]?.maxDev > 0);

  if (error) return <div className={cn(colorClasses.text.danger, 'p-4')}>{error}</div>;

  return (
    <div className="space-y-6">
      {/* KPI 表格：5列4行 — 年度 / 满期赔付率 / 满期出险率 / 案均赔款 / 赔案件数 */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        {isLoading ? <div className="py-4 text-center">加载中...</div> : (
          <div className="overflow-x-auto">
            <table className={tableStyles.container}>
              <thead>
                <tr>
                  <th className={tableStyles.headerCell}>年度</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>满期赔付率</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>满期出险率</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>案均赔款</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>赔案件数</th>
                </tr>
              </thead>
              <tbody>
                {activeYears.map(yr => {
                  const c = cohorts[yr];
                  const maxM = c.maxDev;
                  const lr = getLatestVal(yr, 'loss_ratio_pct');
                  const ir = getLatestVal(yr, 'incident_rate_pct');
                  const ac = getLatestVal(yr, 'avg_claim');
                  const cc = getLatestVal(yr, 'claim_count');
                  const suffix = maxM < 12 ? ` (M${maxM})` : '';

                  return (
                    <tr key={yr} className={tableStyles.row}>
                      <td className={tableStyles.cell}>
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle"
                          style={{ background: COHORT_COLORS[yr] }}
                        />
                        {yr}
                      </td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.tabular)}>
                        {lr != null ? `${lr.toFixed(2)}%${suffix}` : '—'}
                      </td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.tabular)}>
                        {ir != null ? `${ir.toFixed(4)}%${suffix}` : '—'}
                      </td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.tabular)}>
                        {ac != null ? `${Math.round(ac).toLocaleString()}元${suffix}` : '—'}
                      </td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.tabular)}>
                        {cc != null ? `${Math.round(cc).toLocaleString()}${suffix}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 指标切换 + 图表 */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <div className="flex items-center gap-2 mb-3">
          {METRIC_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setMetric(opt.key)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                metric === opt.key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : `bg-transparent ${colorClasses.border.neutral} ${colorClasses.text.neutral} hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-700`
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {isLoading ? (
          <div className="h-[400px] flex items-center justify-center">加载中...</div>
        ) : (
          <ReactEChartsCore echarts={echarts} option={chartOption} style={{ height: 400 }} />
        )}

        {/* 横向数据表：年份行 × M1~M24 列 */}
        {!isLoading && (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs border-collapse" style={{ fontFamily: 'var(--mono, ui-monospace, monospace)' }}>
              <thead>
                <tr>
                  <th className={`text-left px-2 py-1.5 sticky left-0 bg-white dark:bg-neutral-800 z-10 border-b ${colorClasses.border.neutral}`} />
                  {Array.from({ length: MAX_DEV }, (_, i) => (
                    <th
                      key={i}
                      className={cn(
                        `text-right px-2 py-1.5 border-b ${colorClasses.border.neutral} min-w-[52px]`,
                        colorClasses.text.neutralMuted,
                      )}
                    >
                      M{i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeYears.map(yr => {
                  const c = cohorts[yr];
                  return (
                    <tr key={yr} className={`border-b ${colorClasses.border.neutral} dark:border-neutral-700/50`}>
                      <td className="px-2 py-1.5 sticky left-0 bg-white dark:bg-neutral-800 z-10 whitespace-nowrap">
                        <span
                          className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle"
                          style={{ background: COHORT_COLORS[yr] }}
                        />
                        <span style={{ color: COHORT_COLORS[yr] }}>{yr}</span>
                      </td>
                      {Array.from({ length: MAX_DEV }, (_, i) => {
                        const devM = i + 1;
                        const v = getVal(yr, devM, m.key);
                        const isLastMonth = devM === c.maxDev;
                        const vStr = v != null
                          ? (m.decimals > 0 ? v.toFixed(m.decimals) : Math.round(v).toLocaleString())
                          : '';
                        return (
                          <td
                            key={devM}
                            className={cn(
                              'text-right px-2 py-1.5',
                              isLastMonth && 'font-bold',
                            )}
                            style={isLastMonth ? { color: COHORT_COLORS[yr] } : undefined}
                          >
                            {vStr}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 方法论说明 */}
      <div className={cn(colorClasses.text.neutralMuted, 'text-xs leading-relaxed px-1')}>
        <b>方法论说明（日历发展口径）</b><br />
        1. 发展月 M 的观察窗口 = [年初, 年初+M个月)。M1=1月, M2=1-2月, ..., M12=全年, M18=至次年6月。<br />
        2. 保单范围：起保日在窗口内的保单（M ≤ 12 时逐月扩大，M {'>'} 12 时为全年保单）。<br />
        3. 赔案范围：出险时间在窗口内 & 保单在窗口内。<br />
        4. 已赚保费 = 保费 × min(起保日到窗口末端天数, 保险期间) / 保险期间。<br />
        5. 满期出险率 = 赔案数 / 已赚暴露。已赚暴露 = Σ min(观察天数, 保险期间) / 保险期间，年化可比。<br />
        6. 覆盖率 = 窗口内保单数 / 该年全部保单数。M12 时 ≈ 100%。
      </div>
    </div>
  );
};
