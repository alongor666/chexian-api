import React, { useEffect, useRef } from 'react';
import type { EChartsOption, SeriesOption } from 'echarts';
import { echarts } from '../../shared/utils/echarts';
import { formatPremiumWan, formatRate } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';
import { getYearChartColor } from '../../shared/styles';
import { cardStyles, cn } from '../../shared/styles';
import type { PremiumTrendBarData } from '../../features/dashboard/hooks/useTrendData';
import { getChartTheme } from '../../shared/config/chartStyles';
import { useTheme } from '../../shared/theme';

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

    if (!data || data.length === 0) {
      chart.setOption({
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无数据', fontSize: 13, fill: '#999' },
        },
      }, true);
      return;
    }

    const theme = getChartTheme(isDark);
    const year = analysisYear ?? new Date().getFullYear();
    const currentYear = String(year);
    const prevYear = String(year - 1);

    const xLabels = data.map((d) => d.display_label);

    const series: SeriesOption[] = [
      // 上年保费柱（ghost）
      {
        name: `${prevYear}年`,
        type: 'bar',
        yAxisIndex: 0,
        barGap: '8%',
        barCategoryGap: '38%',
        data: data.map((d) => d.prev_premium),
        itemStyle: { color: getYearChartColor(prevYear), opacity: 0.55 },
      },
      // 本年保费柱（primary）
      {
        name: `${currentYear}年`,
        type: 'bar',
        yAxisIndex: 0,
        data: data.map((d) => d.current_premium),
        itemStyle: { color: getYearChartColor(currentYear) },
      },
      // 同比增长率折线（右 Y）
      {
        name: '同比增长率',
        type: 'line',
        yAxisIndex: 1,
        data: data.map((d) => d.yoy_rate),
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        itemStyle: { color: '#52c41a' },
        lineStyle: { color: '#52c41a', width: 2 },
        // 线端直接标注最新值
        endLabel: {
          show: true,
          formatter: (params: any) => {
            const v = typeof params.value === 'number' ? params.value : null;
            if (v === null) return '';
            return (v >= 0 ? '+' : '') + formatRate(v);
          },
          color: '#52c41a',
          fontSize: 10,
          fontWeight: 700,
        },
        label: {
          show: false,
        },
      },
    ];

    const option: EChartsOption = {
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
              ? (raw >= 0 ? '+' : '') + formatRate(raw)
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
      grid: { left: '2%', right: '14%', bottom: '20%', top: '6%', containLabel: true, show: false },
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
          nameTextStyle: { fontSize: 10, color: '#52c41a', padding: [0, -10, 0, 0] },
          position: 'right',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            fontSize: 10,
            color: '#52c41a',
            formatter: formatRate,
          },
        },
      ],
      series,
    };

    chart.setOption(option, true);

  }, [data, loading, analysisYear, isDark]);

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={cn(cardStyles.base, 'p-3')}>
      <div ref={chartRef} style={{ width: '100%', height: `${height}px` }} />
    </div>
  );
};
