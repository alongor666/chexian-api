import type { EChartsOption } from 'echarts';
import { comprehensiveTheme } from '@/shared/styles';
import type { ComprehensiveRoiRow } from '../../types';

export function buildRoiOption(rows: ComprehensiveRoiRow[]): EChartsOption {
  const data = rows.slice(0, 50).map((row) => ({
    name: row.dimKey,
    value: [
      row.expenseOutputPremiumRatio ?? 0,
      row.marginRate ?? 0,
      row.signedPremium / 10000,
    ],
  }));

  return {
    grid: { left: '4%', right: '4%', top: 20, bottom: 35, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        const [outputRatio, marginRate, premiumWan] = params.value as [number, number, number];
        return `${params.name}<br/>费用产出保费比: ${outputRatio.toFixed(2)}<br/>边际贡献率: ${marginRate.toFixed(2)}%<br/>签单保费: ${premiumWan.toFixed(2)}万`;
      },
    },
    xAxis: {
      type: 'value',
      name: '费用产出保费比',
      splitLine: { lineStyle: { color: comprehensiveTheme.palette.splitLine } },
    },
    yAxis: {
      type: 'value',
      name: '边际贡献率(%)',
      splitLine: { lineStyle: { color: comprehensiveTheme.palette.splitLine } },
    },
    series: [
      {
        type: 'scatter',
        data,
        symbolSize: (value: number[]) => {
          const premiumWan = value[2];
          return Math.max(8, Math.min(34, premiumWan / 40));
        },
        itemStyle: { color: comprehensiveTheme.palette.roi, opacity: 0.82 },
      },
    ],
  };
}

