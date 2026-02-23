/**
 * Premium Progress Chart - 保费进度图表
 * 保费时间进度达成率 + 累计保费趋势分析
 */

import type { ECharts, EChartsOption } from 'echarts';
import type { AggregatedData, YearPlan } from '@/types/data.types';
import { echarts } from '@/shared/utils/echarts';
import { formatCurrency, formatPercent, formatPremiumWan } from '@/shared/utils/formatters';
import { createLogger } from '@/shared/utils/logger';
import type { EChartsParam } from '@/shared/types/echarts';

const logger = createLogger('PremiumProgressChart');

/**
 * 保费进度图配置选项
 */
export interface PremiumProgressChartOptions {
  title?: string; // 图表标题
  subtitle?: string; // 副标题
  orgName?: string; // 机构名称（可选，用于筛选特定机构）
  width?: number; // 宽度
  height?: number; // 高度
}

/**
 * 保费进度图类
 */
class PremiumProgressChart {
  private chart: ECharts | null = null;

  /**
   * 初始化图表
   */
  init(container: HTMLElement, _options: PremiumProgressChartOptions): void {
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
  render(
    data: AggregatedData,
    options: PremiumProgressChartOptions,
    yearPlan?: YearPlan[]
  ): void {
    if (!this.chart) {
      logger.error('图表未初始化');
      return;
    }

    const chartOption = this.buildOption(data, options, yearPlan);
    this.chart.setOption(chartOption, true);

    logger.debug('图表渲染成功');
  }

  /**
   * 构建图表配置
   */
  private buildOption(
    data: AggregatedData,
    options: PremiumProgressChartOptions,
    yearPlan?: YearPlan[]
  ): EChartsOption {
    const { title, subtitle } = options;

    // 获取周次数据
    const weeks = Object.keys(data.byWeek || {}).sort((a, b) => parseInt(a) - parseInt(b));
    const weekNumbers = weeks.map((w) => `第${w}周`);

    // 计算累计保费
    let cumulativePremium = 0;
    const cumulativePremiumData = weeks.map((week) => {
      const weekData = data.byWeek?.[parseInt(week)];
      const premium = weekData?.签单保费 || 0;
      cumulativePremium += premium;
      return cumulativePremium;
    });

    // 计算目标累计保费（基于年度计划）
    const totalPremium = cumulativePremiumData[cumulativePremiumData.length - 1] || 0;
    let targetCumulativeData: number[] = [];

    if (yearPlan && yearPlan.length > 0) {
      // 使用年度计划数据计算目标进度
      const planTotal = yearPlan.reduce((sum, plan) => sum + plan.premium_plan_yuan, 0);
      const weeklyTarget = planTotal / 52; // 假设平均分配到 52 周

      let targetSum = 0;
      targetCumulativeData = weeks.map(() => {
        targetSum += weeklyTarget;
        return targetSum;
      });
    } else {
      // 如果没有年度计划，使用当前总额的线性比例
      const avgWeeklyPremium = totalPremium / weeks.length;
      let targetSum = 0;
      targetCumulativeData = weeks.map(() => {
        targetSum += avgWeeklyPremium;
        return targetSum;
      });
    }

    // 计算达成率
    const achievementRate =
      targetCumulativeData.length > 0 && (targetCumulativeData[targetCumulativeData.length - 1] ?? 0) > 0
        ? (totalPremium / (targetCumulativeData[targetCumulativeData.length - 1] ?? 1)) * 100
        : 0;

    return {
      title: title
        ? {
            text: title,
            subtext: subtitle || `累计达成率: ${formatPercent(achievementRate)}`,
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
          type: 'cross',
        },
        formatter: (params: EChartsParam[]) => {
          if (!Array.isArray(params) || params.length === 0) return '';

          const week = params[0].axisValue;
          let tooltip = `<div style="font-weight: bold; margin-bottom: 8px;">${week}</div>`;

          params.forEach((param) => {
            const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
            tooltip += `
              <div style="display: flex; justify-content: space-between; margin: 4px 0;">
                <span style="margin-right: 16px;">
                  <span style="display: inline-block; width: 10px; height: 10px; background: ${param.color}; margin-right: 8px; border-radius: 50%;"></span>
                  ${param.seriesName}
                </span>
                <span style="font-weight: bold;">${this.formatValue(rawValue)}</span>
              </div>
            `;
          });

          return tooltip;
        },
      },
      legend: {
        data: ['实际累计保费', '目标累计保费'],
        bottom: 0,
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '12%',
        top: title ? '20%' : '10%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: weekNumbers,
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        name: '累计保费（元）',
        axisLabel: {
          formatter: (value: number) => {
            return this.formatValue(value);
          },
        },
      },
      series: [
        {
          name: '实际累计保费',
          type: 'line',
          data: cumulativePremiumData,
          smooth: true,
          lineStyle: {
            width: 3,
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(24, 144, 255, 0.3)' },
              { offset: 1, color: 'rgba(24, 144, 255, 0.05)' },
            ]),
          },
          emphasis: {
            focus: 'series',
          },
        },
        {
          name: '目标累计保费',
          type: 'line',
          data: targetCumulativeData,
          smooth: true,
          lineStyle: {
            width: 2,
            type: 'dashed',
          },
          itemStyle: {
            color: '#faad14',
          },
          emphasis: {
            focus: 'series',
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

export default PremiumProgressChart;
