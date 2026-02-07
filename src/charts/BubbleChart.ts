/**
 * Bubble Chart - 气泡图
 * 损失暴露分析（多维度关系展示）
 */

import type { ECharts, EChartsOption } from 'echarts';
import type { AggregatedData } from '@/types/data.types';
import { echarts } from '@/shared/utils/echarts';
import { formatCount, formatPremiumWan, formatRate } from '../shared/utils/formatters';
import { createLogger } from '@/shared/utils/logger';
import type { EChartsParam } from '@/shared/types/echarts';

const logger = createLogger('BubbleChart');

/**
 * 气泡图数据点
 */
interface BubbleDataPoint {
  name: string; // 名称（机构、业务类型等）
  value: [number, number, number]; // [x, y, size]
  category?: string; // 分类（用于着色）
}

/**
 * 气泡图配置选项
 */
export interface BubbleChartOptions {
  title?: string; // 图表标题
  subtitle?: string; // 副标题
  dimension?: 'org' | 'category' | 'businessType'; // 分析维度
  xAxisMetric?: '签单保费' | '边际贡献额'; // X 轴指标
  yAxisMetric?: '满期赔付率' | '费用率' | '变动成本率'; // Y 轴指标
  sizeMetric?: '保单件数' | '边际贡献额' | '签单保费'; // 气泡大小指标
  topN?: number; // 显示前 N 项（默认全部）
  width?: number; // 宽度
  height?: number; // 高度
}

/**
 * 气泡图类
 */
class BubbleChart {
  private chart: ECharts | null = null;

  /**
   * 初始化图表
   */
  init(container: HTMLElement, _options: BubbleChartOptions): void {
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
  render(data: AggregatedData, options: BubbleChartOptions): void {
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
  private buildOption(data: AggregatedData, options: BubbleChartOptions): EChartsOption {
    const {
      title,
      subtitle,
      dimension = 'org',
      xAxisMetric = '签单保费',
      yAxisMetric = '满期赔付率',
      sizeMetric = '边际贡献额',
      topN,
    } = options;

    // 准备数据
    let dataPoints: BubbleDataPoint[] = [];
    let categories: string[] = [];

    if (dimension === 'org') {
      // 按机构分析
      let orgs = Object.keys(data.byOrg);
      if (topN && topN > 0) {
        orgs = orgs
          .sort(
            (a, b) =>
              (data.byOrg[b]?.[sizeMetric as keyof typeof data.byOrg[typeof b]] || 0) -
              (data.byOrg[a]?.[sizeMetric as keyof typeof data.byOrg[typeof a]] || 0)
          )
          .slice(0, topN);
      }

      dataPoints = orgs.map((org) => {
        const orgData = data.byOrg[org];
        return {
          name: org,
          value: [
            orgData?.[xAxisMetric as keyof typeof orgData] || 0,
            orgData?.[yAxisMetric as keyof typeof orgData] || 0,
            orgData?.[sizeMetric as keyof typeof orgData] || 0,
          ],
        };
      });
    } else if (dimension === 'category') {
      // 按业务类型分类分析
      categories = Object.keys(data.byCategory);
      dataPoints = categories.map((cat) => {
        const catData = data.byCategory[cat];
        return {
          name: cat,
          value: [
            catData?.[xAxisMetric as keyof typeof catData] || 0,
            catData?.[yAxisMetric as keyof typeof catData] || 0,
            catData?.[sizeMetric as keyof typeof catData] || 0,
          ],
          category: cat,
        };
      });
    } else if (dimension === 'businessType') {
      // 按业务类型细分分析
      const types = Object.keys(data.byBusinessType);
      dataPoints = types.map((type) => {
        const typeData = data.byBusinessType[type];
        return {
          name: type,
          value: [
            typeData?.[xAxisMetric as keyof typeof typeData] || 0,
            typeData?.[yAxisMetric as keyof typeof typeData] || 0,
            typeData?.[sizeMetric as keyof typeof typeData] || 0,
          ],
        };
      });
    }

    // 计算气泡大小的缩放因子
    const sizeValues = dataPoints.map((p) => p.value[2]);
    const maxSize = Math.max(...sizeValues);
    const minSize = Math.min(...sizeValues);
    const sizeRange = maxSize - minSize || 1;

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
        trigger: 'item',
        formatter: (params: EChartsParam) => {
          if (!params.data) return '';

          const data = params.data as BubbleDataPoint;
          const [x, y, size] = data.value;

          return `
            <div style="padding: 8px;">
              <div style="font-weight: bold; margin-bottom: 8px;">${data.name}</div>
              <div>${xAxisMetric}: ${this.formatValue(x, xAxisMetric)}</div>
              <div>${yAxisMetric}: ${formatRate(y)}</div>
              <div>${sizeMetric}: ${this.formatValue(size, sizeMetric)}</div>
            </div>
          `;
        },
      },
      grid: {
        left: '10%',
        right: '10%',
        bottom: '10%',
        top: title ? '15%' : '5%',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        name: xAxisMetric,
        nameLocation: 'middle',
        nameGap: 30,
        splitLine: {
          lineStyle: {
            type: 'dashed',
          },
        },
        axisLabel: {
          formatter: (value: number) => {
            return this.formatValue(value, xAxisMetric);
          },
        },
      },
      yAxis: {
        type: 'value',
        name: yAxisMetric,
        nameLocation: 'middle',
        nameGap: 40,
        splitLine: {
          lineStyle: {
            type: 'dashed',
          },
        },
        axisLabel: {
          formatter: (value: number) => formatRate(value),
        },
        max: yAxisMetric.includes('率') ? 120 : undefined,
      },
      series: [
        {
          type: 'scatter',
          data: dataPoints,
          symbolSize: (data: number[]) => {
            // 气泡大小映射：10px - 60px
            const value = (data[2] ?? 0);
            const normalizedSize = (value - minSize) / sizeRange;
            return 10 + normalizedSize * 50;
          },
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(25, 100, 150, 0.5)',
            shadowOffsetY: 5,
            color: (params: EChartsParam) => {
              // 根据索引生成不同颜色
              const colors = [
                '#5470c6',
                '#91cc75',
                '#fac858',
                '#ee6666',
                '#73c0de',
                '#3ba272',
                '#fc8452',
                '#9a60b4',
                '#ea7ccc',
              ];
              return colors[(params.dataIndex ?? 0) % colors.length] || '#5470c6';
            },
          },
          emphasis: {
            focus: 'self',
            itemStyle: {
              shadowBlur: 20,
              shadowColor: 'rgba(25, 100, 150, 0.8)',
              shadowOffsetY: 10,
            },
          },
          label: {
            show: true,
            formatter: (params: EChartsParam) => {
              return (params.data as BubbleDataPoint | undefined)?.name || '';
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
  private formatValue(value: number, metric: string): string {
    if (metric.includes('元') || metric.includes('保费') || metric.includes('贡献')) {
      return formatPremiumWan(value);
    }
    if (metric.includes('件数')) {
      return formatCount(value);
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

export default BubbleChart;
