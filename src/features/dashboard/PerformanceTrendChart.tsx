import { memo, useEffect, useMemo, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '@/shared/utils/echarts';
import { formatCount, formatWanAdaptive, formatTrendDailyXAxis, TREND_DAILY_XAXIS_RICH } from '@/shared/utils/formatters';
import { cardStyles, colors, textStyles, colorClasses, cn } from '@/shared/styles';
import { useTheme } from '@/shared/theme';
import { TONNAGE_COLORS } from '@/shared/config/chartStyles';
import type { PerformanceTrendSeries } from './hooks/usePerformanceTrend';

interface PerformanceTrendChartProps {
  title: string;
  series: PerformanceTrendSeries[];
  metric: 'premium' | 'auto_count';
  loading: boolean;
  error: string | null;
}

function getLineColor(lineKey: string, lineLabel: string): string {
  if (TONNAGE_COLORS[lineLabel]) {
    return TONNAGE_COLORS[lineLabel];
  }

  const preset: Record<string, string> = {
    overall: colors.primary.DEFAULT,
    non_business_passenger: colors.success.DEFAULT,
    business_passenger: colors.warning.DEFAULT,
    business_truck: colors.danger.DEFAULT,
    non_business_truck: '#13c2c2',
    motorcycle: '#722ed1',
    non_business_personal: colors.success.DEFAULT,
    non_business_enterprise: colors.warning.DEFAULT,
    non_business_agency: colors.danger.DEFAULT,
  };
  return preset[lineKey] || colors.neutral[500];
}

export const PerformanceTrendChart = memo(function PerformanceTrendChart({
  title,
  series,
  metric,
  loading,
  error,
}: PerformanceTrendChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  const xData = useMemo(() => {
    const set = new Set<string>();
    series.forEach((line) => line.points.forEach((point) => set.add(point.time_period)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [series]);

  const lineSeries = useMemo(() => {
    return series.map((line) => {
      const color = getLineColor(line.line_key, line.line_label);
      const valueMap = new Map(line.points.map((point) => [
        point.time_period,
        metric === 'premium' ? point.premium : point.auto_count,
      ]));
      return {
        name: line.line_label,
        type: 'line' as const,
        smooth: true,
        data: xData.map((x) => valueMap.get(x) ?? null),
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        connectNulls: true,
      };
    });
  }, [metric, series, xData]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;
    if (!chart) return;
    if (loading) return;

    if (xData.length === 0 || lineSeries.length === 0) {
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
          const list = Array.isArray(params) ? params : [params];
          const first = list[0];
          if (!first) return '';
          const rows = list.map((item: any) => {
            const value = Number(item?.value ?? 0);
            const display = metric === 'premium' ? formatWanAdaptive(value) : formatCount(value);
            return `<div>${item.marker}${item.seriesName}: <strong>${display}</strong></div>`;
          }).join('');
          return `<div style="font-size:12px;"><div style="font-weight:600;margin-bottom:4px;">${first.axisValue}</div>${rows}</div>`;
        },
      },
      legend: {
        top: 0,
        type: 'scroll',
        textStyle: { color: isDark ? '#a3a3a3' : '#595959' },
      },
      grid: { left: '4%', right: '4%', top: 52, bottom: 36, containLabel: true },
      xAxis: {
        type: 'category',
        data: xData,
        axisLabel: {
          fontSize: 11,
          rotate: 0,
          formatter: formatTrendDailyXAxis,
          rich: TREND_DAILY_XAXIS_RICH,
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: {
          formatter: (value: number) => (metric === 'premium' ? formatWanAdaptive(value) : formatCount(value)),
          fontSize: 11,
        },
        splitLine: { show: false },
      },
      series: lineSeries,
    };

    chart.setOption(option, true);
    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    if (chartRef.current) {
      resizeObserver.observe(chartRef.current);
    }
    return () => {
      resizeObserver.disconnect();
    };
  }, [lineSeries, loading, metric, title, xData, isDark]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  return (
    <section className={cn(cardStyles.standard, 'space-y-3')}>
      <h3 className={textStyles.titleSmall}>{title}</h3>
      {error ? (
        <p className={cn(textStyles.body, colorClasses.text.danger)}>加载失败: {error}</p>
      ) : loading ? (
        <div className="h-[320px] flex items-center justify-center text-neutral-400">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mr-2" />
          <span>加载中...</span>
        </div>
      ) : (
        <div ref={chartRef} className="h-[320px] w-full" />
      )}
    </section>
  );
});

export default PerformanceTrendChart;
