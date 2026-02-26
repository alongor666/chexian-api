import { memo, useEffect, useMemo, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '@/shared/utils/echarts';
import { formatCount, formatWanDirect } from '@/shared/utils/formatters';
import { cardStyles, colors, textStyles, cn } from '@/shared/styles';
import type { PerformanceTrendPoint } from './hooks/usePerformanceTrend';

interface PerformanceTrendChartProps {
  title: string;
  rows: PerformanceTrendPoint[];
  metric: 'premium' | 'auto_count';
  loading: boolean;
  error: string | null;
}

export const PerformanceTrendChart = memo(function PerformanceTrendChart({
  title,
  rows,
  metric,
  loading,
  error,
}: PerformanceTrendChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  const xData = useMemo(() => rows.map((row) => row.time_period), [rows]);
  const yData = useMemo(() => rows.map((row) => (metric === 'premium' ? row.premium : row.auto_count)), [metric, rows]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;
    if (!chart) return;
    if (loading) return;

    if (xData.length === 0) {
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
          const point = params?.[0];
          if (!point) return '';
          const value = Number(point.value ?? 0);
          const display = metric === 'premium' ? `${formatWanDirect(value)}万` : formatCount(value);
          return `<div style="font-size:12px;"><div style="font-weight:600;margin-bottom:4px;">${point.axisValue}</div><div>${point.marker}${title}: <strong>${display}</strong></div></div>`;
        },
      },
      grid: { left: '4%', right: '4%', top: 24, bottom: 36, containLabel: true },
      xAxis: {
        type: 'category',
        data: xData,
        axisLabel: { fontSize: 11, rotate: xData.length > 16 ? 30 : 0 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: {
          formatter: (value: number) => (metric === 'premium' ? formatWanDirect(value) : formatCount(value)),
          fontSize: 11,
        },
        splitLine: { lineStyle: { color: colors.neutral[200] } },
      },
      series: [
        {
          name: title,
          type: 'line',
          smooth: true,
          data: yData,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { width: 2, color: metric === 'premium' ? colors.primary.DEFAULT : colors.success.DEFAULT },
          itemStyle: { color: metric === 'premium' ? colors.primary.DEFAULT : colors.success.DEFAULT },
        },
      ],
    };

    chart.setOption(option, true);
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [loading, metric, title, xData, yData]);

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
        <p className="text-danger text-sm">加载失败: {error}</p>
      ) : loading ? (
        <div className="h-[280px] flex items-center justify-center text-neutral-400">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mr-2" />
          <span>加载中...</span>
        </div>
      ) : (
        <div ref={chartRef} className="h-[280px] w-full" />
      )}
    </section>
  );
});

