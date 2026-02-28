import type { EChartsOption } from 'echarts';
import { comprehensiveTheme } from '@/shared/styles';
import type { ComprehensiveLossTrendRow } from '../../types';

export function buildLossTrendOption(rows: ComprehensiveLossTrendRow[]): EChartsOption {
  const categories = rows.map((row) => row.timePeriod);
  const claimRatioSeries = rows.map((row) => row.earnedClaimRatio ?? 0);
  const claimShareSeries = rows.map((row) => row.claimShare);

  return {
    grid: { left: '4%', right: '4%', top: 42, bottom: 30, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: { data: ['满期赔付率', '赔款贡献度'], top: 0 },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { interval: 0, rotate: categories.length > 8 ? 20 : 0 },
    },
    yAxis: [
      {
        type: 'value',
        name: '比率(%)',
        splitLine: { lineStyle: { color: comprehensiveTheme.palette.splitLine } },
      },
    ],
    series: [
      {
        name: '满期赔付率',
        type: 'line',
        smooth: true,
        data: claimRatioSeries,
        itemStyle: { color: comprehensiveTheme.palette.claim },
        lineStyle: { color: comprehensiveTheme.palette.claim },
      },
      {
        name: '赔款贡献度',
        type: 'line',
        smooth: true,
        data: claimShareSeries,
        itemStyle: { color: comprehensiveTheme.palette.premium },
        lineStyle: { color: comprehensiveTheme.palette.premium },
      },
    ],
  };
}

