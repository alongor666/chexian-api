/**
 * Stacked Bar Chart - 堆积柱状图
 * 业务类型指标对比分析（按机构堆积业务类型分类）
 */

import type { ECharts, EChartsOption, SeriesOption } from 'echarts';
import type { AggregatedData } from '@/types/data.types';
import { echarts } from '@/shared/utils/echarts';
import { formatCount, formatCurrency, formatPremiumWan } from '@/shared/utils/formatters';
import { createLogger } from '@/shared/utils/logger';
import type { EChartsParam } from '@/shared/types/echarts';

const logger = createLogger('StackedBarChart');

/**
 * 堆积图配置选项
 */
export interface StackedBarChartOptions {
  title?: string; // 图表标题
  subtitle?: string; // 副标题
  metric?: '签单保费' | '边际贡献额' | '费用金额'; // 展示指标
  topN?: number; // 显示前 N 个机构（默认全部）
}

/**
 * 堆积柱状图类
 */
class StackedBarChart {
  private chart: ECharts | null = null;

  /**
   * 初始化图表
   */
  init(container: HTMLElement, _options: StackedBarChartOptions): void {
    // 销毁已存在的图表
    if (this.chart) {
      this.chart.dispose();
    }

    // 创建新图表
    this.chart = echarts.init(container);
    logger.debug('图表初始化成功');
  }

  /**
   * 渲染图表
   */
  render(data: AggregatedData, options: StackedBarChartOptions): void {
    if (!this.chart) {
      logger.error('图表未初始化');
      return;
    }

    const chartOption = this.buildOption(data, options);
    this.chart.setOption(chartOption, true);

    logger.debug('图表渲染成功');
  }

  /**
   * 构建图表配置
   */
  private buildOption(data: AggregatedData, options: StackedBarChartOptions): EChartsOption {
    const { metric = '签单保费', topN, title, subtitle } = options;

    // 获取机构列表（X 轴）
    let orgs = Object.keys(data.byOrg);
    if (topN && topN > 0) {
      // 按总计排序，取前 N 个
      orgs = orgs
        .sort(
          (a, b) =>
            (data.byOrg[b]?.[metric as keyof typeof data.byOrg[typeof b]] || 0) -
            (data.byOrg[a]?.[metric as keyof typeof data.byOrg[typeof a]] || 0)
        )
        .slice(0, topN);
    }

    // 获取所有业务类型分类（系列）
    const categories = Object.keys(data.byCategory);

    // 构建系列数据
    const series: SeriesOption[] = categories.map((cat) => {
      const seriesData: number[] = orgs.map((org) => {
        const orgData = data.byOrg[org];
        return orgData?.[metric as keyof typeof orgData] || 0;
      });

      return {
        name: cat,
        type: 'bar',
        stack: 'total',
        emphasis: {
          focus: 'series',
        },
        data: seriesData,
      };
    });

    return {
      title: title
        ? {
            text: title,
            subtext: subtitle,
            left: 'center',
            textStyle: {
              fontSize: 16,
              fontWeight: 'bold',
            },
          }
        : undefined,
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
        formatter: (params: EChartsParam[]) => {
          let tooltip = `<div style="font-weight: bold; margin-bottom: 8px;">${params[0].axisValue}</div>`;
          params.forEach((param) => {
            const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
            if (rawValue > 0) {
              tooltip += `
                <div style="display: flex; justify-content: space-between; margin: 4px 0;">
                  <span style="margin-right: 16px;">
                    <span style="display: inline-block; width: 10px; height: 10px; background: ${param.color}; margin-right: 8px; border-radius: 50%;"></span>
                    ${param.seriesName}
                  </span>
                  <span style="font-weight: bold;">${this.formatValue(rawValue, metric)}</span>
                </div>
              `;
            }
          });
          return tooltip;
        },
      },
      legend: {
        bottom: 0,
        type: 'scroll',
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: title ? '15%' : '5%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: orgs,
        axisLabel: {
          interval: 0,
          rotate: orgs.length > 10 ? 45 : 0,
        },
      },
      yAxis: {
        type: 'value',
        name: metric,
        axisLabel: {
          formatter: (value: number) => {
            return this.formatValue(value, metric);
          },
        },
      },
      series,
    };
  }

  /**
   * 格式化数值
   */
  private formatValue(value: number, metric: string): string {
    if (metric.includes('元') || metric.includes('保费') || metric.includes('贡献') || metric.includes('费用')) {
      if (value >= 100000000) {
        return `${formatCurrency(value / 100000000)}亿`;
      }
      return formatPremiumWan(value);
    }
    return formatCount(value);
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

export default StackedBarChart;
