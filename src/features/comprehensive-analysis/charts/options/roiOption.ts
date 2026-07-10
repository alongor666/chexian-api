import type { EChartsOption } from 'echarts';
import { comprehensiveTheme } from '@/shared/styles';
import type { EChartsParam } from '@/shared/types/echarts';
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
      formatter: (params) => {
        const p = params as unknown as EChartsParam;
        const [outputRatio, marginRate, premiumWan] = p.value as [number, number, number];
        return `${p.name}<br/>费用产出保费比: ${outputRatio.toFixed(1)}<br/>边际贡献率: ${marginRate.toFixed(1)}%<br/>签单保费: ${Math.round(premiumWan)}万`;
      },
    },
    xAxis: {
      type: 'value',
      name: '费用产出保费比',
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '边际贡献率(%)',
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
        itemStyle: { color: comprehensiveTheme.palette.roi, opacity: 0.82 },
      },
    ],
  };
}

