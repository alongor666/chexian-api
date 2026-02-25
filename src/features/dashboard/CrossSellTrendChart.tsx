/**
 * 驾乘险推介率走势图
 * Cross-Sell Recommendation Rate Trend Chart
 *
 * 4 条折线（整体/主全/交三/单交），支持日/周/月/季粒度切换
 * 时间基准：自然签单日期
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '../../shared/utils/echarts';
import { formatPercent } from '../../shared/utils/formatters';
import { cardStyles, textStyles, colors, cn } from '../../shared/styles';
import { useCrossSellTrend, type TrendGranularity } from './hooks/useCrossSellTrend';
import type { AdvancedFilterState } from '../../shared/types/data';
import type { VehicleCategory } from './hooks/useCrossSellTimePeriod';

interface CrossSellTrendChartProps {
  vehicleCategory: VehicleCategory;
  filters: AdvancedFilterState;
}

const GRANULARITY_TABS: Array<{ key: TrendGranularity; label: string }> = [
  { key: 'daily', label: '日' },
  { key: 'weekly', label: '周' },
  { key: 'monthly', label: '月' },
  { key: 'quarterly', label: '季度' },
];

/** 与统一设计系统颜色令牌对齐 */
const SERIES_CONFIG: Record<string, { color: string }> = {
  '整体': { color: colors.neutral[500] },
  '主全': { color: colors.primary.DEFAULT },
  '交三': { color: colors.success.DEFAULT },
  '单交': { color: colors.warning.DEFAULT },
};

const SERIES_ORDER = ['整体', '主全', '交三', '单交'];

export const CrossSellTrendChart = memo(function CrossSellTrendChart({
  vehicleCategory,
  filters,
}: CrossSellTrendChartProps) {
  const [granularity, setGranularity] = useState<TrendGranularity>('monthly');
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  const { rows, loading, error } = useCrossSellTrend({
    filters,
    vehicleCategory,
    granularity,
  });

  // 将平铺的行转换为按时间轴 + 4 条 series 的结构
  const { timePeriods, seriesData } = useMemo(() => {
    const periodsSet = new Set<string>();
    const byCombination: Record<string, Record<string, number>> = {};

    for (const row of rows) {
      periodsSet.add(row.time_period);
      if (!byCombination[row.coverage_combination]) {
        byCombination[row.coverage_combination] = {};
      }
      byCombination[row.coverage_combination][row.time_period] = row.rate;
    }

    const timePeriods = Array.from(periodsSet).sort();
    const seriesData: Record<string, (number | null)[]> = {};

    for (const comb of SERIES_ORDER) {
      const combData = byCombination[comb] || {};
      seriesData[comb] = timePeriods.map((tp) => combData[tp] ?? null);
    }

    return { timePeriods, seriesData };
  }, [rows]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;

    if (loading) return;

    if (timePeriods.length === 0) {
      // clear() removes all prior axis/series state before setting graphic-only option
      // (prevents "coordinateSystem undefined" ECharts crash when xAxis has no series)
      chart.clear();
      chart.setOption({
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无走势数据', fill: colors.neutral[400], fontSize: 14 },
        },
      });
      return;
    }

    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const lines = (params as any[]).map((p) =>
            `<div>${p.marker}${p.seriesName}: <strong>${formatPercent(p.value ?? 0)}</strong></div>`
          );
          return `<div style="font-size:12px"><div style="font-weight:600;margin-bottom:4px">${(params as any[])[0]?.axisValue}</div>${lines.join('')}</div>`;
        },
      },
      legend: {
        top: 0,
        data: SERIES_ORDER,
        textStyle: { fontSize: 12 },
      },
      grid: { left: '4%', right: '4%', top: 44, bottom: 36, containLabel: true },
      xAxis: {
        type: 'category',
        data: timePeriods,
        axisLabel: { fontSize: 11, rotate: timePeriods.length > 18 ? 30 : 0 },
        axisTick: { alignWithLabel: true },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { formatter: '{value}%', fontSize: 11 },
        splitLine: { lineStyle: { color: colors.neutral[200] } },
      },
      series: SERIES_ORDER.map((name) => ({
        name,
        type: 'line' as const,
        smooth: true,
        data: seriesData[name],
        lineStyle: { color: SERIES_CONFIG[name].color, width: 2 },
        itemStyle: { color: SERIES_CONFIG[name].color },
        symbol: 'circle',
        symbolSize: 4,
        connectNulls: true,
      })),
    };

    chart.setOption(option, true);
    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [timePeriods, seriesData, loading]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  return (
    <section className={cn(cardStyles.standard, 'space-y-3')}>
      <div className="flex items-center justify-between">
        <h3 className={textStyles.titleSmall}>驾乘险推介率走势</h3>
        <div className="flex gap-1">
          {GRANULARITY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setGranularity(tab.key)}
              className={cn(
                'px-3 py-1 text-xs rounded transition-colors',
                granularity === tab.key
                  ? 'bg-primary text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className={cn(textStyles.caption, 'text-danger')}>加载失败: {error}</p>
      ) : loading ? (
        <div className="flex items-center justify-center h-[280px] text-neutral-400">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mr-2" />
          <span>加载中...</span>
        </div>
      ) : (
        <div ref={chartRef} className="h-[280px] w-full" />
      )}
    </section>
  );
});

export default CrossSellTrendChart;
