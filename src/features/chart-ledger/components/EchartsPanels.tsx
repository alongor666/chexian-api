/**
 * 图表账本 · ECharts 图表面板（气泡/散点/折线/瀑布/帕累托/控制图/四象限）
 *
 * 2026-07 Claude Design 重设计稿落地：参照线全部升格为「带中文标签的语义 markLine」
 * （65% 阈值 = 金色、离群/控制限 = 珊瑚色）、散点直接标注名称（图例改线端标注）、
 * 三态（载入骨架 / 错误+重试 / 空态引导）由 ChartFrame 统一渲染。
 * 复用项目 echarts 单例（Bar/Line/Scatter + 组件）与 getChartTheme 明暗主题。
 */
import React, { useMemo } from 'react';
import { EChartContainer } from '../../../widgets/charts/EChartContainer';
import { getChartTheme } from '@/shared/config/chartStyles';
import { useTheme } from '@/shared/theme';
import { cn, colorClasses, fontStyles, chartColors } from '@/shared/styles';
import { formatPercent, formatWanDirect, formatCount } from '@/shared/utils/formatters';
import { LOSS_RATIO_THRESHOLD } from '../ledgerMeta';
import type { AsyncState, ChartResult, ParetoBar, PointDatum } from '../types';
import type { EChartsParam } from '../../../shared/types/echarts';

/** 图表账本统一配色（echarts 内联 hex，与既有 widgets 一致，不受 DC-003 className 约束） */
export const LEDGER_COLORS = {
  teal: chartColors.series.teal,      // #13C2C2
  tealDim: 'rgba(19,194,194,.28)',    // teal 的 28% 透明变体（canvas 专用，非调色板 token）
  gold: chartColors.series.gold,      // #E8B339
  coral: chartColors.series.coral,    // #F5615C
  coralDim: 'rgba(245,97,92,.30)',    // coral 的 30% 透明变体（canvas 专用）
  good: chartColors.series.good,      // #52C41A
  danger: chartColors.series.danger,  // #F5222D
  muted: chartColors.series.muted,    // #8C8C8C
} as const;

/** 满期赔付率 → 珊瑚渐变（50→95 映射 teal→coral），供热力图/散点着色复用 */
export function lossRatioColor(v: number): string {
  const t = Math.max(0, Math.min(1, (v - 50) / (95 - 50)));
  const c1 = [19, 194, 194];
  const c2 = [245, 97, 92];
  const c = c1.map((a, i) => Math.round(a + (c2[i] - a) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const H = 250;

/** 设计稿统一 grid（留出轴名与散点名称标签空间） */
const LEDGER_GRID = { left: 8, right: 16, top: 24, bottom: 34, containLabel: true } as const;

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/** 载入骨架 / 错误+重试 / 空态引导 三态兜底框 */
export const ChartFrame: React.FC<{ s: AsyncState; children: React.ReactNode; height?: number }> = ({
  s,
  children,
  height = H,
}) => {
  if (s.loading)
    return (
      <div className="flex flex-col justify-center gap-3.5 px-2" style={{ height }}>
        <div className={cn('flex items-center gap-2.5 text-[13px]', colorClasses.text.neutralLight)}>
          <span className="w-4 h-4 rounded-full border-2 border-neutral-300 dark:border-neutral-600 border-t-primary animate-spin" />
          载入中…
        </div>
        {[70, 88, 60, 80].map((w) => (
          <div
            key={w}
            className="h-3 rounded bg-neutral-100 dark:bg-surface-2 animate-shimmer"
            style={{
              width: `${w}%`,
              backgroundImage: 'linear-gradient(90deg, transparent 25%, rgba(140,140,140,.18) 37%, transparent 63%)',
              backgroundSize: '200% 100%',
            }}
          />
        ))}
      </div>
    );
  if (s.error)
    return (
      <div className="flex flex-col items-center justify-center gap-3" style={{ height }}>
        <span className={colorClasses.text.danger}>
          <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2 L22 21 L2 21 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M12 9 L12 15 M12 17.5 L12 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <div className={cn('text-sm font-semibold', colorClasses.text.neutralBlack)}>数据加载失败</div>
        {s.retry && (
          <button
            type="button"
            onClick={s.retry}
            className={cn(
              'text-xs px-3.5 py-1 rounded-md border transition-colors',
              colorClasses.border.neutral,
              colorClasses.text.neutralLight,
              'hover:bg-neutral-100 dark:hover:bg-surface-3'
            )}
          >
            重试
          </button>
        )}
      </div>
    );
  if (s.empty)
    return (
      <div className="flex flex-col items-center justify-center gap-3" style={{ height }}>
        <span className={colorClasses.text.neutralMuted}>
          <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
            <path d="M7 14 L10 11 L13 14 L17 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".55" />
          </svg>
        </span>
        <div className={cn('text-sm', colorClasses.text.neutralLight)}>当前筛选下无数据</div>
        <div className={cn('text-xs', fontStyles.numeric, colorClasses.text.neutralMuted)}>请调整全局筛选（机构 / 时间窗）</div>
      </div>
    );
  return <>{children}</>;
};

const useThemeBits = () => {
  const { resolvedTheme } = useTheme();
  return getChartTheme(resolvedTheme === 'dark');
};

// ── Chart 01 客群产能-质量矩阵（气泡） ──
export const ChannelMatrixChart: React.FC<{ r: ChartResult<PointDatum[]> }> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(() => {
    const counts = r.data.map((p) => p.r ?? 0);
    const maxC = Math.max(1, ...counts);
    return {
      grid: LEDGER_GRID,
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'item',
        formatter: (p: EChartsParam) => {
          const d = p.data as { name: string; value: number[] };
          return `${d.name}<br/>保费 ${formatWanDirect(d.value[0])}万 · 赔付率 ${formatPercent(d.value[1])}<br/>件数 ${formatCount(d.value[2])}`;
        },
      },
      xAxis: { ...theme.xAxisConfig, type: 'value', name: '保费规模(万元)', nameLocation: 'middle', nameGap: 26, scale: true, nameTextStyle: theme.chartTextStyles.axisName, axisLabel: { ...theme.xAxisConfig.axisLabel, interval: 'auto' as const } },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '满期赔付率(%)', scale: true, nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          type: 'scatter',
          symbolSize: (val: number[]) => Math.max(14, 10 + 30 * Math.sqrt((val[2] ?? 0) / maxC)),
          data: r.data.map((p) => ({
            name: p.name,
            value: [p.x, p.y, p.r ?? 0],
            itemStyle: {
              color: p.y >= LOSS_RATIO_THRESHOLD ? LEDGER_COLORS.coralDim : LEDGER_COLORS.tealDim,
              borderColor: p.y >= LOSS_RATIO_THRESHOLD ? LEDGER_COLORS.coral : LEDGER_COLORS.teal,
              borderWidth: 1.5,
            },
          })),
          label: { show: true, formatter: (p: EChartsParam) => (p.data as { name: string }).name, color: theme.textColors.secondary, fontSize: 10, position: 'top' as const },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: LEDGER_COLORS.gold, type: 'dashed' as const, width: 1.5 },
            data: [{ yAxis: LOSS_RATIO_THRESHOLD }],
            label: { formatter: `赔付率阈值 ${LOSS_RATIO_THRESHOLD}%`, color: LEDGER_COLORS.gold, fontSize: 10, position: 'insideEndTop' as const },
          },
        },
      ],
    };
  }, [r.data, theme]);
  return (
    <ChartFrame s={r}>
      <EChartContainer option={option} height={H} />
    </ChartFrame>
  );
};

// ── Chart 02 费用率异常散点（正常群 + 离群菱形两系列） ──
export const FeeOutlierChart: React.FC<{ r: ChartResult<PointDatum[]> }> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(() => {
    const normal = r.data.filter((p) => !p.outlier);
    const outliers = r.data.filter((p) => p.outlier);
    const xs = r.data.map((p) => p.x);
    const hi = mean(xs) + 2 * std(xs);
    const tooltipFmt = (p: EChartsParam) => {
      const d = p.data as { name: string; value: number[] };
      return `${d.name}<br/>费用率 ${formatPercent(d.value[0])} · 保费 ${formatWanDirect(d.value[1])}万`;
    };
    return {
      grid: LEDGER_GRID,
      tooltip: { ...theme.tooltipConfig, trigger: 'item', formatter: tooltipFmt },
      xAxis: { ...theme.xAxisConfig, type: 'value', name: '费用率(%)', nameLocation: 'middle', nameGap: 26, scale: true, nameTextStyle: theme.chartTextStyles.axisName, axisLabel: { ...theme.xAxisConfig.axisLabel, interval: 'auto' as const } },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '保费规模(万元)', min: 0, nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          name: '正常机构',
          type: 'scatter',
          symbolSize: 13,
          data: normal.map((p) => ({ name: p.name, value: [p.x, p.y] })),
          itemStyle: { color: LEDGER_COLORS.teal },
          markLine:
            r.data.length >= 5
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: LEDGER_COLORS.coral, type: 'dashed' as const, width: 1.5 },
                  label: { formatter: `均值+2σ ${formatPercent(hi)}`, color: LEDGER_COLORS.coral, fontSize: 10, position: 'insideEndTop' as const },
                  data: [{ xAxis: +hi.toFixed(1) }],
                }
              : undefined,
        },
        {
          name: '离群机构',
          type: 'scatter',
          symbol: 'diamond',
          symbolSize: 20,
          data: outliers.map((p) => ({ name: p.name, value: [p.x, p.y] })),
          itemStyle: { color: LEDGER_COLORS.coral },
          label: {
            show: true,
            formatter: (p: EChartsParam) => {
              const d = p.data as { name: string; value: number[] };
              return `${d.name} ${formatPercent(d.value[0])}`;
            },
            color: LEDGER_COLORS.coral,
            fontSize: 10,
            fontWeight: 600 as const,
            position: 'top' as const,
          },
        },
      ],
    };
  }, [r.data, theme]);
  return (
    <ChartFrame s={r}>
      <EChartContainer option={option} height={H} />
    </ChartFrame>
  );
};

// ── Chart 05 出险频度趋势（直线 + 渐隐面积） ──
export const FrequencyTrendChart: React.FC<{ r: ChartResult<{ labels: string[]; freq: number[] }> }> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(
    () => ({
      grid: { ...LEDGER_GRID, top: 20, bottom: 28 },
      tooltip: { ...theme.tooltipConfig, valueFormatter: (v: number) => formatPercent(v) },
      xAxis: { ...theme.xAxisConfig, type: 'category', boundaryGap: false, data: r.data.labels },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '出险频度(%)', scale: true, nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          type: 'line',
          data: r.data.freq,
          smooth: false,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: LEDGER_COLORS.teal, width: 2 },
          itemStyle: { color: LEDGER_COLORS.teal },
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(19,194,194,.28)' },
                { offset: 1, color: 'rgba(19,194,194,.02)' },
              ],
            },
          },
        },
      ],
    }),
    [r.data, theme]
  );
  return (
    <ChartFrame s={r}>
      <EChartContainer option={option} height={H} />
    </ChartFrame>
  );
};

// ── Chart 08 承保利润瀑布（浮动柱 + 结果列） ──
export const ProfitWaterfallChart: React.FC<{
  r: ChartResult<{ steps: { label: string; value: number }[]; marginWan: number }>;
}> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(() => {
    const { steps, marginWan } = r.data;
    const labels = [...steps.map((s) => s.label), '承保边际'];
    const placeholders: number[] = [];
    const bars: { value: number; itemStyle: { color: string } }[] = [];
    let sum = 0;
    steps.forEach((s, i) => {
      if (i === 0) {
        placeholders.push(0);
        bars.push({ value: s.value, itemStyle: { color: LEDGER_COLORS.teal } });
        sum = s.value;
      } else if (s.value >= 0) {
        placeholders.push(sum);
        bars.push({ value: s.value, itemStyle: { color: LEDGER_COLORS.good } });
        sum += s.value;
      } else {
        sum += s.value;
        placeholders.push(sum);
        bars.push({ value: -s.value, itemStyle: { color: LEDGER_COLORS.coral } });
      }
    });
    // 结果列（从 0 起）
    placeholders.push(0);
    bars.push({ value: marginWan, itemStyle: { color: LEDGER_COLORS.gold } });
    const signed = (idx: number) => {
      const raw = idx < steps.length ? steps[idx].value : marginWan;
      return `${raw >= 0 ? '+' : '−'}${formatWanDirect(Math.abs(raw))}`;
    };
    return {
      grid: { ...LEDGER_GRID, bottom: 28 },
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'axis',
        axisPointer: { type: 'shadow' as const },
        formatter: (ps: EChartsParam[]) => `${labels[ps[0].dataIndex as number]}<br/>${signed(ps[0].dataIndex as number)} 万元`,
      },
      xAxis: { ...theme.xAxisConfig, type: 'category', data: labels },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '万元', nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        { type: 'bar', stack: 'wf', itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } }, data: placeholders, silent: true, tooltip: { show: false } },
        {
          type: 'bar',
          stack: 'wf',
          barWidth: '48%',
          data: bars,
          label: {
            show: true,
            position: 'top' as const,
            color: theme.textColors.secondary,
            fontSize: 11,
            formatter: (p: EChartsParam) => signed(p.dataIndex as number),
          },
        },
      ],
    };
  }, [r.data, theme]);
  return (
    <ChartFrame s={r}>
      <EChartContainer option={option} height={H} />
    </ChartFrame>
  );
};

// ── Chart 09 机构亏损帕累托（柱 + 累计线 + 80% 参照线） ──
export const LossParetoChart: React.FC<{ r: ChartResult<ParetoBar[]> }> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(
    () => ({
      grid: { ...LEDGER_GRID, right: 24, top: 30, bottom: 28 },
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'axis',
        axisPointer: { type: 'shadow' as const },
        formatter: (ps: EChartsParam[]) => {
          const i = ps[0].dataIndex as number;
          const b = r.data[i];
          return b ? `${b.name}<br/>亏损 ${formatWanDirect(b.value)}万 · 累计 ${formatPercent(b.cumPct)}` : '';
        },
      },
      legend: { data: ['亏损金额(万元)', '累计占比(%)'], textStyle: theme.chartTextStyles.legend, top: 0, itemWidth: 14, itemHeight: 8 },
      xAxis: { ...theme.xAxisConfig, type: 'category', data: r.data.map((b) => b.name), axisLabel: { ...theme.xAxisConfig.axisLabel, interval: 0, rotate: r.data.length > 6 ? 30 : 0 } },
      yAxis: [
        { ...theme.yAxisConfig, type: 'value', name: '万元', nameTextStyle: theme.chartTextStyles.axisName },
        { ...theme.yAxisConfig, type: 'value', name: '累计%', min: 0, max: 100, position: 'right' as const, splitLine: { show: false }, nameTextStyle: theme.chartTextStyles.axisName },
      ],
      series: [
        { name: '亏损金额(万元)', type: 'bar', barWidth: '46%', data: r.data.map((b) => b.value), itemStyle: { color: LEDGER_COLORS.coralDim, borderColor: LEDGER_COLORS.coral, borderWidth: 1 } },
        {
          name: '累计占比(%)',
          type: 'line',
          yAxisIndex: 1,
          data: r.data.map((b) => +b.cumPct.toFixed(1)),
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: LEDGER_COLORS.gold, width: 2 },
          itemStyle: { color: LEDGER_COLORS.gold },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: theme.textColors.tertiary, type: 'dashed' as const, width: 1 },
            label: { formatter: '80%', color: theme.textColors.tertiary, fontSize: 10 },
            data: [{ yAxis: 80 }],
          },
        },
      ],
    }),
    [r.data, theme]
  );
  return (
    <ChartFrame s={r}>
      <EChartContainer option={option} height={H} />
    </ChartFrame>
  );
};

// ── Chart 11 变动成本率控制图（中心线 ± 2σ） ──
export const ControlChart: React.FC<{
  r: ChartResult<{ labels: string[]; vals: number[]; cl: number; ucl: number; lcl: number }>;
}> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(() => {
    const { labels, vals, cl, ucl, lcl } = r.data;
    const lclShown = Math.max(0, lcl);
    return {
      grid: { ...LEDGER_GRID, right: 48, top: 20, bottom: 28 },
      tooltip: { ...theme.tooltipConfig, valueFormatter: (v: number) => formatPercent(v) },
      xAxis: { ...theme.xAxisConfig, type: 'category', boundaryGap: false, data: labels },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '变动成本率(%)', scale: true, nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          type: 'line',
          data: vals.map((v) => ({
            value: v,
            itemStyle: { color: v > ucl || v < lcl ? LEDGER_COLORS.coral : LEDGER_COLORS.teal },
            symbolSize: v > ucl || v < lcl ? 9 : 5,
          })),
          lineStyle: { color: LEDGER_COLORS.teal, width: 2 },
          itemStyle: { color: LEDGER_COLORS.teal },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              { yAxis: +ucl.toFixed(1), lineStyle: { color: LEDGER_COLORS.coral, type: 'dashed' as const, width: 1.5 }, label: { formatter: `上限 ${ucl.toFixed(1)}`, color: LEDGER_COLORS.coral, fontSize: 10, position: 'insideEndTop' as const } },
              { yAxis: +cl.toFixed(1), lineStyle: { color: LEDGER_COLORS.muted, type: 'dashed' as const, width: 1 }, label: { formatter: `中线 ${cl.toFixed(1)}`, color: LEDGER_COLORS.muted, fontSize: 10, position: 'insideEndTop' as const } },
              { yAxis: +lclShown.toFixed(1), lineStyle: { color: LEDGER_COLORS.coral, type: 'dashed' as const, width: 1.5 }, label: { formatter: `下限 ${lclShown.toFixed(1)}`, color: LEDGER_COLORS.coral, fontSize: 10, position: 'insideEndBottom' as const } },
            ],
          },
        },
      ],
    };
  }, [r.data, theme]);
  return (
    <ChartFrame s={r}>
      <EChartContainer option={option} height={H} />
    </ChartFrame>
  );
};

// ── Chart 12 赔付率-保费增速四象限 ──
export const QuadrantChart: React.FC<{ r: ChartResult<PointDatum[]> }> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(() => {
    const xs = r.data.map((p) => p.x);
    const xThreshold = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    const color = (p: PointDatum): string => {
      if (p.x >= xThreshold && p.y < LOSS_RATIO_THRESHOLD) return LEDGER_COLORS.good; // 优质增长
      if (p.x >= xThreshold && p.y >= LOSS_RATIO_THRESHOLD) return LEDGER_COLORS.coral; // 风险扩张
      if (p.x < xThreshold && p.y < LOSS_RATIO_THRESHOLD) return LEDGER_COLORS.gold; // 潜力不足
      return LEDGER_COLORS.muted; // 低效业务
    };
    return {
      grid: LEDGER_GRID,
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'item',
        formatter: (p: EChartsParam) => {
          const d = p.data as { name: string; value: number[] };
          return `${d.name}<br/>增速 ${formatPercent(d.value[0])} · 赔付率 ${formatPercent(d.value[1])}`;
        },
      },
      xAxis: { ...theme.xAxisConfig, type: 'value', name: '保费增速(%)', nameLocation: 'middle', nameGap: 26, scale: true, nameTextStyle: theme.chartTextStyles.axisName, axisLabel: { ...theme.xAxisConfig.axisLabel, interval: 'auto' as const } },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '满期赔付率(%)', scale: true, nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          type: 'scatter',
          symbolSize: 13,
          data: r.data.map((p) => ({ name: p.name, value: [p.x, p.y], itemStyle: { color: color(p) } })),
          label: { show: true, formatter: (p: EChartsParam) => (p.data as { name: string }).name, color: theme.textColors.secondary, fontSize: 10, position: 'top' as const },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: theme.textColors.tertiary, type: 'dashed' as const, width: 1.2 },
            label: { fontSize: 10, color: theme.textColors.tertiary },
            data: [
              { yAxis: LOSS_RATIO_THRESHOLD, label: { formatter: `赔付率 ${LOSS_RATIO_THRESHOLD}%`, position: 'insideStartTop' as const } },
              { xAxis: +xThreshold.toFixed(1), label: { formatter: `增速均值 ${formatPercent(xThreshold)}`, position: 'insideEndTop' as const } },
            ],
          },
        },
      ],
    };
  }, [r.data, theme]);
  return (
    <ChartFrame s={r}>
      <EChartContainer option={option} height={H} />
    </ChartFrame>
  );
};
