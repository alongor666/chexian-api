/**
 * 图表账本 · ECharts 图表面板（气泡/散点/折线/瀑布/帕累托/控制图/四象限）
 *
 * 复用项目 echarts 单例（已注册 Bar/Line/Scatter + 组件）与 getChartTheme 明暗主题。
 * 每个面板消费 useChartLedgerData 的 ChartResult，自带 载入/空/错 兜底。
 */
import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '@/shared/utils/echarts';
import { GRID_CONFIG, getChartTheme } from '@/shared/config/chartStyles';
import { useTheme } from '@/shared/theme';
import { colorClasses } from '@/shared/styles';
import { formatPercent, formatWanDirect, formatCount } from '@/shared/utils/formatters';
import { LOSS_RATIO_THRESHOLD } from '../ledgerMeta';
import type { AsyncState, ChartResult, ParetoBar, PointDatum } from '../types';

/** 图表账本统一配色（echarts 内联 hex，与既有 widgets 一致，不受 DC-003 className 约束） */
export const LEDGER_COLORS = {
  teal: '#13C2C2',
  tealDim: 'rgba(19,194,194,.28)',
  gold: '#E8B339',
  coral: '#F5615C',
  coralDim: 'rgba(245,97,92,.30)',
  good: '#52C41A',
  danger: '#F5222D',
  muted: '#8C8C8C',
} as const;

/** 满期赔付率 → 珊瑚渐变（50→95 映射 teal→coral），供热力图/散点着色复用 */
export function lossRatioColor(v: number): string {
  const t = Math.max(0, Math.min(1, (v - 50) / (95 - 50)));
  const c1 = [19, 194, 194];
  const c2 = [245, 97, 92];
  const c = c1.map((a, i) => Math.round(a + (c2[i] - a) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const H = 260;

/** 载入/空/错 兜底框 */
export const ChartFrame: React.FC<{ s: AsyncState; children: React.ReactNode; height?: number }> = ({
  s,
  children,
  height = H,
}) => {
  if (s.loading)
    return (
      <div className={`flex items-center justify-center ${colorClasses.text.neutralMuted}`} style={{ height }}>
        载入中…
      </div>
    );
  if (s.error)
    return (
      <div className={`flex items-center justify-center ${colorClasses.text.danger}`} style={{ height }}>
        数据加载失败
      </div>
    );
  if (s.empty)
    return (
      <div className={`flex items-center justify-center ${colorClasses.text.neutralMuted}`} style={{ height }}>
        当前筛选下无数据
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
      grid: GRID_CONFIG,
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'item',
        formatter: (p: any) =>
          `${p.data.name}<br/>保费 ${formatWanDirect(p.data.value[0])}万<br/>赔付率 ${formatPercent(p.data.value[1])}<br/>件数 ${formatCount(p.data.value[2])}`,
      },
      xAxis: { ...theme.xAxisConfig, type: 'value', name: '保费规模(万元)', nameLocation: 'middle', nameGap: 28, nameTextStyle: theme.chartTextStyles.axisName, axisLabel: { ...theme.xAxisConfig.axisLabel, interval: 'auto' as const } },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '满期赔付率(%)', nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          type: 'scatter',
          symbolSize: (val: number[]) => 10 + 30 * Math.sqrt((val[2] ?? 0) / maxC),
          data: r.data.map((p) => ({
            name: p.name,
            value: [p.x, p.y, p.r ?? 0],
            itemStyle: {
              color: p.y >= LOSS_RATIO_THRESHOLD ? LEDGER_COLORS.coralDim : LEDGER_COLORS.tealDim,
              borderColor: p.y >= LOSS_RATIO_THRESHOLD ? LEDGER_COLORS.coral : LEDGER_COLORS.teal,
              borderWidth: 1.5,
            },
          })),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: LEDGER_COLORS.muted, type: 'dashed' as const },
            data: [{ yAxis: LOSS_RATIO_THRESHOLD }],
            label: { formatter: `赔付率 ${LOSS_RATIO_THRESHOLD}%`, color: theme.textColors.tertiary },
          },
        },
      ],
    };
  }, [r.data, theme]);
  return (
    <ChartFrame s={r}>
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: H }} notMerge />
    </ChartFrame>
  );
};

// ── Chart 02 费用率异常散点 ──
export const FeeOutlierChart: React.FC<{ r: ChartResult<PointDatum[]> }> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(
    () => ({
      grid: GRID_CONFIG,
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'item',
        formatter: (p: any) => `${p.data.name}<br/>费用率 ${formatPercent(p.data.value[0])}<br/>保费 ${formatWanDirect(p.data.value[1])}万`,
      },
      xAxis: { ...theme.xAxisConfig, type: 'value', name: '费用率(%)', nameLocation: 'middle', nameGap: 28, nameTextStyle: theme.chartTextStyles.axisName, axisLabel: { ...theme.xAxisConfig.axisLabel, interval: 'auto' as const } },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '保费规模(万元)', nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          type: 'scatter',
          symbolSize: (_v: number[], p: any) => (p.data.outlier ? 14 : 8),
          data: r.data.map((p) => ({
            name: p.name,
            value: [p.x, p.y],
            outlier: p.outlier,
            symbol: p.outlier ? 'diamond' : 'circle',
            itemStyle: { color: p.outlier ? LEDGER_COLORS.coral : LEDGER_COLORS.teal },
          })),
        },
      ],
    }),
    [r.data, theme]
  );
  return (
    <ChartFrame s={r}>
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: H }} notMerge />
    </ChartFrame>
  );
};

// ── Chart 05 出险频度趋势 ──
export const FrequencyTrendChart: React.FC<{ r: ChartResult<{ labels: string[]; freq: number[] }> }> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(
    () => ({
      grid: GRID_CONFIG,
      tooltip: { ...theme.tooltipConfig, valueFormatter: (v: number) => formatPercent(v) },
      xAxis: { ...theme.xAxisConfig, type: 'category', data: r.data.labels },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '出险频度(%)', scale: true, nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          type: 'line',
          data: r.data.freq,
          smooth: true,
          symbolSize: 6,
          lineStyle: { color: LEDGER_COLORS.teal, width: 2 },
          itemStyle: { color: LEDGER_COLORS.teal },
          areaStyle: { color: LEDGER_COLORS.tealDim },
        },
      ],
    }),
    [r.data, theme]
  );
  return (
    <ChartFrame s={r}>
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: H }} notMerge />
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
    return {
      grid: GRID_CONFIG,
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'axis',
        axisPointer: { type: 'shadow' as const },
        formatter: (ps: any[]) => {
          const idx = ps[0].dataIndex;
          const raw = idx < steps.length ? steps[idx].value : marginWan;
          return `${labels[idx]}<br/>${raw >= 0 ? '+' : ''}${formatWanDirect(raw)} 万元`;
        },
      },
      xAxis: { ...theme.xAxisConfig, type: 'category', data: labels },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '万元', nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        { type: 'bar', stack: 'wf', itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } }, data: placeholders, silent: true },
        {
          type: 'bar',
          stack: 'wf',
          barWidth: '55%',
          data: bars,
          label: {
            show: true,
            position: 'top' as const,
            color: theme.textColors.secondary,
            formatter: (p: any) => {
              const idx = p.dataIndex;
              const raw = idx < steps.length ? steps[idx].value : marginWan;
              return `${raw >= 0 ? '+' : ''}${formatWanDirect(raw)}`;
            },
          },
        },
      ],
    };
  }, [r.data, theme]);
  return (
    <ChartFrame s={r}>
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: H }} notMerge />
    </ChartFrame>
  );
};

// ── Chart 09 机构亏损帕累托 ──
export const LossParetoChart: React.FC<{ r: ChartResult<ParetoBar[]> }> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(
    () => ({
      grid: { ...GRID_CONFIG, right: '12%' },
      tooltip: { ...theme.tooltipConfig, trigger: 'axis', axisPointer: { type: 'shadow' as const } },
      legend: { data: ['亏损金额(万元)', '累计占比(%)'], textStyle: theme.chartTextStyles.legend, top: 0 },
      xAxis: { ...theme.xAxisConfig, type: 'category', data: r.data.map((b) => b.name), axisLabel: { ...theme.xAxisConfig.axisLabel, interval: 0, rotate: r.data.length > 6 ? 30 : 0 } },
      yAxis: [
        { ...theme.yAxisConfig, type: 'value', name: '万元', nameTextStyle: theme.chartTextStyles.axisName },
        { ...theme.yAxisConfig, type: 'value', name: '累计%', min: 0, max: 100, position: 'right' as const, nameTextStyle: theme.chartTextStyles.axisName },
      ],
      series: [
        { name: '亏损金额(万元)', type: 'bar', data: r.data.map((b) => b.value), itemStyle: { color: LEDGER_COLORS.coralDim, borderColor: LEDGER_COLORS.coral, borderWidth: 1 } },
        { name: '累计占比(%)', type: 'line', yAxisIndex: 1, data: r.data.map((b) => +b.cumPct.toFixed(1)), smooth: true, symbolSize: 5, lineStyle: { color: LEDGER_COLORS.gold }, itemStyle: { color: LEDGER_COLORS.gold } },
      ],
    }),
    [r.data, theme]
  );
  return (
    <ChartFrame s={r}>
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: H }} notMerge />
    </ChartFrame>
  );
};

// ── Chart 11 变动成本率控制图 ──
export const ControlChart: React.FC<{
  r: ChartResult<{ labels: string[]; vals: number[]; cl: number; ucl: number; lcl: number }>;
}> = ({ r }) => {
  const theme = useThemeBits();
  const option = useMemo(() => {
    const { labels, vals, cl, ucl, lcl } = r.data;
    return {
      grid: GRID_CONFIG,
      tooltip: { ...theme.tooltipConfig, valueFormatter: (v: number) => formatPercent(v) },
      xAxis: { ...theme.xAxisConfig, type: 'category', data: labels },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '变动成本率(%)', scale: true, nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          type: 'line',
          data: vals,
          smooth: true,
          symbolSize: 7,
          lineStyle: { color: LEDGER_COLORS.teal, width: 2 },
          itemStyle: {
            color: (p: any) => (p.value > ucl || p.value < lcl ? LEDGER_COLORS.coral : LEDGER_COLORS.teal),
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              { yAxis: +ucl.toFixed(1), lineStyle: { color: LEDGER_COLORS.coral, type: 'dashed' as const }, label: { formatter: `UCL ${ucl.toFixed(1)}`, color: theme.textColors.tertiary } },
              { yAxis: +cl.toFixed(1), lineStyle: { color: LEDGER_COLORS.muted, type: 'dotted' as const }, label: { formatter: `CL ${cl.toFixed(1)}`, color: theme.textColors.tertiary } },
              { yAxis: +Math.max(0, lcl).toFixed(1), lineStyle: { color: LEDGER_COLORS.coral, type: 'dashed' as const }, label: { formatter: `LCL ${Math.max(0, lcl).toFixed(1)}`, color: theme.textColors.tertiary } },
            ],
          },
        },
      ],
    };
  }, [r.data, theme]);
  return (
    <ChartFrame s={r}>
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: H }} notMerge />
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
      grid: GRID_CONFIG,
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'item',
        formatter: (p: any) => `${p.data.name}<br/>增速 ${formatPercent(p.data.value[0])}<br/>赔付率 ${formatPercent(p.data.value[1])}`,
      },
      xAxis: { ...theme.xAxisConfig, type: 'value', name: '保费增速(%)', nameLocation: 'middle', nameGap: 28, nameTextStyle: theme.chartTextStyles.axisName, axisLabel: { ...theme.xAxisConfig.axisLabel, interval: 'auto' as const } },
      yAxis: { ...theme.yAxisConfig, type: 'value', name: '满期赔付率(%)', scale: true, nameTextStyle: theme.chartTextStyles.axisName },
      series: [
        {
          type: 'scatter',
          symbolSize: 12,
          data: r.data.map((p) => ({ name: p.name, value: [p.x, p.y], itemStyle: { color: color(p) } })),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: LEDGER_COLORS.muted, type: 'dashed' as const },
            data: [{ xAxis: +xThreshold.toFixed(1) }, { yAxis: LOSS_RATIO_THRESHOLD }],
          },
        },
      ],
    };
  }, [r.data, theme]);
  return (
    <ChartFrame s={r}>
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: H }} notMerge />
    </ChartFrame>
  );
};
