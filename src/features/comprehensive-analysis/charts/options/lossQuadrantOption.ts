import type { EChartsOption } from 'echarts';
import { comprehensiveTheme } from '@/shared/styles';
import type { EChartsParam } from '@/shared/types/echarts';
import type { ComprehensiveMetricRow } from '../../types';

export function buildLossQuadrantOption(
  rows: ComprehensiveMetricRow[],
  lossWarnThreshold: number
): EChartsOption {
  const data = rows.slice(0, 50).map((row) => ({
    name: row.dimKey,
    value: [row.premiumShare, row.claimShare, row.earnedClaimRatio ?? 0, row.signedPremium / 10000],
    itemStyle: {
      color:
        row.earnedClaimRatio !== null && row.earnedClaimRatio > lossWarnThreshold
          ? comprehensiveTheme.palette.danger
          : comprehensiveTheme.palette.claim,
    },
  }));

  return {
    grid: { left: '4%', right: '4%', top: 20, bottom: 35, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const p = params as unknown as EChartsParam;
        const [premiumShare, claimShare, claimRatio, premiumWan] = p.value as [number, number, number, number];
        return `${p.name}<br/>保费贡献度: ${premiumShare.toFixed(1)}%<br/>赔款贡献度: ${claimShare.toFixed(1)}%<br/>满期赔付率: ${claimRatio.toFixed(1)}%<br/>签单保费: ${Math.round(premiumWan)}万`;
      },
    },
    xAxis: {
      type: 'value',
      name: '保费贡献度(%)',
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '赔款贡献度(%)',
      splitLine: { show: false },
    },
    series: [
      {
        type: 'scatter',
        data,
        symbolSize: (value: number[]) => {
          const premiumWan = value[3];
          return Math.max(8, Math.min(34, premiumWan / 40));
        },
      },
    ],
  };
}

