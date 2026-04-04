import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { getChartTheme } from '../../shared/config/chartStyles';
import { useTheme } from '../../shared/theme';
import { colorClasses } from '../../shared/styles';
import { echarts } from '../../shared/utils/echarts';
import { formatPremiumWan } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';

interface OrgPremiumPieChartProps {
  data: { name: string; value: number }[];
  loading?: boolean;
  showContainer?: boolean;
  height?: number;
  valueFormatter?: (value: number) => string;
  centerLabel?: string;
  seriesLabel?: string;
}

export const OrgPremiumPieChart: React.FC<OrgPremiumPieChartProps> = ({
  data,
  loading = false,
  showContainer = true,
  height = 360,
  valueFormatter = formatPremiumWan,
  centerLabel = '总保费',
  seriesLabel = '三级机构保费占比',
}) => {
  const totalPremium = useMemo(() => {
    return data.reduce((sum, item) => sum + item.value, 0);
  }, [data]);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo(() => {
    const theme = getChartTheme(isDark);
    if (!data || data.length === 0) {
      return {
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text: '暂无数据',
            fontSize: 16,
            fill: '#999',
          },
        },
      };
    }

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: EChartsParam) => {
          const rawValue = typeof params.value === 'number' ? params.value : Number(params.value ?? 0);
          return `${params.name}: ${valueFormatter(rawValue)}`;
        },
      },
      legend: {
        bottom: 0,
        type: 'scroll',
        textStyle: theme.chartTextStyles.staticLabel,
      },
      graphic: {
        type: 'text',
        left: 'center',
        top: 'middle',
        style: {
          text: `${centerLabel}\n${valueFormatter(totalPremium)}`,
          textAlign: 'center',
          fill: '#333',
          fontSize: 14,
          fontWeight: 'bold',
        },
      },
      series: [
        {
          name: seriesLabel,
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          label: {
            show: true,
            formatter: (params: EChartsParam) => {
              const rawValue = typeof params.value === 'number' ? params.value : Number(params.value ?? 0);
              return `${params.name}\n${valueFormatter(rawValue)}`;
            },
            ...theme.chartTextStyles.dynamicLabel,
          },
          data,
        },
      ],
    };
  }, [centerLabel, data, seriesLabel, totalPremium, valueFormatter, isDark]);

  if (loading) {
    return (
      <div className={`${showContainer ? 'bg-white dark:bg-neutral-800 p-4 rounded shadow' : ''} h-64 flex items-center justify-center ${colorClasses.bg.neutral}`}>
        Loading Chart...
      </div>
    );
  }

  const chart = (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      notMerge={true}
    />
  );

  if (!showContainer) {
    return chart;
  }

  return <div className="bg-white dark:bg-neutral-800 p-4 rounded shadow h-full">{chart}</div>;
};
