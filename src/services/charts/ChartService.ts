import type { EChartsOption, SetOptionOpts } from 'echarts';
import type { ChartConfig } from '@/types/chart.types';
import type { AggregatedData, KPISummary, YearPlan } from '@/types/data.types';
import { echarts } from '@/shared/utils/echarts';
import { createLogger } from '@/shared/utils/logger';
import { BaseChartService } from './BaseChartService';
import { buildChartOption } from './ChartOptionBuilder';
import {
  renderKPICardSection,
  renderStackedBarChart,
  renderPremiumProgressChart,
  renderVariableCostChart,
  renderBubbleChart,
  renderQuadrantChart,
  renderExpenseAnalysisChart,
} from './AdvancedChartRenderer';

export class ChartService extends BaseChartService {
  constructor() {
    super(echarts, createLogger('ChartService'));
  }

  renderChart(chartId: string, config: ChartConfig, opts?: SetOptionOpts): void {
    const chart = this.charts.get(chartId);
    if (!chart) {
      this.logger.error('图表不存在', { chartId });
      return;
    }

    const option = buildChartOption(config);
    if (!option || (Object.keys(option).length === 0 && config.type !== 'kpi-card')) {
      this.logger.warn('未知图表类型', { type: config.type });
    }

    chart.setOption(option as EChartsOption, opts);
    this.logger.debug('图表渲染成功', { chartId });
  }

  renderKPICards(kpiData: KPISummary, container: HTMLElement): void {
    renderKPICardSection(kpiData, container, this.logger);
  }

  renderStackedBarChart(
    container: HTMLElement,
    data: AggregatedData,
    options: {
      title?: string;
      subtitle?: string;
      metric?: '签单保费' | '边际贡献额' | '费用金额';
      topN?: number;
    }
  ): void {
    renderStackedBarChart(this.charts, container, data, options, this.logger);
  }

  renderPremiumProgressChart(
    container: HTMLElement,
    data: AggregatedData,
    options: {
      title?: string;
      subtitle?: string;
      orgName?: string;
    },
    yearPlan?: YearPlan[]
  ): void {
    renderPremiumProgressChart(this.charts, container, data, options, yearPlan, this.logger);
  }

  renderVariableCostChart(
    container: HTMLElement,
    data: AggregatedData,
    options: {
      title?: string;
      subtitle?: string;
      dimension?: 'week' | 'org' | 'category';
      topN?: number;
    }
  ): void {
    renderVariableCostChart(this.charts, container, data, options, this.logger);
  }

  renderBubbleChart(
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
    }
  ): void {
    renderBubbleChart(this.charts, container, data, options, this.logger);
  }

  renderQuadrantChart(
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
    }
  ): void {
    renderQuadrantChart(this.charts, container, data, options, this.logger);
  }

  renderExpenseAnalysisChart(
    container: HTMLElement,
    data: AggregatedData,
    options: {
      title?: string;
      subtitle?: string;
      chartType: 'dual-axis' | 'over-budget' | 'efficiency';
      dimension?: 'org' | 'category' | 'week';
      topN?: number;
      yearPlan?: YearPlan[];
    }
  ): void {
    renderExpenseAnalysisChart(this.charts, container, data, options, this.logger);
  }
}
