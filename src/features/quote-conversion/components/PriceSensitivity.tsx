import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChartContainer } from '../../../widgets/charts/EChartContainer';
import { cardStyles, colorClasses, quoteChartColors, cn } from '../../../shared/styles';
import { useTheme } from '../../../shared/theme';
import { formatCount } from '../../../shared/utils/formatters';
import { useQuotePrice } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';

interface Props {
  filters: QuoteFilters;
}

export function PriceSensitivity({ filters }: Props) {
  const { data, isLoading } = useQuotePrice(filters);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo<EChartsCoreOption>(() => {
    const filtered = (data ?? []).filter(r => r.discount_bin >= 0.3 && r.discount_bin <= 1.0);

    const textColor = isDark ? '#a3a3a3' : '#666';
    return {
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
      legend: { data: ['报价量', '承保量', '转化率'], top: 0, textStyle: { fontSize: 11, color: textColor } },
      grid: { left: 50, right: 50, top: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: filtered.map(r => `${(r.discount_bin * 100).toFixed(0)}%`),
        axisLabel: { fontSize: 10, color: textColor },
      },
      yAxis: [
        { type: 'value', name: '数量', nameTextStyle: { color: textColor }, axisLabel: { fontSize: 10, color: textColor }, splitLine: { show: false } },
        { type: 'value', name: '转化率%', nameTextStyle: { color: textColor }, axisLabel: { fontSize: 10, color: textColor, formatter: '{value}%' }, splitLine: { show: false } },
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
          data: filtered.map(r => r.underwriting_rate),
          lineStyle: { color: quoteChartColors.conversionLine, width: 2 },
          itemStyle: { color: quoteChartColors.conversionLine },
          symbol: 'circle',
          symbolSize: 6,
        },
      ],
    };
  }, [data, isDark]);

  return (
    <div className={cardStyles.base}>
      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-4">
        价格敏感度分析
        <span className="text-xs font-normal text-neutral-500 ml-2">折扣率 vs 转化率</span>
      </h3>
      {isLoading ? (
        <div className="animate-pulse h-72 bg-neutral-100 dark:bg-neutral-800 rounded" />
      ) : data && data.length > 0 ? (
        <EChartContainer option={option} height={288} />
      ) : (
        <div className={cn('h-72 flex items-center justify-center', colorClasses.text.neutralMuted, 'text-sm')}>
          暂无价格分析数据
        </div>
      )}
    </div>
  );
}
