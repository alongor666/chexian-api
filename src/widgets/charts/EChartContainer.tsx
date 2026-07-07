import type { CSSProperties } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsCoreOption } from 'echarts/core';
import { echarts } from '../../shared/utils/echarts';
import { colors } from '../../shared/styles';

/**
 * ECharts 统一容器 — 图表生命周期的 L1 唯一实现（backlog 2026-07-07-claude-821d85）。
 *
 * 封装 init / setOption / resize / dispose：组件只负责用 useMemo 构建 option，
 * 生命周期一律交给本容器，新增图表禁止手写 `echarts.init`（架构红线见
 * 开发文档/架构设计/前端极简架构规划_2026-07-07.md §五「唯一实现」）。
 *
 * - `notMerge` 默认 true：每次全量替换 option，杜绝旧轴/旧系列残留导致的
 *   "coordinateSystem undefined" 崩溃（历史上多个手写组件为此各自打过 clear() 补丁）
 * - `loading` 使用 ECharts 内建 showLoading 动画；页面自定义骨架屏请在外层条件渲染
 * - `renderer` 默认 canvas；用 svg 时渲染器需在组件内 `echarts.use([SVGRenderer])` 按需注册
 */
export interface EChartContainerProps {
  option: EChartsCoreOption;
  /** 容器高度，数字按 px 处理，默认 280 */
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  renderer?: 'canvas' | 'svg';
  /** 全量替换 option（默认 true） */
  notMerge?: boolean;
  lazyUpdate?: boolean;
  /** ECharts 内建 loading 动画 */
  loading?: boolean;
  /** ECharts 事件绑定，如 { click: handler } */
  onEvents?: Record<string, (params: unknown) => void>;
  /** 图表实例就绪回调（dispatchAction 等命令式访问的逃生口） */
  onChartReady?: (chart: unknown) => void;
}

export function EChartContainer({
  option,
  height = 280,
  className,
  style,
  renderer = 'canvas',
  notMerge = true,
  lazyUpdate = false,
  loading = false,
  onEvents,
  onChartReady,
}: EChartContainerProps) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge={notMerge}
      lazyUpdate={lazyUpdate}
      showLoading={loading}
      onEvents={onEvents}
      onChartReady={onChartReady}
      opts={{ renderer }}
      className={className}
      style={{ height, width: '100%', ...style }}
    />
  );
}

/**
 * 空态 option：完整替换轴/系列（配合 notMerge=true），只显示居中提示文字。
 * 替代历史上"graphic-only setOption + chart.clear()"的各自为政写法。
 */
export function buildEmptyChartOption(text = '暂无数据'): EChartsCoreOption {
  return {
    graphic: {
      type: 'text',
      left: 'center',
      top: 'middle',
      style: { text, fill: colors.neutral[400], fontSize: 13 },
    },
    xAxis: { show: false },
    yAxis: { show: false },
    series: [],
    tooltip: { show: false },
    legend: { show: false },
  };
}
