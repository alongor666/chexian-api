import type { ECharts } from 'echarts';
import type { Logger } from '../../shared/utils/logger';
import type { AggregatedData, YearPlan, KPISummary } from '@/types/data.types';
import StackedBarChart from '@/charts/StackedBarChart';
import PremiumProgressChart from '@/charts/PremiumProgressChart';
import VariableCostChart from '@/charts/VariableCostChart';
import BubbleChart from '@/charts/BubbleChart';
import QuadrantChart from '@/charts/QuadrantChart';
import ExpenseAnalysisChart from '@/charts/ExpenseAnalysisChart';
import { renderKPICards } from './KpiCardRenderer';

const storeChart = (charts: Map<string, ECharts>, chartId: string, instance?: ECharts | null) => {
  if (!instance) {
    return;
  }
  charts.set(chartId, instance);
};

export const renderKPICardSection = (
  kpiData: KPISummary,
  container: HTMLElement,
  logger: Logger
): void => {
  renderKPICards(kpiData, container, logger);
};

export const renderStackedBarChart = (
  charts: Map<string, ECharts>,
  container: HTMLElement,
  data: AggregatedData,
  options: {
    title?: string;
    subtitle?: string;
    metric?: '签单保费' | '边际贡献额' | '费用金额';
    topN?: number;
  },
  logger: Logger
): void => {
  const chart = new StackedBarChart();
  chart.init(container, options);
  chart.render(data, options);

  const chartId = `stacked-bar-${Date.now()}`;
  storeChart(charts, chartId, chart.getChart());
  logger.debug('堆积柱状图渲染成功');
};

export const renderPremiumProgressChart = (
  charts: Map<string, ECharts>,
  container: HTMLElement,
  data: AggregatedData,
  options: {
    title?: string;
    subtitle?: string;
    orgName?: string;
  },
  yearPlan: YearPlan[] | undefined,
  logger: Logger
): void => {
  const chart = new PremiumProgressChart();
  chart.init(container, options);
  chart.render(data, options, yearPlan);

  const chartId = `premium-progress-${Date.now()}`;
  storeChart(charts, chartId, chart.getChart());
  logger.debug('保费进度图渲染成功');
};

export const renderVariableCostChart = (
  charts: Map<string, ECharts>,
  container: HTMLElement,
  data: AggregatedData,
  options: {
    title?: string;
    subtitle?: string;
    dimension?: 'week' | 'org' | 'category';
    topN?: number;
  },
  logger: Logger
): void => {
  const chart = new VariableCostChart();
  chart.init(container, options);
  chart.render(data, options);

  const chartId = `variable-cost-${Date.now()}`;
  storeChart(charts, chartId, chart.getChart());
  logger.debug('变动成本图渲染成功');
};

export const renderBubbleChart = (
  charts: Map<string, ECharts>,
  container: HTMLElement,
  data: AggregatedData,
  options: {
    title?: string;
    subtitle?: string;
    dimension?: 'org' | 'category' | 'businessType';
    xAxisMetric?: '签单保费' | '边际贡献额';
    yAxisMetric?: '满期赔付率' | '费用率' | '变动成本率';
    sizeMetric?: '保单件数' | '边际贡献额' | '签单保费';
    topN?: number;
  },
  logger: Logger
): void => {
  const chart = new BubbleChart();
  chart.init(container, options);
  chart.render(data, options);

  const chartId = `bubble-${Date.now()}`;
  storeChart(charts, chartId, chart.getChart());
  logger.debug('气泡图渲染成功');
};

export const renderQuadrantChart = (
  charts: Map<string, ECharts>,
  container: HTMLElement,
  data: AggregatedData,
  options: {
    title?: string;
    subtitle?: string;
    dimension?: 'org' | 'category' | 'businessType';
    xAxisMetric?: '签单保费' | '边际贡献额';
    yAxisMetric?: '满期赔付率' | '费用率' | '变动成本率';
    xThreshold?: number;
    yThreshold?: number;
    topN?: number;
  },
  logger: Logger
): void => {
  const chart = new QuadrantChart();
  chart.init(container, options);
  chart.render(data, options);

  const chartId = `quadrant-${Date.now()}`;
  storeChart(charts, chartId, chart.getChart());
  logger.debug('象限图渲染成功');
};

export const renderExpenseAnalysisChart = (
  charts: Map<string, ECharts>,
  container: HTMLElement,
  data: AggregatedData,
  options: {
    title?: string;
    subtitle?: string;
    chartType: 'dual-axis' | 'over-budget' | 'efficiency';
    dimension?: 'org' | 'category' | 'week';
    topN?: number;
    yearPlan?: YearPlan[];
  },
  logger: Logger
): void => {
  const chart = new ExpenseAnalysisChart();
  chart.init(container, options);
  chart.render(data, options);

  const chartId = `expense-analysis-${Date.now()}`;
  storeChart(charts, chartId, chart.getChart());
  logger.debug('费用分析图渲染成功');
};
