import { useRef, useEffect, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { cardStyles, colorClasses, quoteChartColors, toggleButtonStyles, cn } from '../../../shared/styles';
import { useQuoteTrend } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

interface Props {
  filters: QuoteFilters;
}

export function TimeTrend({ filters }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('week');
  const { data, isLoading } = useQuoteTrend(filters, granularity);

  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0) return;

    const chart = echarts.init(chartRef.current);

    // 按时间桶聚合（续保+转保分别一条线）
    const timeBuckets = [...new Set(data.map(r => r.time_bucket ?? ''))].sort();
    const renewalData = timeBuckets.map(t => {
      const row = data.find(r => r.time_bucket === t && r.renewal_type === '续保');
      return row?.conversion_rate ?? 0;
    });
    const switchData = timeBuckets.map(t => {
      const row = data.find(r => r.time_bucket === t && r.renewal_type === '转保');
      return row?.conversion_rate ?? 0;
    });
    const totalQuotes = timeBuckets.map(t => {
      return data.filter(r => r.time_bucket === t).reduce((sum, r) => sum + (r.total_quotes ?? 0), 0);
    });

    const option: echarts.EChartsCoreOption = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { data: ['报价量', '续保转化率', '转保转化率'], top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 50, right: 50, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: timeBuckets, axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: 'value', name: '报价量', axisLabel: { fontSize: 10 } },
        { type: 'value', name: '转化率%', axisLabel: { fontSize: 10, formatter: '{value}%' } },
      ],
      series: [
        {
          name: '报价量',
          type: 'bar',
          data: totalQuotes,
          itemStyle: { color: quoteChartColors.quoteBarLight },
          barWidth: '60%',
        },
        {
          name: '续保转化率',
          type: 'line',
          yAxisIndex: 1,
          data: renewalData,
          lineStyle: { color: quoteChartColors.renewalLine, width: 2 },
          itemStyle: { color: quoteChartColors.renewalLine },
          symbol: 'circle',
          symbolSize: 5,
        },
        {
          name: '转保转化率',
          type: 'line',
          yAxisIndex: 1,
          data: switchData,
          lineStyle: { color: quoteChartColors.switchLine, width: 2 },
          itemStyle: { color: quoteChartColors.switchLine },
          symbol: 'circle',
          symbolSize: 5,
        },
      ],
    };

    chart.setOption(option);
    const resizeOb = new ResizeObserver(() => chart.resize());
    resizeOb.observe(chartRef.current);

    return () => {
      resizeOb.disconnect();
      chart.dispose();
    };
  }, [data]);

  const granOptions = [
    { key: 'day' as const, label: '日' },
    { key: 'week' as const, label: '周' },
    { key: 'month' as const, label: '月' },
  ];

  return (
    <div className={cardStyles.base}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">时间趋势</h3>
        <div className="flex gap-1">
          {granOptions.map(g => (
            <button
              key={g.key}
              onClick={() => setGranularity(g.key)}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                granularity === g.key ? toggleButtonStyles.active : toggleButtonStyles.inactive
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <div className="animate-pulse h-72 bg-neutral-100 dark:bg-neutral-800 rounded" />
      ) : data && data.length > 0 ? (
        <div ref={chartRef} className="h-72" />
      ) : (
        <div className={cn('h-72 flex items-center justify-center', colorClasses.text.neutralMuted, 'text-sm')}>
          暂无趋势数据
        </div>
      )}
    </div>
  );
}
