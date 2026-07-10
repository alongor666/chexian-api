import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '../../shared/utils/echarts';
import { GRID_CONFIG, AXIS_SPLIT_LINE, getChartTheme } from '../../shared/config/chartStyles';
import { useTheme } from '../../shared/theme';
import { colorClasses } from '../../shared/styles';
import type { EChartsParam } from '../../shared/types/echarts';

interface WaterfallDataPoint {
  label: string;
  value: number; // The incremental value (positive or negative)
}

interface WaterfallChartProps {
  data: WaterfallDataPoint[];
  title?: string;
  loading?: boolean;
  valueFormatter?: (value: number) => string;
  height?: number;
}

export const WaterfallChart: React.FC<WaterfallChartProps> = ({
  data,
  title,
  loading,
  valueFormatter = (val) => val.toString(),
  height = 400,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo(() => {
    const theme = getChartTheme(isDark);
    // 1. Process Data for Waterfall
    // We need to calculate the "invisible" base for each bar
    // Positive value: base is the sum of previous values
    // Negative value: base is the sum of previous values MINUS the absolute value of current (so it "hangs" down)
    
    // Sort data by absolute value descending for better visualization? 
    // Usually Waterfall is time-based OR category-based. 
    // For contribution, we usually show: Total Start -> Factor A -> Factor B -> ... -> Total End.
    // Here we strictly show contribution of each item to the total growth.
    // So the "Total" is the sum of all parts.
    
    let currentSum = 0;
    const placeholders: number[] = [];
    const values: number[] = [];
    const labels: string[] = [];
    const colors: string[] = [];

    // Optional: Limit to top contributors if too many?
    // For now, assume data is already prepared/filtered by parent.

    data.forEach((item) => {
      labels.push(item.label);
      values.push(item.value);

      if (item.value >= 0) {
        placeholders.push(currentSum);
        currentSum += item.value;
        colors.push('#91CC75'); // Green for positive
      } else {
        currentSum += item.value; // Decrease sum
        placeholders.push(currentSum);
        colors.push('#EE6666'); // Red for negative
      }
    });

    // Add a "Total" column at the end?
    // labels.push('总计');
    // placeholders.push(0);
    // values.push(currentSum); // currentSum is now the final total
    // colors.push('#5470C6'); // Blue for total

    return {
      title: title ? {
        text: title,
        left: 'center',
        textStyle: theme.chartTextStyles.title,
      } : undefined,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: EChartsParam[]) => {
            const param = params.find((p: EChartsParam) => p.seriesName === '变动');
            if (!param) return '';
            const val = param.value as number;
            const fmtVal = valueFormatter(val);
            return `${param.name}<br/>变动: <span style="color:${val >= 0 ? '#91CC75' : '#EE6666'}">${val > 0 ? '+' : ''}${fmtVal}</span>`;
        }
      },
      grid: GRID_CONFIG,
      xAxis: {
        type: 'category',
        data: labels,
        splitLine: AXIS_SPLIT_LINE,
        axisLabel: {
            ...theme.chartTextStyles.axisLabel,
            interval: 0,
            rotate: 0,  // 统一水平显示
            formatter: (value: string) => {
                // Truncate long labels
                return value.length > 8 ? value.substring(0, 6) + '...' : value;
            }
        },
        axisLine: {
            lineStyle: { color: '#E5E7EB' }
        }
      },
      yAxis: {
        type: 'value',
        splitLine: { show: false },
        axisLabel: {
            ...theme.chartTextStyles.axisLabel,
            formatter: (value: number) => valueFormatter(value),
        }
      },
      series: [
        {
          name: '辅助',
          type: 'bar',
          stack: '总量',
          itemStyle: {
            barBorderColor: 'rgba(0,0,0,0)',
            color: 'rgba(0,0,0,0)'
          },
          emphasis: {
            itemStyle: {
              barBorderColor: 'rgba(0,0,0,0)',
              color: 'rgba(0,0,0,0)'
            }
          },
          data: placeholders
        },
        {
          name: '变动',
          type: 'bar',
          stack: '总量',
          label: {
            show: true,
            position: 'top',
            formatter: (params: EChartsParam) => {
                const val = params.value as number;
                return val > 0 ? `+${valueFormatter(val)}` : valueFormatter(val);
            },
            ...theme.chartTextStyles.dynamicLabel
          },
          data: values.map((val, idx) => ({
             value: val,
             itemStyle: { color: colors[idx] }
          }))
        }
      ]
    };
  }, [data, title, valueFormatter, isDark]);

  if (loading) return <div className={`h-full flex items-center justify-center ${colorClasses.text.neutralMuted}`}>Loading...</div>;

  return (
    <div className="bg-white dark:bg-neutral-800 p-4 rounded shadow h-full">
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: `${height}px`, width: '100%' }}
        notMerge={true}
      />
    </div>
  );
};
