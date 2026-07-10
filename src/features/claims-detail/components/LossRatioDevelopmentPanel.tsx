/**
 * 赔付率发展三角形面板（日历发展口径，重设计 v2）
 *
 * 信息架构（自上而下）：
 *   1. 叙事横幅         — 一句话结论 + 状态徽章 + 单 hero metric（同期对比徽章）
 *   2. 指标切换器       — 满期赔付率 / 出险率 / 案均
 *   3. 智能洞察 grid    — kind='card' 的 InsightCard 网格 + kind='note' 的横排小条
 *   4. 折线图           — 4 cohort × M1~M24（保留切换交互）
 *   5. 横向数据表       — 年份行 × M1~M24 列（"准 Excel 体验"，业务方依赖）
 *   6. 方法论说明
 *
 * 子组件位于 ./loss-ratio/，业务阈值与规则在 ./loss-ratio/insights.ts 单元测试覆盖。
 * cohort 同源（codex review 防御）：所有数从同一条 SQL `generateLossRatioDevelopmentQuery`
 * 派生，横幅 / hero / insights / 图表 / 表格共享 `lossRatioDev.data`。
 */
import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { EChartContainer } from '../../../widgets/charts/EChartContainer';
import {
  cardStyles,
  colorClasses,
  cn,
  fontStyles,
  getYearChartColor,
} from '@/shared/styles';
import { useTheme } from '@/shared/theme';
import { getChartTheme } from '@/shared/config/chartStyles';
import type { EChartsParam } from '@/shared/types/echarts';

import { HeroMetric, SectionHeader, StatusPill } from './shared/atoms';
import {
  LOSS_RATIO_ICON_MAP,
  LossRatioInsightCard,
} from './loss-ratio/LossRatioInsightCard';
import { deriveHeadline } from './loss-ratio/headline';
import { deriveLossRatioInsights } from './loss-ratio/insights';
import type {
  CohortData,
  LossRatioDevRow,
  LossRatioMetric,
} from './loss-ratio/types';

import type { useClaimsDetail } from '../hooks/useClaimsDetail';

interface Props {
  hook: ReturnType<typeof useClaimsDetail>;
  params?: Record<string, string>;
}

const COHORT_YEARS = [2023, 2024, 2025, 2026];
const MAX_DEV = 24;
const getCohortColor = (year: number): string => getYearChartColor(year);

const METRIC_OPTIONS: {
  key: LossRatioMetric;
  label: string;
  unit: string;
  decimals: number;
}[] = [
  { key: 'loss_ratio_pct', label: '满期赔付率(%)', unit: '%', decimals: 1 },
  { key: 'incident_rate_pct', label: '满期出险率(%)', unit: '%', decimals: 1 },
  { key: 'avg_claim', label: '案均立案金额(元)', unit: '元', decimals: 0 },
];

/** 数据加载占位 — 防止"正常 → 异常"视觉跳变 */
function NarrativeBannerSkeleton() {
  return (
    <div
      className={cn(
        cardStyles.standard,
        'relative overflow-hidden px-6 py-5',
        'bg-gradient-to-br from-white to-neutral-50',
        'dark:from-surface-1 dark:to-surface-2',
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-[280px] space-y-3">
          <div className="h-5 w-20 rounded-full bg-neutral-200 dark:bg-surface-2 animate-pulse" />
          <div className="h-6 w-72 rounded bg-neutral-200 dark:bg-surface-2 animate-pulse" />
          <div className="h-4 w-96 max-w-full rounded bg-neutral-100 dark:bg-surface-3 animate-pulse" />
        </div>
        <div className="h-16 w-56 rounded-xl bg-neutral-100 dark:bg-surface-2 animate-pulse" />
      </div>
    </div>
  );
}

export const LossRatioDevelopmentPanel: React.FC<Props> = ({ hook, params }) => {
  const { lossRatioDev } = hook;
  const claimsCutoff = lossRatioDev.claimsCutoff ?? null;
  const [metric, setMetric] = useState<LossRatioMetric>('loss_ratio_pct');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const chartTheme = getChartTheme(isDark);

  const loadData = useCallback(() => {
    hook.fetchLossRatioDev({
      ...params,
      cohortYears: COHORT_YEARS.join(','),
    });
  }, [hook.fetchLossRatioDev, params]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 按年份分组 cohort
  const cohorts = useMemo<Record<number, CohortData>>(() => {
    const result: Record<number, CohortData> = {};
    for (const yr of COHORT_YEARS) {
      result[yr] = { policyCount: 0, premiumWan: 0, maxDev: 0, months: {} };
    }
    for (const row of lossRatioDev.data as LossRatioDevRow[]) {
      const yr = row.cohort_year ?? 0;
      if (!result[yr]) continue;
      result[yr].policyCount = row.total_policies ?? 0;
      result[yr].premiumWan = row.total_premium_wan ?? 0;
      const devM = row.dev_month ?? 0;
      result[yr].months[devM] = row;
      if (devM > result[yr].maxDev) {
        result[yr].maxDev = devM;
      }
    }
    return result;
  }, [lossRatioDev.data]);

  const activeYears = useMemo(
    () => COHORT_YEARS.filter(yr => cohorts[yr]?.maxDev > 0),
    [cohorts],
  );

  const getVal = useCallback(
    (yr: number, m: number, key: keyof LossRatioDevRow): number | null => {
      const v = cohorts[yr]?.months[m]?.[key];
      return v != null ? Number(v) : null;
    },
    [cohorts],
  );

  // 横幅派生（跟随当前 metric）
  const headline = useMemo(
    () => deriveHeadline(cohorts, activeYears, metric),
    [cohorts, activeYears, metric],
  );

  // 洞察派生（跟随当前 metric）
  const insights = useMemo(
    () => deriveLossRatioInsights(cohorts, activeYears, metric),
    [cohorts, activeYears, metric],
  );
  const insightCards = insights.filter(i => i.kind === 'card');
  const insightNotes = insights.filter(i => i.kind === 'note');

  // 图表 option
  const chartOption = useMemo(() => {
    const m = METRIC_OPTIONS.find(o => o.key === metric)!;
    const series = activeYears.map(yr => ({
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
        formatter: (params: EChartsParam[]) => {
          const idx = params[0]?.dataIndex ?? 0;
          const devM = idx + 1;
          let html = `<b>发展月 M${devM}</b><br/>`;
          for (const yr of activeYears) {
            const v = getVal(yr, devM, m.key);
            if (v == null) continue;
            const cov = getVal(yr, devM, 'coverage_pct');
            const partial =
              cov != null && cov < 99.9
                ? ` <span style="color:#f59e0b">(${cov.toFixed(0)}%覆盖)</span>`
                : '';
            const vStr =
              m.decimals > 0
                ? v.toFixed(m.decimals) + m.unit
                : Math.round(v).toLocaleString() + m.unit;
            html += `<span style="color:${getCohortColor(yr)}">●</span> ${yr}: ${vStr}${partial}<br/>`;
          }
          return html;
        },
      },
      legend: {
        data: activeYears.map(String),
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
        min: (value: any) => Math.floor((value.min * 0.9) / 10) * 10,
        axisLabel: {
          ...chartTheme.yAxisConfig.axisLabel,
          formatter: (v: number) =>
            m.unit === '%' ? `${v}%` : v.toLocaleString(),
        },
        axisLine: chartTheme.yAxisConfig.axisLine,
        axisTick: chartTheme.yAxisConfig.axisTick,
        splitLine: { show: false },
        nameTextStyle: { color: chartTheme.textColors.secondary },
      },
      series,
    };
  }, [metric, activeYears, getVal, chartTheme]);

  const isLoading = lossRatioDev.loading;
  const error = lossRatioDev.error;
  const m = METRIC_OPTIONS.find(o => o.key === metric)!;
  // 三态分离（codex review #416 P2-2）：
  //   - isLoading：请求未完成 → 渲染骨架屏
  //   - isEmptyState：请求完成但 cohort 为空（如筛选过严）→ 渲染"无数据"卡，避免永久骨架感知
  //   - hasData：正常渲染横幅 + 洞察 + 图表 + 表格
  const isEmptyState = !isLoading && activeYears.length === 0;
  const hasData = !isLoading && activeYears.length > 0;

  if (error)
    return <div className={cn(colorClasses.text.danger, 'p-4')}>{error}</div>;

  return (
    <div className="space-y-5">
      {/* 1. 叙事横幅 */}
      {isLoading && <NarrativeBannerSkeleton />}
      {isEmptyState && (
        <div
          className={cn(
            cardStyles.standard,
            'px-6 py-8 text-center',
            colorClasses.text.neutralMuted,
          )}
        >
          <div className="text-sm">当前筛选条件下没有匹配的赔付率发展数据</div>
          <div className="text-xs mt-1">请调整三级机构 / 客户类别等筛选项后重试</div>
        </div>
      )}
      {hasData && (
        <div
          className={cn(
            cardStyles.standard,
            'relative overflow-hidden px-6 py-5',
            'bg-gradient-to-br from-white to-neutral-50',
            'dark:from-surface-1 dark:to-surface-2',
          )}
        >
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <div className="flex items-center gap-3 mb-3">
                <StatusPill severity={headline.severity} label={headline.tagLabel} />
                <span className={cn('text-xs', colorClasses.text.neutralMuted)}>
                  赔付率发展三角形
                </span>
                {claimsCutoff && (
                  <span
                    className={cn(
                      'ml-auto text-xs whitespace-nowrap',
                      colorClasses.text.neutralMuted,
                    )}
                  >
                    数据截止 {claimsCutoff}
                  </span>
                )}
              </div>
              <h2
                className={cn(
                  'text-xl font-bold tracking-tight leading-tight',
                  colorClasses.text.neutralBlack,
                )}
              >
                {headline.headline}
              </h2>
              <p
                className={cn(
                  'text-sm mt-2 leading-relaxed',
                  colorClasses.text.neutralDark,
                )}
              >
                {headline.summary}
              </p>
            </div>
            {headline.hero && (
              <div
                className={cn(
                  'flex items-center px-5 py-3 rounded-xl border',
                  'bg-white dark:bg-surface-2',
                  colorClasses.border.neutral,
                )}
              >
                <HeroMetric
                  label={headline.hero.label}
                  value={headline.hero.value}
                  unit={headline.hero.unit}
                  severity={headline.hero.severity}
                  badge={headline.hero.badge}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. 指标切换器 */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <div className="flex items-center gap-2 flex-wrap">
          {METRIC_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setMetric(opt.key)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                metric === opt.key
                  ? 'bg-primary-solid text-white border-primary'
                  : `bg-transparent ${colorClasses.border.neutral} ${colorClasses.text.neutral} hover:bg-neutral-100 dark:hover:bg-white/8`,
              )}
            >
              {opt.label}
            </button>
          ))}
          <span className={cn('ml-auto text-xs', colorClasses.text.neutralMuted)}>
            切换指标，下方洞察 / 图表 / 表格同步更新
          </span>
        </div>
      </div>

      {/* 3. 智能洞察 */}
      {hasData && (insightCards.length > 0 || insightNotes.length > 0) && (
        <section>
          <SectionHeader
            icon={Sparkles}
            title="智能洞察"
            sub={`基于当前指标「${m.label}」自动识别需关注的事项`}
            rightExtra={
              <span className={cn('text-xs', colorClasses.text.neutralMuted)}>
                {insightCards.length} 条主洞察
                {insightNotes.length > 0 ? ` · ${insightNotes.length} 条补充` : ''}
              </span>
            }
          />
          {insightCards.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {insightCards.map(ins => (
                <LossRatioInsightCard key={ins.id} insight={ins} />
              ))}
            </div>
          )}
          {insightNotes.length > 0 && (
            <div
              className={cn(
                'mt-3 px-4 py-2.5 rounded-lg border border-dashed',
                colorClasses.border.neutral,
                'bg-neutral-50/60 dark:bg-surface-2/60',
              )}
            >
              <ul className="space-y-1.5 text-xs leading-relaxed">
                {insightNotes.map(ins => {
                  // claude review #416 P3：note 渲染补 iconKey 小图标（opacity-50 不抢视觉权重），
                  // 让 compare（📊）和 info（ℹ️）有细微辨识 — 此前两种 note 仅靠文字区分。
                  const NoteIcon = LOSS_RATIO_ICON_MAP[ins.iconKey];
                  return (
                    <li key={ins.id} className="flex items-start gap-2">
                      <NoteIcon
                        size={12}
                        className={cn('shrink-0 mt-0.5 opacity-50', colorClasses.text.neutralMuted)}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          'font-semibold whitespace-nowrap',
                          colorClasses.text.neutralDark,
                        )}
                      >
                        {ins.title}
                      </span>
                      <span className={colorClasses.text.neutralMuted}>
                        {ins.body}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 4. 折线图 */}
      {hasData && (
        <div className={cn(cardStyles.standard, 'p-4')}>
          <EChartContainer option={chartOption} height={360} notMerge={false} />
        </div>
      )}

      {/* 5. 横向数据表 — "准 Excel 体验"，业务方依赖 24 列布局，不做折叠优化 */}
      {hasData && (
        <div className={cn(cardStyles.standard, 'p-4 overflow-x-auto')}>
          <table
            className={cn('w-full border-collapse', fontStyles.numeric)}
            style={{ tableLayout: 'fixed', fontSize: '11px' }}
          >
            <colgroup>
              <col style={{ width: 48 }} />
              {Array.from({ length: MAX_DEV }, (_, i) => (
                <col key={i} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  className={`text-left px-1 py-1 border-b ${colorClasses.border.neutral}`}
                />
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
                      const cov = getVal(yr, devM, 'coverage_pct');
                      const isLastMonth = devM === c.maxDev;
                      const partial = cov != null && cov < 99.9;
                      const vStr =
                        v != null
                          ? m.decimals > 0
                            ? v.toFixed(m.decimals)
                            : Math.round(v).toLocaleString()
                          : '';
                      return (
                        <td
                          key={devM}
                          className={cn(
                            'text-center px-0 py-1',
                            isLastMonth && 'font-bold',
                            partial && colorClasses.text.warning,
                          )}
                          style={
                            isLastMonth && !partial
                              ? { color: getCohortColor(yr) }
                              : undefined
                          }
                          title={
                            partial && cov != null
                              ? `覆盖 ${cov.toFixed(0)}% 保单（部分窗口）`
                              : undefined
                          }
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

      {/* 6. 方法论说明 */}
      <div
        className={cn(
          colorClasses.text.neutralMuted,
          'text-xs leading-relaxed px-1',
        )}
      >
        <b>方法论说明（日历发展口径，与「理赔热力图」同口径）</b>
        <br />
        1. 发展月 M 的观察终点 = LEAST(年初+M月-1日, max(policy_date))。M1=1月末, M12=全年末, 当 cutoff 落在窗口内时被截断。
        <br />
        2. 保单范围：起保日 ∈ [年初, 观察终点]（闭区间）。
        <br />
        3. 赔案范围：报案时间 ≤ 观察终点（report_time, 与理赔热力图默认一致）& 保单在窗口内。
        <br />
        4. 赔款取值：按结案状态二选一；已结案取已决赔款，未结案取立案金额，不相加。
        <br />
        5. 已赚保费 = 保费 × min(起保日到观察终点+1的天数, 保险期间) / 保险期间。
        <br />
        6. 满期出险率 = 赔案数 / 已赚暴露。已赚暴露 = Σ min(已赚天数, 保险期间) / 保险期间，年化可比。
        <br />
        7. 覆盖率 = 窗口内保单数 / 该年全部保单数。M12 时 ≈ 100%；表格中部分覆盖以橙色提示。
        <br />
        8. 数据截止：以保单最新录入日期 max(policy_date) 为全局 cutoff，与理赔热力图统一。
        <br />
        9. 对账锚点：本年 M_(currentMonth) 列 ≡ 理赔热力图末列（同 cutoff 同保单池同赔案池）。
        <br />
        10. cohort 同源：横幅 / hero / 洞察 / 图表 / 表格全部派生自同一条 SQL（generateLossRatioDevelopmentQuery），分子分母 cohort 严格自洽。
      </div>
    </div>
  );
};
