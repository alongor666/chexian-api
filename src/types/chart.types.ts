/**
 * Chart Type Definitions
 * 图表类型定义（Phase 3 图表渲染层使用）
 */

/**
 * 图表类型枚举
 */
export type ChartType =
  | 'kpi-card' // KPI 卡片
  | 'stacked-bar' // 堆积柱状图
  | 'line' // 折线图
  | 'dual-axis' // 双 Y 轴图
  | 'bubble' // 气泡图
  | 'scatter' // 散点图
  | 'quadrant'; // 四象限图

/**
 * 图表配置选项
 */
export interface ChartOptions {
  title?: string; // 图表标题
  subtitle?: string; // 副标题
  width?: number; // 宽度
  height?: number; // 高度
  theme?: 'light' | 'dark'; // 主题
  animation?: boolean; // 是否启用动画
  responsive?: boolean; // 是否响应式
  [key: string]: unknown; // 扩展配置
}

/**
 * 图表数据点
 */
export interface DataPoint {
  label: string; // 标签
  value: number; // 值
  color?: string; // 颜色（可选）
  metadata?: Record<string, unknown>; // 元数据（可选）
}

/**
 * 图表数据系列
 */
export interface ChartSeries {
  name: string; // 系列名称
  data: DataPoint[]; // 数据点
  type?: ChartType; // 图表类型（可选，用于混合图表）
  color?: string; // 系列颜色（可选）
}

/**
 * 图表配置（完整配置）
 */
export interface ChartConfig {
  type: ChartType; // 图表类型
  data: ChartSeries[]; // 数据系列
  options?: ChartOptions; // 配置选项
}

/**
 * KPI 卡片数据
 */
export interface KPICardData {
  label: string; // 指标名称
  value: number; // 指标值
  unit?: string; // 单位（如 %、元）
  trend?: 'up' | 'down' | 'stable'; // 趋势
  trendValue?: number; // 趋势值（百分比）
  status?: 'good' | 'warning' | 'danger'; // 状态
  threshold?: number; // 阈值
}

/**
 * 四象限图数据点
 */
export interface QuadrantDataPoint {
  name: string; // 名称（如机构名称）
  x: number; // X 轴值
  y: number; // Y 轴值
  size?: number; // 气泡大小（可选）
  quadrant?: 1 | 2 | 3 | 4; // 所属象限
  metadata?: Record<string, unknown>; // 元数据
}

/**
 * 双 Y 轴图配置
 */
export interface DualAxisConfig {
  leftAxis: {
    name: string; // 左轴名称
    unit?: string; // 单位
    min?: number; // 最小值
    max?: number; // 最大值
  };
  rightAxis: {
    name: string; // 右轴名称
    unit?: string; // 单位
    min?: number; // 最小值
    max?: number; // 最大值
  };
}
