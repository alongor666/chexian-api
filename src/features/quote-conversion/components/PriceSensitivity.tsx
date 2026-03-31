import { useRef, useEffect } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { cardStyles, colorClasses, quoteChartColors, cn } from '../../../shared/styles';
import { formatCount } from '../../../shared/utils/formatters';
import { useQuotePrice } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

interface Props {
  filters: QuoteFilters;
}

export function PriceSensitivity({ filters }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuotePrice(filters);

  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0) return;

    const chart = echarts.init(chartRef.current);
    const filtered = data.filter(r => r.discount_bin >= 0.3 && r.discount_bin <= 1.0);

    const option: echarts.EChartsCoreOption = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: unknown) => {
          const arr = params as Array<{ name: string; seriesName: string; value: number; marker: string }>;
          const bin = arr[0]?.name ?? '';
          let html = `<div class="text-xs"><b>折扣率 ${bin}</b>`;
          for (const p of arr) {
            const formatted = p.seriesName === '转化率' ? `${p.value}%` : formatCount(p.value);
            html += `<br/>${p.marker} ${p.seriesName}: ${formatted}`;
          }
          return html + '</div>';
        },
      },
      legend: { data: ['报价量', '承保量', '转化率'], top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 50, right: 50, top: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: filtered.map(r => `${(r.discount_bin * 100).toFixed(0)}%`),
        axisLabel: { fontSize: 10 },
      },
      yAxis: [
        { type: 'value', name: '数量', axisLabel: { fontSize: 10 } },
        { type: 'value', name: '转化率%', axisLabel: { fontSize: 10, formatter: '{value}%' } },
      ],
      series: [
        {
          name: '报价量',
          type: 'bar',
          data: filtered.map(r => r.total_quotes),
          itemStyle: { color: quoteChartColors.quoteBar },
          barWidth: '40%',
        },
        {
          name: '承保量',
          type: 'bar',
          data: filtered.map(r => r.total_insured),
          itemStyle: { color: quoteChartColors.insuredBar },
          barWidth: '40%',
        },
        {
          name: '转化率',
          type: 'line',
          yAxisIndex: 1,
          data: filtered.map(r => r.conversion_rate),
          lineStyle: { color: quoteChartColors.conversionLine, width: 2 },
          itemStyle: { color: quoteChartColors.conversionLine },
          symbol: 'circle',
          symbolSize: 6,
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

  return (
    <div className={cardStyles.base}>
      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-4">
        价格敏感度分析
        <span className="text-xs font-normal text-neutral-500 ml-2">折扣率 vs 转化率</span>
      </h3>
      {isLoading ? (
        <div className="animate-pulse h-72 bg-neutral-100 dark:bg-neutral-800 rounded" />
      ) : data && data.length > 0 ? (
        <div ref={chartRef} className="h-72" />
      ) : (
        <div className={cn('h-72 flex items-center justify-center', colorClasses.text.neutralMuted, 'text-sm')}>
          暂无价格分析数据
        </div>
      )}
    </div>
  );
}
