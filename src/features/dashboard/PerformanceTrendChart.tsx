import { memo, useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { SVGRenderer } from 'echarts/renderers';
import { echarts } from '@/shared/utils/echarts';
import { EChartContainer, buildEmptyChartOption } from '../../widgets/charts/EChartContainer';

// 本组件用 SVG 渲染器（renderer: 'svg'）。SVGRenderer 已从共享 echarts 注册中移除，
// 故在此按需注册（echarts.use 幂等，重复调用安全）。
echarts.use([SVGRenderer]);
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

  const xData = useMemo(() => {
    const set = new Set<string>();
    series.forEach((line) => line.points.forEach((point) => set.add(point.time_period)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [series]);

  const formatValue = useMemo(
    () => (value: number) =>
      metric === 'premium' ? formatWanAdaptive(value) : formatCount(value),
    [metric],
  );

  const lineSeries = useMemo(() => {
    return series.map((line, index) => {
      const color = getLineColor(line.line_key, line.line_label);
      const valueMap = new Map(line.points.map((point) => [
        point.time_period,
        metric === 'premium' ? point.premium : point.auto_count,
      ]));
      const data = xData.map((x) => valueMap.get(x) ?? null);
      const isPrimary = index === 0;
      let peakCoord: [string, number] | null = null;
      if (isPrimary) {
        let peakIdx = -1;
        let peakValue = -Infinity;
        data.forEach((v, i) => {
          if (v !== null && v > peakValue) {
            peakValue = v;
            peakIdx = i;
          }
        });
        if (peakIdx >= 0) {
          peakCoord = [xData[peakIdx], peakValue];
        }
      }
      return {
        name: line.line_label,
        type: 'line' as const,
        smooth: true,
        data,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: isPrimary ? 2.5 : 2, color },
        itemStyle: { color },
        connectNulls: true,
        endLabel: isPrimary
          ? {
              show: true,
              color,
              fontSize: 11,
              fontWeight: 600,
              formatter: (params: { value?: unknown }) => {
                const v = params?.value;
                if (v == null || v === '' || Number.isNaN(Number(v))) return '';
                return formatValue(Number(v));
              },
            }
          : undefined,
        markPoint: peakCoord
          ? {
              symbol: 'circle',
              symbolSize: 6,
              data: [{ name: '峰值', coord: peakCoord }],
              itemStyle: { color },
              label: {
                show: true,
                formatter: '峰值',
                position: 'top' as const,
                color,
                fontSize: 10,
              },
            }
          : undefined,
      };
    });
  }, [formatValue, metric, series, xData]);

  const option = useMemo<EChartsOption>(() => {
    if (xData.length === 0 || lineSeries.length === 0) {
      return buildEmptyChartOption('暂无走势数据') as EChartsOption;
    }

    return {
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
      grid: { left: '4%', right: 56, top: 52, bottom: 36, containLabel: true },
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
  }, [lineSeries, metric, xData, isDark]);

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
        <EChartContainer option={option} renderer="svg" height={320} />
      )}
    </section>
  );
});

export default PerformanceTrendChart;
