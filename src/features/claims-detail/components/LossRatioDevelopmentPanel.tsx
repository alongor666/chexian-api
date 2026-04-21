/**
 * 赔付率发展三角形面板（日历发展口径）
 *
 * 发展月 M_N 的观察窗口 = [年初, 年初+N个月)，累计扩展。
 * 规则驱动洞察 + 折线图 + 横向数据表（年份行 × M1~M24 列）
 */
import React, { useEffect, useCallback, useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '@/shared/utils/echarts';
import { cardStyles, colorClasses, cn, fontStyles, getYearChartColor } from '@/shared/styles';
import { generateDevInsights } from '../utils/devInsightRules';
import { useTheme } from '@/shared/theme';
import { getChartTheme } from '@/shared/config/chartStyles';

import type { useClaimsDetail } from '../hooks/useClaimsDetail';

interface Props {
  hook: ReturnType<typeof useClaimsDetail>;
  params?: Record<string, string>;
}

const COHORT_YEARS = [2023, 2024, 2025, 2026];
const MAX_DEV = 24;
/** 从设计令牌获取年份颜色 */
const getCohortColor = (year: number): string => getYearChartColor(year);

type Metric = 'loss_ratio_pct' | 'incident_rate_pct' | 'avg_claim';

const METRIC_OPTIONS: { key: Metric; label: string; unit: string; decimals: number }[] = [
  { key: 'loss_ratio_pct', label: '满期赔付率(%)', unit: '%', decimals: 1 },
  { key: 'incident_rate_pct', label: '满期出险率(%)', unit: '%', decimals: 1 },
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
  const claimsCutoff = lossRatioDev.claimsCutoff ?? null;
  const [metric, setMetric] = useState<Metric>('loss_ratio_pct');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const chartTheme = getChartTheme(isDark);

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
        itemStyle: { color: getCohortColor(yr) },
      }));

    return {
      tooltip: {
        ...chartTheme.tooltipConfig,
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
            html += `<span style="color:${getCohortColor(yr)}">●</span> ${yr}: ${vStr}${partial}<br/>`;
          });
          return html;
        },
      },
      legend: {
        data: COHORT_YEARS.filter(yr => cohorts[yr]?.maxDev > 0).map(String),
        textStyle: { color: chartTheme.textColors.secondary },
      },
      grid: { left: 48, right: 8, top: 40, bottom: 4 },
      xAxis: {
        type: 'category' as const,
        data: Array.from({ length: MAX_DEV }, (_, i) => `M${i + 1}`),
        ...chartTheme.xAxisConfig,
        axisLabel: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        name: m.label,
        min: (value: any) => Math.floor(value.min * 0.9 / 10) * 10,
        axisLabel: { ...chartTheme.yAxisConfig.axisLabel, formatter: (v: number) => m.unit === '%' ? `${v}%` : v.toLocaleString() },
        axisLine: chartTheme.yAxisConfig.axisLine,
        axisTick: chartTheme.yAxisConfig.axisTick,
        splitLine: { show: false },
        nameTextStyle: { color: chartTheme.textColors.secondary },
      },
      series,
    };
  }, [metric, cohorts, chartTheme]);

  const isLoading = lossRatioDev.loading;
  const error = lossRatioDev.error;
  const m = METRIC_OPTIONS.find(o => o.key === metric)!;

  // 有数据的年份
  const activeYears = COHORT_YEARS.filter(yr => cohorts[yr]?.maxDev > 0);

  // 规则驱动洞察（跟随当前选中指标）
  const insights = useMemo(
    () => generateDevInsights(cohorts, activeYears, metric),
    [cohorts, activeYears, metric],
  );

  /** 洞察类型→文字颜色 */
  const insightTextClass = (type: string): string => {
    switch (type) {
      case 'warning': return colorClasses.text.danger;
      case 'danger': return colorClasses.text.danger;
      case 'trend': return colorClasses.text.neutral;
      case 'anomaly': return colorClasses.text.warning;
      case 'compare': return colorClasses.text.primary;
      case 'info':
      default: return colorClasses.text.neutralMuted;
    }
  };

  if (error) return <div className={cn(colorClasses.text.danger, 'p-4')}>{error}</div>;

  return (
    <div className="space-y-6">
      {/* 指标切换 + 洞察 + 图表（一体） */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <div className="flex items-center gap-2 mb-3">
          {METRIC_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setMetric(opt.key)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                metric === opt.key
                  ? 'bg-primary-solid text-white border-primary'
                  : `bg-transparent ${colorClasses.border.neutral} ${colorClasses.text.neutral} hover:bg-neutral-100 dark:hover:bg-white/8`
              )}
            >
              {opt.label}
            </button>
          ))}
          {claimsCutoff && (
            <span className={cn('ml-auto text-xs whitespace-nowrap', colorClasses.text.neutralMuted)}>
              数据截止至 {claimsCutoff}
            </span>
          )}
        </div>

        {/* 洞察文字（跟随指标切换） */}
        {!isLoading && insights.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {insights.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm leading-relaxed">
                <span className="flex-shrink-0 mt-0.5">{item.icon}</span>
                <div>
                  <span className={cn('font-semibold', insightTextClass(item.type))}>{item.title}</span>
                  <span className={cn('ml-1.5', colorClasses.text.neutral)}>{item.description}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="h-[400px] flex items-center justify-center">加载中...</div>
        ) : (
          <ReactEChartsCore echarts={echarts} option={chartOption} style={{ height: 360 }} />
        )}

        {/* 横向数据表：年份行 × M1~M24 列，紧贴图表 */}
        {!isLoading && (
          <div className="-mt-1">
            <table className={cn('w-full border-collapse', fontStyles.numeric)} style={{ tableLayout: 'fixed', fontSize: '11px' }}>
              <colgroup>
                <col style={{ width: 48 }} />
                {Array.from({ length: MAX_DEV }, () => (
                  <col />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className={`text-left px-1 py-1 border-b ${colorClasses.border.neutral}`} />
                  {Array.from({ length: MAX_DEV }, (_, i) => (
                    <th
                      key={i}
                      className={cn(
                        `text-center px-0 py-1 border-b ${colorClasses.border.neutral}`,
                        colorClasses.text.neutralMuted,
                      )}
                    >
                      {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeYears.map(yr => {
                  const c = cohorts[yr];
                  return (
                    <tr key={yr} className={`border-b ${colorClasses.border.neutral}`}>
                      <td className="px-1 py-1 whitespace-nowrap">
                        <span
                          className="inline-block w-2 h-2 rounded-sm mr-1 align-middle"
                          style={{ background: getCohortColor(yr) }}
                        />
                        <span style={{ color: getCohortColor(yr) }}>{yr}</span>
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
                              'text-center px-0 py-1',
                              isLastMonth && 'font-bold',
                            )}
                            style={isLastMonth ? { color: getCohortColor(yr) } : undefined}
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
        <b>方法论说明（日历发展口径，与「理赔热力图」同口径）</b><br />
        1. 发展月 M 的观察终点 = LEAST(年初+M月-1日, max(policy_date))。M1=1月末, M12=全年末, 当 cutoff 落在窗口内时被截断。<br />
        2. 保单范围：起保日 ∈ [年初, 观察终点]（闭区间）。<br />
        3. 赔案范围：报案时间 ≤ 观察终点（report_time, 与理赔热力图默认一致）& 保单在窗口内。<br />
        4. 赔款取值：已决赔款 + 立案金额（未决赔款），即 settled + pending。<br />
        5. 已赚保费 = 保费 × min(起保日到观察终点+1的天数, 保险期间) / 保险期间。<br />
        6. 满期出险率 = 赔案数 / 已赚暴露。已赚暴露 = Σ min(已赚天数, 保险期间) / 保险期间，年化可比。<br />
        7. 覆盖率 = 窗口内保单数 / 该年全部保单数。M12 时 ≈ 100%。<br />
        8. 数据截止：以保单最新录入日期 max(policy_date) 为全局 cutoff，与理赔热力图统一。<br />
        9. 对账锚点：本年 M_(currentMonth) 列 ≡ 理赔热力图末列（同 cutoff 同保单池同赔案池）。
      </div>
    </div>
  );
};
