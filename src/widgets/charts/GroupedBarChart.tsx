import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '../../shared/utils/echarts';
import { colorClasses } from '../../shared/styles';
import type { EChartsParam } from '../../shared/types/echarts';
import { getChartTheme } from '../../shared/config/chartStyles';
import { useTheme } from '../../shared/theme';

interface GroupedBarChartProps {
  data: { 
    dim_key: string; 
    [key: string]: string | number; // Allow dynamic value keys
  }[];
  seriesConfigs: {
    key: string;
    name: string;
    color?: string;
  }[];
  title?: string;
  loading?: boolean;
  valueFormatter?: (value: number) => string;
  height?: string;
}

export const GroupedBarChart: React.FC<GroupedBarChartProps> = ({
  data,
  seriesConfigs,
  title,
  loading,
  valueFormatter,
  height = '350px'
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo(() => {
    const theme = getChartTheme(isDark);
    return {
      title: {
        text: title,
        left: 'left',
        textStyle: theme.chartTextStyles.title
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
          if (!Array.isArray(safeParams) || safeParams.length === 0) return '';
          const label = safeParams[0].axisValue;
          let result = `<div style="font-weight:bold;margin-bottom:4px">${label}</div>`;
          safeParams.forEach((param) => {
            const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
            const value = valueFormatter ? valueFormatter(rawValue) : rawValue;
            result += `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;min-width:120px">
              <span style="display:flex;align-items:center">
                <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${param.color};margin-right:6px"></span>
                <span style="color:#666">${param.seriesName}</span>
              </span>
              <span style="font-weight:bold;margin-left:12px">${value}</span>
            </div>`;
          });
          return result;
        },
      },
      legend: {
        data: seriesConfigs.map(s => s.name),
        bottom: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: theme.chartTextStyles.legend.color },
      },
      grid: {
        top: 60,
        left: '3%',
        right: '4%',
        bottom: 40, // Space for legend
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: data.map(d => d.dim_key),
        axisLabel: {
          rotate: 0,  // 统一水平显示
          interval: 0,
          color: theme.chartTextStyles.axisLabel.color,
          fontSize: theme.chartTextStyles.axisLabel.fontSize
        },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => (valueFormatter ? valueFormatter(value) : value),
          color: theme.chartTextStyles.axisLabel.color
        },
        splitLine: { show: false }
      },
      series: seriesConfigs.map(config => ({
        name: config.name,
        type: 'bar',
        data: data.map(d => Number(d[config.key] ?? 0)),
        itemStyle: config.color ? { color: config.color } : undefined,
        barMaxWidth: 30,
        barGap: '20%' // Gap between bars in same category
      }))
    };
  }, [data, seriesConfigs, title, valueFormatter, isDark]);

  if (loading) return <div className={`flex items-center justify-center ${colorClasses.bg.neutral} rounded`} style={{ height }}>Loading Chart...</div>;

  return (
    <div className="bg-white dark:bg-neutral-800 p-4 rounded shadow">
      <ReactEChartsCore
        echarts={echarts}
        option={option} 
        style={{ height, width: '100%' }} 
        notMerge={true}
      />
    </div>
  );
};
