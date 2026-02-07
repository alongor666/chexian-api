import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '../../shared/utils/echarts';
import type { EChartsParam } from '../../shared/types/echarts';
import {
  CHART_TEXT_STYLES,
  X_AXIS_CONFIG,
  Y_AXIS_CONFIG,
  GRID_CONFIG,
  TOOLTIP_CONFIG,
} from '../../shared/config/chartStyles';

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
  const option = useMemo(() => {
    return {
      title: {
        text: title,
        left: 'center',
        textStyle: CHART_TEXT_STYLES.title,
      },
      tooltip: {
        ...TOOLTIP_CONFIG,
        formatter: (params: any) => {
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
        ...X_AXIS_CONFIG,
      },
      yAxis: {
        type: 'value',
        ...Y_AXIS_CONFIG,
        axisLabel: {
          ...Y_AXIS_CONFIG.axisLabel,
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
            ...CHART_TEXT_STYLES.label,
          },
        }
      ],
      grid: GRID_CONFIG,
    };
  }, [data, title, valueFormatter]);

  const onEvents = useMemo(() => ({
    click: (params: any) => {
      const safeParams = params as EChartsParam;
      if (onBarClick && safeParams.name) {
        onBarClick(String(safeParams.name));
      }
    }
  }), [onBarClick]);

  if (loading) return <div className="h-64 flex items-center justify-center bg-gray-50">Loading Chart...</div>;

  return (
    <div className="bg-white p-4 rounded shadow h-full">
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
