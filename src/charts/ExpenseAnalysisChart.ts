/**
 * Expense Analysis Chart - 费用分析图表
 * 双Y轴图、超支分析、投产效率分析
 */

import type { ECharts, EChartsOption } from 'echarts';
import type { AggregatedData, YearPlan } from '@/types/data.types';
import { echarts } from '@/shared/utils/echarts';
import { formatCurrency, formatPercent, formatPremiumWan } from '@/shared/utils/formatters';
import { createLogger } from '@/shared/utils/logger';
import type { EChartsParam } from '@/shared/types/echarts';

const logger = createLogger('ExpenseAnalysisChart');

/**
 * 费用分析图类型
 */
export type ExpenseChartType = 'dual-axis' | 'over-budget' | 'efficiency';

/**
 * 费用分析图配置选项
 */
export interface ExpenseAnalysisChartOptions {
  title?: string; // 图表标题
  subtitle?: string; // 副标题
  chartType: ExpenseChartType; // 图表类型
  dimension?: 'org' | 'category' | 'week'; // 分析维度
  topN?: number; // 显示前 N 项（默认全部）
  yearPlan?: YearPlan[]; // 年度计划数据（用于超支分析）
  width?: number; // 宽度
  height?: number; // 高度
}

/**
 * 费用分析图类
 */
class ExpenseAnalysisChart {
  private chart: ECharts | null = null;

  /**
   * 初始化图表
   */
  init(container: HTMLElement, _options: ExpenseAnalysisChartOptions): void {
    if (this.chart) {
      this.chart.dispose();
    }

    this.chart = echarts.init(container);
    logger.debug('图表初始化成功');
  }

  /**
   * 渲染图表
   */
  render(data: AggregatedData, options: ExpenseAnalysisChartOptions): void {
    if (!this.chart) {
      logger.error('图表未初始化');
      return;
    }

    const chartOption = this.buildOption(data, options);
    this.chart.setOption(chartOption, true);

    logger.debug('图表渲染成功', { chartType: options.chartType });
  }

  /**
   * 构建图表配置
   */
  private buildOption(data: AggregatedData, options: ExpenseAnalysisChartOptions): EChartsOption {
    const { chartType } = options;

    switch (chartType) {
      case 'dual-axis':
        return this.buildDualAxisOption(data, options);
      case 'over-budget':
        return this.buildOverBudgetOption(data, options);
      case 'efficiency':
        return this.buildEfficiencyOption(data, options);
      default:
        return {};
    }
  }

  /**
   * 构建双Y轴图配置
   */
  private buildDualAxisOption(data: AggregatedData, options: ExpenseAnalysisChartOptions): EChartsOption {
    const { title, subtitle, dimension = 'org', topN } = options;

    let xAxisData: string[] = [];
    let leftSeriesData: number[] = []; // 费用金额
    let rightSeriesData: number[] = []; // 费用率

    if (dimension === 'org') {
      let orgs = Object.keys(data.byOrg);
      if (topN && topN > 0) {
        orgs = orgs
          .sort((a, b) => (data.byOrg[b]?.费用金额 || 0) - (data.byOrg[a]?.费用金额 || 0))
          .slice(0, topN);
      }
      xAxisData = orgs;
      leftSeriesData = orgs.map((org) => data.byOrg[org]?.费用金额 || 0);
      rightSeriesData = orgs.map((org) => data.byOrg[org]?.费用率 || 0);
    } else if (dimension === 'category') {
      const categories = Object.keys(data.byCategory);
      xAxisData = categories;
      leftSeriesData = categories.map((cat) => data.byCategory[cat]?.费用金额 || 0);
      rightSeriesData = categories.map((cat) => data.byCategory[cat]?.费用率 || 0);
    } else if (dimension === 'week') {
      const weeks = Object.keys(data.byWeek || {}).sort((a, b) => parseInt(a) - parseInt(b));
      xAxisData = weeks.map((w) => `第${w}周`);
      leftSeriesData = weeks.map((w) => data.byWeek?.[parseInt(w)]?.费用金额 || 0);
      rightSeriesData = weeks.map((w) => data.byWeek?.[parseInt(w)]?.费用率 || 0);
    }

    return {
      title: title ? { text: title, subtext: subtitle, left: 'center' } : undefined,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
      },
      legend: { data: ['费用金额', '费用率'], bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '12%', top: title ? '15%' : '5%', containLabel: true },
      xAxis: { type: 'category', data: xAxisData, axisLabel: { rotate: xAxisData.length > 10 ? 45 : 0 } },
      yAxis: [
        {
          type: 'value',
          name: '费用金额（元）',
          position: 'left',
          axisLabel: { formatter: (value: number) => this.formatValue(value) },
        },
        {
          type: 'value',
          name: '费用率（%）',
          position: 'right',
          axisLabel: { formatter: '{value}%' },
          max: 30,
        },
      ],
      series: [
        {
          name: '费用金额',
          type: 'bar',
          yAxisIndex: 0,
          data: leftSeriesData,
          itemStyle: { color: '#5470c6' },
        },
        {
          name: '费用率',
          type: 'line',
          yAxisIndex: 1,
          data: rightSeriesData,
          smooth: true,
          itemStyle: { color: '#ee6666' },
        },
      ],
    };
  }

  /**
   * 构建超支分析图配置
   */
  private buildOverBudgetOption(data: AggregatedData, options: ExpenseAnalysisChartOptions): EChartsOption {
    const { title, subtitle, dimension = 'org', topN, yearPlan } = options;

    let xAxisData: string[] = [];
    let actualData: number[] = [];
    let budgetData: number[] = [];

    if (dimension === 'org') {
      let orgs = Object.keys(data.byOrg);
      if (topN && topN > 0) {
        orgs = orgs
          .sort((a, b) => (data.byOrg[b]?.费用金额 || 0) - (data.byOrg[a]?.费用金额 || 0))
          .slice(0, topN);
      }
      xAxisData = orgs;
      actualData = orgs.map((org) => data.byOrg[org]?.费用金额 || 0);

      // 如果有年度计划，使用计划数据；否则使用实际数据的 90% 作为预算
      if (yearPlan && yearPlan.length > 0) {
        const totalBudget = yearPlan.reduce((sum, p) => sum + p.premium_plan_yuan, 0) * 0.15; // 假设费用率为 15%
        const avgBudget = totalBudget / orgs.length;
        budgetData = orgs.map(() => avgBudget);
      } else {
        const totalExpense = actualData.reduce((sum, v) => sum + v, 0);
        const avgBudget = (totalExpense / orgs.length) * 0.9;
        budgetData = orgs.map(() => avgBudget);
      }
    }

    return {
      title: title ? { text: title, subtext: subtitle, left: 'center' } : undefined,
      tooltip: { trigger: 'axis' },
      legend: { data: ['实际费用', '预算费用'], bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '12%', top: title ? '15%' : '5%', containLabel: true },
      xAxis: { type: 'category', data: xAxisData, axisLabel: { rotate: xAxisData.length > 10 ? 45 : 0 } },
      yAxis: {
        type: 'value',
        name: '费用金额（元）',
        axisLabel: { formatter: (value: number) => this.formatValue(value) },
      },
      series: [
        {
          name: '实际费用',
          type: 'bar',
          data: actualData,
          itemStyle: {
            color: (params: EChartsParam) => {
              const dataValue = typeof params.data === 'number' ? params.data : Number(params.data ?? 0);
              const isOverBudget = dataValue > (budgetData[params.dataIndex ?? 0] ?? 0);
              return isOverBudget ? '#ee6666' : '#91cc75';
            },
          },
        },
        {
          name: '预算费用',
          type: 'line',
          data: budgetData,
          lineStyle: { type: 'dashed', color: '#faad14' },
          itemStyle: { color: '#faad14' },
        },
      ],
    };
  }

  /**
   * 构建投产效率图配置
   */
  private buildEfficiencyOption(data: AggregatedData, options: ExpenseAnalysisChartOptions): EChartsOption {
    const { title, subtitle, dimension = 'org', topN } = options;

    let dataPoints: Array<{ name: string; value: [number, number] }> = [];

    if (dimension === 'org') {
      let orgs = Object.keys(data.byOrg);
      if (topN && topN > 0) {
        orgs = orgs
          .sort((a, b) => (data.byOrg[b]?.签单保费 || 0) - (data.byOrg[a]?.签单保费 || 0))
          .slice(0, topN);
      }

      dataPoints = orgs.map((org) => {
        const orgData = data.byOrg[org];
        const expense = orgData?.费用金额 || 0;
        const premium = orgData?.签单保费 || 0;
        const efficiency = premium > 0 ? expense / premium : 0; // 费用率

        return {
          name: org,
          value: [premium, efficiency * 100],
        };
      });
    }

    return {
      title: title ? { text: title, subtext: subtitle, left: 'center' } : undefined,
      tooltip: {
        trigger: 'item',
        formatter: (params: EChartsParam) => {
          const data = params.data as { value?: [number, number]; name?: string } | undefined;
          const [premium, efficiency] = data?.value ?? [0, 0];
          return `
            <div style="padding: 8px;">
              <div style="font-weight: bold; margin-bottom: 8px;">${data?.name ?? ''}</div>
              <div>签单保费: ${this.formatValue(premium)}</div>
              <div>费用率: ${formatPercent(efficiency, 2)}</div>
            </div>
          `;
        },
      },
      grid: { left: '10%', right: '10%', bottom: '10%', top: title ? '15%' : '5%', containLabel: true },
      xAxis: {
        type: 'value',
        name: '签单保费（元）',
        nameLocation: 'middle',
        nameGap: 30,
        splitLine: { lineStyle: { type: 'dashed' } },
        axisLabel: { formatter: (value: number) => this.formatValue(value) },
      },
      yAxis: {
        type: 'value',
        name: '费用率（%）',
        nameLocation: 'middle',
        nameGap: 40,
        splitLine: { lineStyle: { type: 'dashed' } },
        axisLabel: { formatter: '{value}%' },
        max: 30,
      },
      series: [
        {
          type: 'scatter',
          data: dataPoints,
          symbolSize: (data: number[]) => Math.sqrt((data[0] ?? 0) / 10000) + 5,
          itemStyle: {
            color: (params: EChartsParam) => {
              const data = params.data as { value?: [number, number] } | undefined;
              const efficiency = data?.value?.[1] ?? 0;
              return efficiency > 20 ? '#ee6666' : efficiency > 15 ? '#faad14' : '#91cc75';
            },
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
          label: {
            show: true,
            formatter: (params: EChartsParam) => {
              const data = params.data as { name?: string } | undefined;
              return data?.name ?? '';
            },
            position: 'top',
          },
        },
      ],
    };
  }

  /**
   * 格式化数值
   */
  private formatValue(value: number): string {
    if (value >= 100000000) {
      return `${formatCurrency(value / 100000000)}亿`;
    }
    return formatPremiumWan(value);
  }

  /**
   * 响应式调整
   */
  resize(): void {
    if (this.chart) {
      this.chart.resize();
    }
  }

  /**
   * 销毁图表
   */
  dispose(): void {
    if (this.chart) {
      this.chart.dispose();
      this.chart = null;
    }
    logger.debug('图表已销毁');
  }

  /**
   * 获取图表实例
   */
  getChart(): ECharts | null {
    return this.chart;
  }
}

export default ExpenseAnalysisChart;
