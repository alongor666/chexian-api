import React, { useEffect, useRef } from 'react';
import type { EChartsOption, SeriesOption } from 'echarts';
import { echarts } from '../../shared/utils/echarts';
import { formatPremiumWan, formatRate, formatCount, formatTrendDailyXAxis, TREND_DAILY_XAXIS_RICH } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';
import { getYearChartColor } from '../../shared/styles';
import { cardStyles, cn } from '../../shared/styles';
import type { PremiumTrendBarData } from '../../features/dashboard/hooks/useTrendData';
import { getChartTheme } from '../../shared/config/chartStyles';
import { useTheme } from '../../shared/theme';

/** 时间视图类型（原 shared/sql/trend 导出） */
export type TimeView = 'daily' | 'weekly' | 'monthly';

interface LineChartProps {
  title: string;
  data: {
    time_period: string;
    org_level_3: string;
    premium: number;
    next_month_ratio: number;
  }[];
  loading?: boolean;
  height?: number;
  timeView: TimeView;
  startDate?: string;
  endDate?: string;
  // V2.0: 支持动态Y轴标签
  yAxisLabel?: string;
  /** V3.0: 双Y轴柱+折线组合图数据（有值时走新图，无值走旧折线图） */
  barChartData?: PremiumTrendBarData[];
  /** 当前分析年份（用于颜色选择） */
  analysisYear?: number;
}

/**
 * 辅助函数：根据年和周序号计算该周的起始日期（同步 SQL 中的自然周逻辑）
 */
const getWeekStartDate = (year: number, week: number): Date => {
  const jan1 = new Date(year, 0, 1);
  const jan1DayOfWeek = jan1.getDay(); // 0 是周日
  // SQL 逻辑：第一周从 1月1日开始
  if (week === 1) return jan1;
  // 计算第一个周一
  const daysToFirstMonday = jan1DayOfWeek === 0 ? 1 : 8 - jan1DayOfWeek;
  // 第 n 周开始于：第一个周一 + (n-2) * 7 + 1
  return new Date(year, 0, daysToFirstMonday + (week - 2) * 7 + 1);
};

// ─── 颜色常量（设计系统） ────────────────────────────────────────────────

const CHART_COLORS = {
  yoyLine: '#f59e0b',       // amber-500: 同比增长率
  achievementLine: '#8b5cf6', // violet-500: 计划达成率
} as const;

/**
 * 渲染双Y轴柱状+折线组合图（V3.0）
 */
function renderBarLineCombo(
  chart: ReturnType<typeof echarts.init>,
  barData: PremiumTrendBarData[],
  title: string,
  timeView: TimeView,
  analysisYear: number,
  isDark: boolean,
): void {
  const theme = getChartTheme(isDark);
  const currentYear = String(analysisYear);
  const prevYear = String(analysisYear - 1);

  const xLabels = barData.map((d) => d.display_label);
  const hasAchievement = barData.some((d) => d.achievement_rate != null);

  const series: SeriesOption[] = [
    // 系列1: 上年同期保费（柱）
    {
      name: `${prevYear}年保费`,
      type: 'bar',
      yAxisIndex: 0,
      barGap: '10%',
      barCategoryGap: '40%',
      data: barData.map((d) => d.prev_premium),
      itemStyle: { color: getYearChartColor(prevYear), opacity: 0.6 },
    },
    // 系列2: 本年保费（柱）
    {
      name: `${currentYear}年保费`,
      type: 'bar',
      yAxisIndex: 0,
      data: barData.map((d) => d.current_premium),
      itemStyle: { color: getYearChartColor(currentYear) },
    },
    // 系列3: 年同比增长率（折线）
    {
      name: '年同比增长率',
      type: 'line',
      yAxisIndex: 1,
      data: barData.map((d) => d.yoy_rate),
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      itemStyle: { color: CHART_COLORS.yoyLine },
      lineStyle: { color: CHART_COLORS.yoyLine, width: 2 },
    },
  ];

  // 系列4: 计划达成率（仅有计划数据时显示）
  if (hasAchievement) {
    series.push({
      name: '计划达成率',
      type: 'line',
      yAxisIndex: 1,
      data: barData.map((d) => d.achievement_rate),
      smooth: true,
      symbol: 'diamond',
      symbolSize: 6,
      itemStyle: { color: CHART_COLORS.achievementLine },
      lineStyle: { color: CHART_COLORS.achievementLine, width: 2, type: 'dashed' },
    });
  }

  const option: EChartsOption = {
    title: title ? {
      text: title,
      left: 'center',
      textStyle: {
        fontSize: 16,
        fontWeight: 'bold',
        fontFamily: '"SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", "PingFang SC", sans-serif',
      },
    } : undefined,
    tooltip: {
      ...theme.tooltipConfig,
      trigger: 'axis' as const,
      axisPointer: { type: 'cross' as const },
      formatter: (params: any) => {
        const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
        if (safeParams.length === 0) return '';
        let result = `<div style="font-weight:bold">${safeParams[0].axisValue}</div>`;
        safeParams.forEach((param) => {
          const seriesName = String(param.seriesName ?? '');
          const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
          const isRate = seriesName.includes('增长率') || seriesName.includes('达成率');
          const formattedVal = isRate ? formatRate(rawValue) : formatPremiumWan(rawValue);
          if (param.value == null) return; // 跳过 null 值
          result += `<div style="display:flex;align-items:center;margin-top:4px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${param.color};margin-right:5px"></span><span>${seriesName}: <strong>${formattedVal}</strong></span></div>`;
        });
        return result;
      },
    },
    legend: {
      type: 'scroll',
      bottom: 0,
      data: series.map((s) => s.name) as string[],
    },
    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true, show: false },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: { show: false },
      axisTick: { show: true, alignWithLabel: true },
      splitLine: { show: false },
      axisLabel: {
        ...theme.xAxisConfig.axisLabel,
        rotate: 0,
        interval: 0,
        formatter: (value: string) => {
          if (timeView === 'daily') {
            return formatTrendDailyXAxis(value);
          }
          return value;
        },
        rich: TREND_DAILY_XAXIS_RICH,
      },
    },
    yAxis: [
      {
        type: 'value',
        name: '保费（万元）',
        position: 'left',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          ...theme.yAxisConfig.axisLabel,
          formatter: formatPremiumWan,
        },
      },
      {
        type: 'value',
        name: '比率',
        position: 'right',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          ...theme.yAxisConfig.axisLabel,
          formatter: formatRate,
        },
      },
    ],
    series,
    dataZoom: [
      { type: 'slider', start: 0, end: 100, height: 20, bottom: 40 },
      { type: 'inside' },
    ],
  };

  chart.setOption(option, true);
}

/**
 * 渲染传统折线图（旧逻辑，向后兼容）
 */
function renderLegacyLineChart(
  chart: ReturnType<typeof echarts.init>,
  data: LineChartProps['data'],
  title: string,
  timeView: TimeView,
  startDate: string | undefined,
  endDate: string | undefined,
  yAxisLabel: string,
  isDark: boolean,
): void {
  const theme = getChartTheme(isDark);
  if (data.length === 0) {
    chart.setOption({
      title: { text: title, left: 'center' },
      graphic: {
        type: 'text',
        left: 'center',
        top: 'middle',
        style: { text: '暂无数据', fontSize: 16, fill: '#999' },
      },
    });
    return;
  }

  // 判断日期跨度是否超过 183 天
  const isLongRange = (() => {
    if (!startDate || !endDate) return false;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 3600 * 24);
    return diffDays > 183;
  })();

  // Group data by org and year
  const orgYearData = new Map<string, Map<string, {
    time_periods: string[];
    premiums: number[];
    ratios: number[];
  }>>();

  data.forEach(row => {
    const org = row.org_level_3 ?? '未知机构';
    const timePeriod = row.time_period ?? '';
    const year = timePeriod.includes('-') ? timePeriod.split('-')[0] : '2025';

    if (!orgYearData.has(org)) {
      orgYearData.set(org, new Map());
    }

    const yearMap = orgYearData.get(org)!;
    if (!yearMap.has(year)) {
      yearMap.set(year, { time_periods: [], premiums: [], ratios: [] });
    }

    const orgYearInfo = yearMap.get(year)!;
    orgYearInfo.time_periods.push(timePeriod);
    orgYearInfo.premiums.push(row.premium ?? 0);
    orgYearInfo.ratios.push(row.next_month_ratio ?? 0);
  });

  const allTimePeriods = Array.from(new Set(data.map(d => d.time_period ?? '').filter(Boolean))).sort();

  const premiumSeries: SeriesOption[] = [];
  const ratioSeries: SeriesOption[] = [];

  Array.from(orgYearData.entries()).forEach(([org, yearMap], orgIndex) => {
    Array.from(yearMap.entries()).forEach(([year, orgYearInfo]) => {
      const color = getYearChartColor(year);

      const premiumByPeriod = new Map(
        orgYearInfo.time_periods.map((tp, i) => [tp, orgYearInfo.premiums[i]])
      );
      const ratioByPeriod = new Map(
        orgYearInfo.time_periods.map((tp, i) => [tp, orgYearInfo.ratios[i]])
      );

      premiumSeries.push({
        name: `${org} (${year}年)`,
        type: 'line',
        data: allTimePeriods.map(tp => premiumByPeriod.get(tp) ?? null),
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        yAxisIndex: 0,
        itemStyle: { color: color },
        lineStyle: { color: color, width: 2 },
      });

      if (orgIndex < 3) {
        ratioSeries.push({
          name: `${org} (${year}年)（次月起保占比）`,
          type: 'line',
          data: allTimePeriods.map(tp => ratioByPeriod.get(tp) ?? null),
          smooth: true,
          symbol: 'diamond',
          symbolSize: 6,
          yAxisIndex: 1,
          itemStyle: { color: color },
          lineStyle: { color: color, width: 2, type: 'dashed' },
        });
      }
    });
  });

  const option: EChartsOption = {
    title: {
      text: title,
      left: 'center',
      textStyle: {
        fontSize: 16,
        fontWeight: 'bold',
        fontFamily: '"SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", "PingFang SC", sans-serif'
      }
    },
    tooltip: {
      ...theme.tooltipConfig,
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params: any) => {
        const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
        if (!Array.isArray(safeParams) || safeParams.length === 0) return '';
        let result = `<div style="font-weight:bold">${safeParams[0].axisValue}</div>`;
        safeParams.forEach((param) => {
          const seriesName = String(param.seriesName ?? '');
          const isRatio = seriesName.includes('占比');
          const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
          const formattedVal = isRatio ? formatRate(rawValue) : formatPremiumWan(rawValue);
          result += `<div style="display:flex;align-items:center;margin-top:4px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${param.color};margin-right:5px"></span><span>${param.seriesName}: <strong>${formattedVal}</strong></span></div>`;
        });
        return result;
      },
    },
    legend: { type: 'scroll', bottom: 0, data: [...premiumSeries.map(s => s.name), ...ratioSeries.map(s => s.name)] as any },
    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true, show: false },
    xAxis: {
      type: 'category',
      data: allTimePeriods,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: {
        show: true,
        alignWithLabel: true,
        interval: (index: number, value: string) => {
          if (timeView === 'weekly') {
            if (!isLongRange || index === 0) return true;
            const [y, w] = value.split('-W').map(Number);
            const [pY, pW] = allTimePeriods[index - 1].split('-W').map(Number);
            return getWeekStartDate(y, w).getMonth() !== getWeekStartDate(pY, pW).getMonth();
          }
          return true;
        }
      },
      splitLine: { show: false },
      axisLabel: {
        ...theme.xAxisConfig.axisLabel,
        rotate: 0,
        interval: 0,
        formatter: (value: string, index: number) => {
          if (!value) return value;

          if (timeView === 'weekly') {
            const [yearStr, weekStr] = value.split('-W');
            const year = parseInt(yearStr);
            const week = parseInt(weekStr);

            // 长跨度抽稀：只显示每月第一周
            if (isLongRange && index > 0) {
              const currentWeekStart = getWeekStartDate(year, week);
              const prevValue = allTimePeriods[index - 1];
              const [pY, pW] = prevValue.split('-W').map(Number);
              const prevWeekStart = getWeekStartDate(pY, pW);
              if (currentWeekStart.getMonth() === prevWeekStart.getMonth()) {
                return '';
              }
            }

            // 只有第一个点显示年份
            if (index === 0) return value;
            return `W${weekStr}`;
          }

          if (timeView === 'monthly') {
            const parts = value.split('-');
            return parts.length >= 2 ? `${parseInt(parts[1])}月` : value;
          }

          if (timeView === 'daily') {
            return formatTrendDailyXAxis(value);
          }

          return value;
        },
        rich: TREND_DAILY_XAXIS_RICH,
      },
    },
    yAxis: [
      {
        type: 'value',
        name: yAxisLabel,
        position: 'left',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          ...theme.yAxisConfig.axisLabel,
          formatter: yAxisLabel.includes('件数')
            ? (value: number) => formatCount(value)
            : formatPremiumWan
        },
      },
      {
        type: 'value',
        name: '占比',
        position: 'right',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          ...theme.yAxisConfig.axisLabel,
          formatter: formatRate
        },
      },
    ],
    series: [...premiumSeries, ...ratioSeries],
    dataZoom: [{ type: 'slider', start: 0, end: 100, height: 20, bottom: 40 }, { type: 'inside' }],
  };

  chart.setOption(option, true);
}

/**
 * 保费趋势图组件
 *
 * V3.0: 支持双Y轴柱状+折线组合图模式
 * - 当 barChartData 有数据时：左Y柱状（上年/本年保费），右Y折线（同比增长率/计划达成率）
 * - 当 barChartData 无数据时：走传统折线图逻辑（向后兼容）
 */
export const LineChart: React.FC<LineChartProps> = ({
  title,
  data,
  loading = false,
  height = 400,
  timeView,
  startDate,
  endDate,
  yAxisLabel = '保费（万元）',
  barChartData,
  analysisYear,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }

    const chart = chartInstance.current;
    if (!chart) return;

    if (loading) {
      chart.showLoading();
      return;
    }

    chart.hideLoading();

    // V3.0: 优先走柱+折线组合图
    if (barChartData && barChartData.length > 0) {
      const year = analysisYear ?? new Date().getFullYear();
      renderBarLineCombo(chart, barChartData, title, timeView, year, isDark);
    } else if (data.length === 0) {
      chart.setOption({
        title: { text: title, left: 'center' },
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无数据', fontSize: 16, fill: '#999' },
        },
      }, true);
    } else {
      renderLegacyLineChart(chart, data, title, timeView, startDate, endDate, yAxisLabel, isDark);
    }

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [data, loading, title, timeView, startDate, endDate, yAxisLabel, barChartData, analysisYear, isDark]);

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  return (
    <div className={cn(cardStyles.standard)}>
      <div ref={chartRef} style={{ height: `${height}px`, width: '100%' }} />
    </div>
  );
};
