import type { ECharts } from 'echarts';
import type { EChartsCore } from '@/shared/utils/echarts';
import type { Logger } from '../../shared/utils/logger';

export class BaseChartService {
  protected charts: Map<string, ECharts> = new Map();
  protected echarts: EChartsCore;
  protected logger: Logger;

  constructor(echartsInstance: EChartsCore, logger: Logger) {
    this.echarts = echartsInstance;
    this.logger = logger;
  }

  initChart(container: HTMLElement, chartId: string): ECharts {
    if (this.charts.has(chartId)) {
      this.disposeChart(chartId);
    }

    const chart = this.echarts.init(container);
    this.charts.set(chartId, chart);

    this.logger.debug('图表初始化成功', { chartId });
    return chart;
  }

  disposeChart(chartId: string): void {
    const chart = this.charts.get(chartId);
    if (chart) {
      chart.dispose();
      this.charts.delete(chartId);
      this.logger.debug('图表已销毁', { chartId });
    }
  }

  disposeAllCharts(): void {
    this.charts.forEach((chart) => chart.dispose());
    this.charts.clear();
    this.logger.debug('所有图表已销毁');
  }

  resizeChart(chartId: string): void {
    const chart = this.charts.get(chartId);
    if (chart) {
      chart.resize();
    }
  }

  resizeAllCharts(): void {
    this.charts.forEach((chart) => chart.resize());
    this.logger.debug('所有图表已调整大小');
  }

  getChart(chartId: string): ECharts | undefined {
    return this.charts.get(chartId);
  }

  getAllCharts(): ECharts[] {
    return Array.from(this.charts.values());
  }
}
