import React, { useMemo } from 'react';
import type { EChartsOption, SeriesOption } from 'echarts';
import { EChartContainer, buildEmptyChartOption } from './EChartContainer';
import { formatPremiumWan } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';
import { getYearChartColor } from '../../shared/styles';
import { cardStyles, cn } from '../../shared/styles';
import type { PremiumTrendBarData } from '@/shared/types/trend';
import { getChartTheme } from '../../shared/config/chartStyles';
import { useTheme } from '../../shared/theme';

// 同比增长率线专用色（Ant Design green-6，与项目语义 success #52c41a 对齐）
const YOY_LINE_COLOR = '#52c41a';

// 同比增长率是小数比率（可 >1，如 +500% → 5.0），必须显式 ×100；
// 不能用 formatRate（其 >1 自动检测会把 5.0 误判成"5%"，导致轴刻度不单调）
const fmtYoy = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

interface YoyComboChartProps {
  /** 同比柱线组合图数据 */
  data: PremiumTrendBarData[];
  /** 当前分析年份 */
  analysisYear?: number;
  loading?: boolean;
  height?: number;
}

/**
 * 本年 vs 上年同期 — 同比柱线组合小图
 *
 * 用于趋势模块右侧次级图：左 Y 保费柱（本年/上年），右 Y 同比增长率折线。
 * 设计简报 §5：无网格线、线端直接标注最新值、精确值入 tooltip。
 */
export const YoyComboChart: React.FC<YoyComboChartProps> = ({
  data,
  analysisYear,
  loading = false,
  height = 200,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo<EChartsOption>(() => {
    if (!data || data.length === 0) {
      return buildEmptyChartOption('暂无数据') as EChartsOption;
    }

    const theme = getChartTheme(isDark);
    const compact = (height ?? 200) < 240;
    const year = analysisYear ?? new Date().getFullYear();
    const currentYear = String(year);
    const prevYear = String(year - 1);

    // 次级小图：数据点过多时均匀抽稀（对齐设计简报的次级图疏朗处理），避免柱挤
    const plot = data.length > 9
      ? data.filter((_, i) => i % Math.ceil(data.length / 7) === 0 || i === data.length - 1)
      : data;

    const xLabels = plot.map((d) => d.display_label);

    // 同比增长率右 Y 轴 robust 范围：早期周上年基数极小会产生上万%的 outlier，
    // 直接 auto-scale 会把刻度拉坏。用对称裁剪范围（默认 ±50%，按实际值适度放宽到上限 200%）。
    const yoys = plot
      .map((d) => d.yoy_rate)
      .filter((v): v is number => v != null && isFinite(v));
    const yoyAbsMax = yoys.length ? Math.max(...yoys.map((v) => Math.abs(v))) : 0.2;
    const yoyBound = Math.min(2, Math.max(0.2, yoyAbsMax));

    const series: SeriesOption[] = [
      // 上年保费柱（ghost）
      {
        name: `${prevYear}年`,
        type: 'bar',
        yAxisIndex: 0,
        barGap: '8%',
        barCategoryGap: '38%',
        data: plot.map((d) => d.prev_premium),
        itemStyle: { color: getYearChartColor(prevYear), opacity: 0.55 },
      },
      // 本年保费柱（primary）
      {
        name: `${currentYear}年`,
        type: 'bar',
        yAxisIndex: 0,
        data: plot.map((d) => d.current_premium),
        itemStyle: { color: getYearChartColor(currentYear) },
      },
      // 同比增长率折线（右 Y）
      {
        name: '同比增长率',
        type: 'line',
        yAxisIndex: 1,
        data: plot.map((d) => d.yoy_rate),
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        itemStyle: { color: YOY_LINE_COLOR },
        lineStyle: { color: YOY_LINE_COLOR, width: 2 },
        // 线端直接标注最新值
        endLabel: {
          show: true,
          formatter: (params: any) => {
            const safeParams = params as EChartsParam;
            const v = typeof safeParams.value === 'number' ? safeParams.value : null;
            if (v === null) return '';
            return fmtYoy(v);
          },
          color: YOY_LINE_COLOR,
          fontSize: 10,
          fontWeight: 700,
        },
        label: {
          show: false,
        },
      },
    ];

    return {
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        formatter: (params: any) => {
          const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
          if (safeParams.length === 0) return '';
          let result = `<div style="font-weight:bold;margin-bottom:4px">${safeParams[0].axisValue}</div>`;
          safeParams.forEach((param) => {
            const name = String(param.seriesName ?? '');
            const raw = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
            if (param.value == null) return;
            const isRate = name.includes('增长率');
            const formatted = isRate
              ? fmtYoy(raw)
              : formatPremiumWan(raw) + '万';
            result += `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${param.color}"></span>
              <span>${name}: <strong>${formatted}</strong></span>
            </div>`;
          });
          return result;
        },
      },
      legend: {
        show: !compact,
        type: 'scroll',
        bottom: 0,
        itemWidth: 10,
        itemHeight: 8,
        textStyle: { fontSize: 10, color: theme.chartTextStyles.legend.color },
        data: [
          { name: `${prevYear}年`, icon: 'rect' },
          { name: `${currentYear}年`, icon: 'rect' },
          { name: '同比增长率', icon: 'circle' },
        ],
      },
      grid: { left: '2%', right: '14%', bottom: compact ? '6%' : '20%', top: '6%', containLabel: true, show: false },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          ...theme.xAxisConfig.axisLabel,
          fontSize: 10,
          interval: Math.max(0, Math.floor(xLabels.length / 6) - 1),
        },
      },
      yAxis: [
        {
          type: 'value',
          name: '万元',
          nameTextStyle: { fontSize: 10, color: theme.chartTextStyles.axisLabel.color, padding: [0, 0, 0, -10] },
          position: 'left',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            ...theme.yAxisConfig.axisLabel,
            fontSize: 10,
            formatter: (v: number) => formatPremiumWan(v),
          },
        },
        {
          type: 'value',
          name: '同比',
          nameTextStyle: { fontSize: 10, color: YOY_LINE_COLOR, padding: [0, -10, 0, 0] },
          position: 'right',
          // robust 对称范围，避免极端同比把刻度拉坏（超界点贴边显示，tooltip 仍给真实值）
          min: -yoyBound,
          max: yoyBound,
          splitNumber: 3,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            fontSize: 10,
            color: YOY_LINE_COLOR,
            formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
          },
        },
      ],
      series,
    };
  }, [data, analysisYear, isDark, height]);

  return (
    <div className={cn(cardStyles.base, 'p-3')}>
      <EChartContainer option={option} loading={loading} height={height} />
    </div>
  );
};
