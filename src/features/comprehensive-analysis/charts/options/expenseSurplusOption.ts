import type { EChartsOption } from 'echarts';
import { comprehensiveTheme } from '@/shared/styles';
import type { ComprehensiveExpenseSurplusRow } from '../../types';

export function buildExpenseSurplusOption(rows: ComprehensiveExpenseSurplusRow[]): EChartsOption {
  const displayRows = rows.slice(0, 15);
  const categories = displayRows.map((row) => row.dimKey);
  const surplusData = displayRows.map((row) =>
    row.expenseSurplusAmount === null ? 0 : Number((row.expenseSurplusAmount / 10000).toFixed(2))
  );
  const deviationData = displayRows.map((row) => row.expenseRateDeviation ?? 0);

  return {
    grid: { left: '4%', right: '4%', top: 42, bottom: 30, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: { data: ['费用结余额(万)', '费用率超支(百分点)'], top: 0 },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { interval: 0, rotate: 0 },
    },
    yAxis: [
      {
        type: 'value',
        name: '费用结余额(万)',
        splitLine: { show: false },
      },
      {
        type: 'value',
        name: '费用率超支(百分点)',
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '费用结余额(万)',
        type: 'bar',
        data: surplusData,
        itemStyle: { color: comprehensiveTheme.palette.expense },
      },
      {
        name: '费用率超支(百分点)',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: deviationData,
        itemStyle: { color: comprehensiveTheme.palette.danger },
        lineStyle: { color: comprehensiveTheme.palette.danger },
      },
    ],
  };
}

