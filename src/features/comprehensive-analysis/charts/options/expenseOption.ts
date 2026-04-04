import type { EChartsOption } from 'echarts';
import { comprehensiveTheme } from '@/shared/styles';
import type { ComprehensiveMetricRow } from '../../types';

export function buildExpenseOption(
  rows: ComprehensiveMetricRow[],
  expenseBudget: number
): EChartsOption {
  const displayRows = rows.slice(0, 15);
  const categories = displayRows.map((row) => row.dimKey);
  const expenseData = displayRows.map((row) => Number((row.feeAmount / 10000).toFixed(2)));
  const expenseRatioData = displayRows.map((row) => row.expenseRatio ?? 0);

  return {
    grid: { left: '4%', right: '4%', top: 42, bottom: 30, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: { data: ['费用金额(万)', '费用率'], top: 0 },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { interval: 0, rotate: 0 },
    },
    yAxis: [
      {
        type: 'value',
        name: '费用金额(万)',
        splitLine: { show: false },
      },
      {
        type: 'value',
        name: '费用率(%)',
        min: 0,
      },
    ],
    series: [
      {
        name: '费用金额(万)',
        type: 'bar',
        data: expenseData,
        itemStyle: { color: comprehensiveTheme.palette.expense },
      },
      {
        name: '费用率',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: expenseRatioData,
        itemStyle: { color: comprehensiveTheme.palette.cost },
        lineStyle: { color: comprehensiveTheme.palette.cost },
        markLine: {
          symbol: 'none',
          data: [{ yAxis: expenseBudget, name: `预算阈值(${expenseBudget}%)` }],
          lineStyle: { color: comprehensiveTheme.palette.danger, type: 'dashed' },
          label: { formatter: `预算阈值 ${expenseBudget}%` },
        },
      },
    ],
  };
}

