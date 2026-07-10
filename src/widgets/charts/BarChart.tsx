import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '../../shared/utils/echarts';
import { colorClasses } from '../../shared/styles';
import type { EChartsParam } from '../../shared/types/echarts';
import {
  GRID_CONFIG,
  getChartTheme,
} from '../../shared/config/chartStyles';
import { useTheme } from '../../shared/theme';

interface BarChartProps {
  data: { dim_key: string; value: number }[];
  title?: string;
  onBarClick?: (key: string) => void;
  loading?: boolean;
  valueFormatter?: (value: number) => string;
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  title,
  onBarClick,
  loading,
  valueFormatter,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo(() => {
    const theme = getChartTheme(isDark);
    return {
      title: {
        text: title,
        left: 'center',
        textStyle: theme.chartTextStyles.title,
      },
      tooltip: {
        ...theme.tooltipConfig,
        formatter: (params: EChartsParam | EChartsParam[]) => {
          const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
          if (!Array.isArray(safeParams) || safeParams.length === 0) return '';
          const label = safeParams[0].axisValue;
          let result = `<div style="font-weight:bold;font-size:12px">${label}</div>`;
          safeParams.forEach((param) => {
            const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
            const value = valueFormatter ? valueFormatter(rawValue) : rawValue;
            result += `<div style="display:flex;align-items:center;margin-top:4px;font-size:12px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${param.color};margin-right:5px"></span>
              <span>${param.seriesName || '数值'}: <strong>${value}</strong></span>
            </div>`;
          });
          return result;
        },
      },
      xAxis: {
        type: 'category',
        data: data.map(d => d.dim_key),
        ...theme.xAxisConfig,
      },
      yAxis: {
        type: 'value',
        ...theme.yAxisConfig,
        axisLabel: {
          ...theme.yAxisConfig.axisLabel,
          formatter: (value: number) => (valueFormatter ? valueFormatter(value) : value),
        },
      },
      series: [
        {
          data: data.map(d => d.value),
          type: 'bar',
          itemStyle: { color: '#5470C6' },
          label: {
            show: false,
            ...theme.chartTextStyles.label,
          },
        }
      ],
      grid: GRID_CONFIG,
    };
  }, [data, title, valueFormatter, isDark]);

  const onEvents = useMemo(() => ({
    click: (params: EChartsParam) => {
      const safeParams = params;
      if (onBarClick && safeParams.name) {
        onBarClick(String(safeParams.name));
      }
    }
  }), [onBarClick]);

  if (loading) return <div className={`h-64 flex items-center justify-center ${colorClasses.bg.neutral}`}>Loading Chart...</div>;

  return (
    <div className="bg-white dark:bg-neutral-800 p-4 rounded shadow h-full">
      <ReactEChartsCore
        echarts={echarts}
        option={option} 
        style={{ height: '300px', width: '100%' }} 
        onEvents={onEvents}
        notMerge={true}
      />
    </div>
  );
};
