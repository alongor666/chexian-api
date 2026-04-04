import type { EChartsOption } from 'echarts';
import { comprehensiveTheme } from '@/shared/styles';
import type { ComprehensiveMetricRow } from '../../types';

export function buildPremiumOption(rows: ComprehensiveMetricRow[]): EChartsOption {
  const displayRows = rows.slice(0, 15);
  const categories = displayRows.map((row) => row.dimKey);
  const premiumData = displayRows.map((row) => Number((row.signedPremium / 10000).toFixed(2)));
  const achievementData = displayRows.map((row) => row.achievementRate ?? 0);

  return {
    grid: { left: '4%', right: '4%', top: 42, bottom: 30, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: { data: ['签单保费(万)', '年计划达成率'], top: 0 },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { interval: 0, rotate: 0 },
    },
    yAxis: [
      {
        type: 'value',
        name: '签单保费(万)',
        axisLine: { lineStyle: { color: comprehensiveTheme.palette.premium } },
        splitLine: { show: false },
      },
      {
        type: 'value',
        name: '达成率(%)',
        axisLine: { lineStyle: { color: comprehensiveTheme.palette.success } },
        min: 0,
      },
    ],
    series: [
      {
        name: '签单保费(万)',
        type: 'bar',
        data: premiumData,
        itemStyle: { color: comprehensiveTheme.palette.premium },
      },
      {
        name: '年计划达成率',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: achievementData,
        itemStyle: { color: comprehensiveTheme.palette.success },
        lineStyle: { color: comprehensiveTheme.palette.success },
      },
    ],
  };
}

