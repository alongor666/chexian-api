/**
 * Quadrant Chart - 四象限图
 * 损失暴露与收益分析（二维象限分析）
 */

import type { ECharts, EChartsOption } from 'echarts';
import type { AggregatedData } from '@/types/data.types';
import { echarts } from '@/shared/utils/echarts';
import { formatPremiumWan, formatCount } from '@/shared/utils/formatters';
import { createLogger } from '@/shared/utils/logger';
import type { EChartsParam } from '@/shared/types/echarts';

const logger = createLogger('QuadrantChart');

/**
 * 象限图数据点
 */
interface QuadrantDataPoint {
  name: string; // 名称（机构、业务类型等）
  value: [number, number]; // [x, y]
  quadrant?: 1 | 2 | 3 | 4; // 所属象限
}

/**
 * 象限图配置选项
 */
export interface QuadrantChartOptions {
  title?: string; // 图表标题
  subtitle?: string; // 副标题
  dimension?: 'org' | 'category' | 'businessType'; // 分析维度
  xAxisMetric?: '签单保费' | '边际贡献额'; // X 轴指标
  yAxisMetric?: '满期赔付率' | '费用率' | '变动成本率'; // Y 轴指标
  xThreshold?: number; // X 轴阈值（可选，默认为平均值）
  yThreshold?: number; // Y 轴阈值（可选，默认为平均值）
  topN?: number; // 显示前 N 项（默认全部）
  width?: number; // 宽度
  height?: number; // 高度
}

/**
 * 四象限图类
 */
class QuadrantChart {
  private chart: ECharts | null = null;

  /**
   * 初始化图表
   */
  init(container: HTMLElement, _options: QuadrantChartOptions): void {
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
  render(data: AggregatedData, options: QuadrantChartOptions): void {
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
  private buildOption(data: AggregatedData, options: QuadrantChartOptions): EChartsOption {
    const {
      title,
      subtitle,
      dimension = 'org',
      xAxisMetric = '签单保费',
      yAxisMetric = '满期赔付率',
      xThreshold,
      yThreshold,
      topN,
    } = options;

    // 准备数据
    let dataPoints: QuadrantDataPoint[] = [];

    if (dimension === 'org') {
      // 按机构分析
      let orgs = Object.keys(data.byOrg);
      if (topN && topN > 0) {
        orgs = orgs
          .sort(
            (a, b) =>
              (data.byOrg[b]?.[xAxisMetric as keyof typeof data.byOrg[typeof b]] || 0) -
              (data.byOrg[a]?.[xAxisMetric as keyof typeof data.byOrg[typeof a]] || 0)
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
          ],
        };
      });
    } else if (dimension === 'category') {
      // 按业务类型分类分析
      const categories = Object.keys(data.byCategory);
      dataPoints = categories.map((cat) => {
        const catData = data.byCategory[cat];
        return {
          name: cat,
          value: [
            catData?.[xAxisMetric as keyof typeof catData] || 0,
            catData?.[yAxisMetric as keyof typeof catData] || 0,
          ],
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
          ],
        };
      });
    }

    // 计算阈值（如果未指定）
    const xValues = dataPoints.map((p) => p.value[0]);
    const yValues = dataPoints.map((p) => p.value[1]);
    const finalXThreshold = xThreshold ?? this.calculateMedian(xValues);
    const finalYThreshold = yThreshold ?? this.calculateMedian(yValues);

    // 标记象限
    dataPoints.forEach((point) => {
      const [x, y] = point.value;
      if (x >= finalXThreshold && y >= finalYThreshold) {
        point.quadrant = 1; // 右上：高规模高风险
      } else if (x < finalXThreshold && y >= finalYThreshold) {
        point.quadrant = 2; // 左上：低规模高风险
      } else if (x < finalXThreshold && y < finalYThreshold) {
        point.quadrant = 3; // 左下：低规模低风险
      } else {
        point.quadrant = 4; // 右下：高规模低风险
      }
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
        trigger: 'item',
        formatter: (params: EChartsParam) => {
          if (!params.data) return '';

          const data = params.data as QuadrantDataPoint;
          const [x, y] = data.value;
          const quadrantNames = ['右上象限', '左上象限', '左下象限', '右下象限'];
          const quadrantName = quadrantNames[(data.quadrant ?? 1) - 1];

          return `
            <div style="padding: 8px;">
              <div style="font-weight: bold; margin-bottom: 8px;">${data.name}</div>
              <div>象限: ${quadrantName}</div>
              <div>${xAxisMetric}: ${this.formatValue(x, xAxisMetric)}</div>
              <div>${yAxisMetric}: ${y.toFixed(2)}%</div>
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
            type: 'solid',
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
            type: 'solid',
          },
        },
        axisLabel: {
          formatter: '{value}%',
        },
        max: yAxisMetric.includes('率') ? 120 : undefined,
      },
      // 添加象限分割线（使用 markLine）
      series: [
        {
          type: 'scatter',
          data: dataPoints,
          symbolSize: 12,
          itemStyle: {
            color: (params: EChartsParam) => {
              const data = params.data as QuadrantDataPoint;
              const quadrantColors = {
                1: '#ee6666', // 右上：高规模高风险 - 红色
                2: '#fc8452', // 左上：低规模高风险 - 橙色
                3: '#91cc75', // 左下：低规模低风险 - 绿色
                4: '#73c0de', // 右下：高规模低风险 - 蓝色
              };
              return quadrantColors[data.quadrant ?? 1] || '#5470c6';
            },
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
          emphasis: {
            focus: 'self',
            itemStyle: {
              shadowBlur: 20,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
          },
          label: {
            show: true,
            formatter: (params: EChartsParam) => {
              return (params.data as QuadrantDataPoint | undefined)?.name || '';
            },
            position: 'top',
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              {
                xAxis: finalXThreshold,
                lineStyle: {
                  type: 'solid',
                  color: '#999',
                  width: 2,
                },
                label: {
                  formatter: `阈值: ${this.formatValue(finalXThreshold, xAxisMetric)}`,
                  position: 'end',
                },
              },
              {
                yAxis: finalYThreshold,
                lineStyle: {
                  type: 'solid',
                  color: '#999',
                  width: 2,
                },
                label: {
                  formatter: `阈值: ${finalYThreshold.toFixed(2)}%`,
                  position: 'end',
                },
              },
            ],
          },
        },
      ],
    };
  }

  /**
   * 计算中位数
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  }

  /**
   * 格式化数值
   */
  private formatValue(value: number, metric: string): string {
    if (metric.includes('元') || metric.includes('保费') || metric.includes('贡献')) {
      if (value >= 100000000) {
        return `${(value / 100000000).toFixed(2)}亿`;
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

export default QuadrantChart;
