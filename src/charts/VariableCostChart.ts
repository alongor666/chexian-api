/**
 * Variable Cost Chart - 变动成本图表
 * 变动成本率、满期赔付率、费用率趋势分析
 */

import type { ECharts, EChartsOption } from 'echarts';
import type { AggregatedData } from '@/types/data.types';
import { echarts } from '@/shared/utils/echarts';
import { createLogger } from '@/shared/utils/logger';
import type { EChartsParam } from '@/shared/types/echarts';

const logger = createLogger('VariableCostChart');

/**
 * 变动成本图配置选项
 */
export interface VariableCostChartOptions {
  title?: string; // 图表标题
  subtitle?: string; // 副标题
  dimension?: 'week' | 'org' | 'category'; // 分析维度
  topN?: number; // 显示前 N 项（仅用于 dimension='org' 或 'category'）
  width?: number; // 宽度
  height?: number; // 高度
}

/**
 * 变动成本图类
 */
class VariableCostChart {
  private chart: ECharts | null = null;

  /**
   * 初始化图表
   */
  init(container: HTMLElement, _options: VariableCostChartOptions): void {
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
  render(data: AggregatedData, options: VariableCostChartOptions): void {
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
  private buildOption(data: AggregatedData, options: VariableCostChartOptions): EChartsOption {
    const { title, subtitle, dimension = 'week', topN } = options;

    let xAxisData: string[] = [];
    let series1Data: number[] = []; // 变动成本率
    let series2Data: number[] = []; // 满期赔付率
    let series3Data: number[] = []; // 费用率

    if (dimension === 'week') {
      // 按周次展示趋势
      const weeks = Object.keys(data.byWeek || {}).sort((a, b) => parseInt(a) - parseInt(b));
      xAxisData = weeks.map((w) => `第${w}周`);

      series1Data = weeks.map((week) => data.byWeek?.[parseInt(week)]?.变动成本率 || 0);
      series2Data = weeks.map((week) => data.byWeek?.[parseInt(week)]?.满期赔付率 || 0);
      series3Data = weeks.map((week) => data.byWeek?.[parseInt(week)]?.费用率 || 0);
    } else if (dimension === 'org') {
      // 按机构对比
      let orgs = Object.keys(data.byOrg);
      if (topN && topN > 0) {
        orgs = orgs
          .sort(
            (a, b) =>
              (data.byOrg[b]?.签单保费 || 0) - (data.byOrg[a]?.签单保费 || 0)
          )
          .slice(0, topN);
      }
      xAxisData = orgs;

      series1Data = orgs.map((org) => data.byOrg[org]?.变动成本率 || 0);
      series2Data = orgs.map((org) => data.byOrg[org]?.满期赔付率 || 0);
      series3Data = orgs.map((org) => data.byOrg[org]?.费用率 || 0);
    } else if (dimension === 'category') {
      // 按业务类型分类对比
      const categories = Object.keys(data.byCategory);
      xAxisData = categories;

      series1Data = categories.map((cat) => data.byCategory[cat]?.变动成本率 || 0);
      series2Data = categories.map((cat) => data.byCategory[cat]?.满期赔付率 || 0);
      series3Data = categories.map((cat) => data.byCategory[cat]?.费用率 || 0);
    }

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
          type: 'cross',
        },
        formatter: (params: EChartsParam[]) => {
          if (!Array.isArray(params) || params.length === 0) return '';

          const axisValue = params[0].axisValue;
          let tooltip = `<div style="font-weight: bold; margin-bottom: 8px;">${axisValue}</div>`;

          params.forEach((param) => {
            const rawValue = typeof param.value === 'number' ? param.value : Number(param.value ?? 0);
            tooltip += `
              <div style="display: flex; justify-content: space-between; margin: 4px 0;">
                <span style="margin-right: 16px;">
                  <span style="display: inline-block; width: 10px; height: 10px; background: ${param.color}; margin-right: 8px; border-radius: 50%;"></span>
                  ${param.seriesName}
                </span>
                <span style="font-weight: bold;">${rawValue.toFixed(2)}%</span>
              </div>
            `;
          });

          return tooltip;
        },
      },
      legend: {
        data: ['变动成本率', '满期赔付率', '费用率'],
        bottom: 0,
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '12%',
        top: title ? '15%' : '5%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xAxisData,
        boundaryGap: dimension !== 'week', // 趋势图不留间隙，对比图留间隙
        axisLabel: {
          interval: 0,
          rotate: xAxisData.length > 10 ? 45 : 0,
          formatter: (value: string) => {
            if (value.length > 8) {
              return value.substring(0, 8) + '...';
            }
            return value;
          },
        },
      },
      yAxis: {
        type: 'value',
        name: '比率（%）',
        axisLabel: {
          formatter: '{value}%',
        },
        max: dimension === 'week' ? 120 : undefined, // 趋势图固定最大值，对比图自适应
      },
      series: [
        {
          name: '变动成本率',
          type: dimension === 'week' ? 'line' : 'bar',
          data: series1Data,
          smooth: dimension === 'week',
          itemStyle: {
            color: '#ff7875',
          },
          emphasis: {
            focus: 'series',
          },
        },
        {
          name: '满期赔付率',
          type: dimension === 'week' ? 'line' : 'bar',
          data: series2Data,
          smooth: dimension === 'week',
          itemStyle: {
            color: '#ffa940',
          },
          emphasis: {
            focus: 'series',
          },
        },
        {
          name: '费用率',
          type: dimension === 'week' ? 'line' : 'bar',
          data: series3Data,
          smooth: dimension === 'week',
          itemStyle: {
            color: '#69c0ff',
          },
          emphasis: {
            focus: 'series',
          },
        },
      ],
    };
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

export default VariableCostChart;
