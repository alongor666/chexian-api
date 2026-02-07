import type { EChartsOption } from 'echarts';
import type { ChartConfig, ChartOptions } from '@/types/chart.types';

const getBaseOptions = (options?: ChartOptions): EChartsOption => ({
  title: options?.title
    ? {
        text: options.title,
        subtext: options.subtitle,
        left: 'center',
        textStyle: {
          fontSize: 16,
          fontWeight: 'bold',
        },
      }
    : undefined,
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    top: options?.title ? '15%' : '3%',
    containLabel: true,
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow',
    },
  },
  legend: {
    bottom: 0,
  },
  animation: options?.animation ?? true,
});

const buildStackedBarOption = (_data: unknown[], options?: ChartOptions): EChartsOption => ({
  ...getBaseOptions(options),
  xAxis: {
    type: 'category',
    data: [],
  },
  yAxis: {
    type: 'value',
  },
  series: [],
});

const buildLineOption = (_data: unknown[], options?: ChartOptions): EChartsOption => ({
  ...getBaseOptions(options),
  xAxis: {
    type: 'category',
    data: [],
  },
  yAxis: {
    type: 'value',
  },
  series: [],
});

const buildDualAxisOption = (_data: unknown[], options?: ChartOptions): EChartsOption => ({
  ...getBaseOptions(options),
  xAxis: {
    type: 'category',
    data: [],
  },
  yAxis: [
    {
      type: 'value',
      name: '左轴',
      position: 'left',
    },
    {
      type: 'value',
      name: '右轴',
      position: 'right',
    },
  ],
  series: [],
});

const buildBubbleOption = (_data: unknown[], options?: ChartOptions): EChartsOption => ({
  ...getBaseOptions(options),
  xAxis: {
    type: 'value',
    name: 'X 轴',
    splitLine: {
      lineStyle: {
        type: 'dashed',
      },
    },
  },
  yAxis: {
    type: 'value',
    name: 'Y 轴',
    splitLine: {
      lineStyle: {
        type: 'dashed',
      },
    },
  },
  series: [],
});

const buildScatterOption = (_data: unknown[], options?: ChartOptions): EChartsOption => ({
  ...getBaseOptions(options),
  xAxis: {
    type: 'value',
    name: 'X 轴',
    splitLine: {
      lineStyle: {
        type: 'dashed',
      },
    },
  },
  yAxis: {
    type: 'value',
    name: 'Y 轴',
    splitLine: {
      lineStyle: {
        type: 'dashed',
      },
    },
  },
  series: [],
});

const buildQuadrantOption = (_data: unknown[], options?: ChartOptions): EChartsOption => ({
  ...getBaseOptions(options),
  xAxis: {
    type: 'value',
    name: 'X 轴',
    splitLine: {
      lineStyle: {
        type: 'solid',
      },
    },
  },
  yAxis: {
    type: 'value',
    name: 'Y 轴',
    splitLine: {
      lineStyle: {
        type: 'solid',
      },
    },
  },
  series: [],
});

export const buildChartOption = (config: ChartConfig): EChartsOption => {
  const { type, data, options } = config;

  switch (type) {
    case 'kpi-card':
      return {};
    case 'stacked-bar':
      return buildStackedBarOption(data, options);
    case 'line':
      return buildLineOption(data, options);
    case 'dual-axis':
      return buildDualAxisOption(data, options);
    case 'bubble':
      return buildBubbleOption(data, options);
    case 'scatter':
      return buildScatterOption(data, options);
    case 'quadrant':
      return buildQuadrantOption(data, options);
    default:
      return {};
  }
};
