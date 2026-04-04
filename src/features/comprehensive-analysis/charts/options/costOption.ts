import type { EChartsOption } from 'echarts';
import { comprehensiveTheme } from '@/shared/styles';
import type { ComprehensiveMetricRow } from '../../types';

export function buildCostOption(rows: ComprehensiveMetricRow[]): EChartsOption {
  const data = rows.slice(0, 50).map((row) => ({
    name: row.dimKey,
    value: [row.premiumShare, row.variableCostRatio ?? 0, row.signedPremium / 10000],
  }));

  return {
    grid: { left: '4%', right: '4%', top: 20, bottom: 35, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        const [premiumShare, costRatio, premiumWan] = params.value as [number, number, number];
        return `${params.name}<br/>保费贡献度: ${premiumShare.toFixed(1)}%<br/>变动成本率: ${costRatio.toFixed(1)}%<br/>签单保费: ${Math.round(premiumWan)}万`;
      },
    },
    xAxis: {
      type: 'value',
      name: '保费贡献度(%)',
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '变动成本率(%)',
      splitLine: { show: false },
    },
    series: [
      {
        type: 'scatter',
        data,
        symbolSize: (value: number[]) => {
          const premiumWan = value[2];
          return Math.max(8, Math.min(34, premiumWan / 40));
        },
        itemStyle: {
          color: comprehensiveTheme.palette.cost,
          opacity: 0.8,
        },
      },
    ],
  };
}

