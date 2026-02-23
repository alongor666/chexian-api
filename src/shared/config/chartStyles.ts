/**
 * 全局图表和表格样式配置
 *
 * 统一规范：
 * - 字体：系统默认字体
 * - 字号：12px（正文）、14px（标题）
 * - 颜色：使用设计系统 (src/shared/styles/index.ts)
 * - 保费：万元，1位小数，不显示单位
 * - 率值/占比：百分比，1位小数
 * - 图表轴标签：水平显示（rotate: 0）
 */

import { colors } from '../styles';

// ==================== 颜色配置 ====================

export const TONNAGE_COLORS: Record<string, string> = {
  '1吨以下': '#5470C6',
  '1-2吨': '#91CC75',
  '2-5吨': '#FAC858',
  '5-10吨': '#EE6666',
  '10吨以上': '#73C0DE',
  '未知': '#9A60B4',
};

/** 统一文字颜色 - 使用设计系统 */
export const TEXT_COLORS = {
  primary: colors.neutral[800],    // #262626 - 主要文字
  secondary: colors.neutral[600],  // #595959 - 次要文字
  tertiary: colors.neutral[500],   // #8c8c8c - 辅助文字
  white: '#ffffff',
} as const;

// ==================== 统一字体配置 ====================

/**
 * 字体族配置（跨平台兼容）
 *
 * 设计原则：
 * - KPI数字：使用几何无衬线字体（Futura/Avenir风格），突出数据展示
 * - 图表数字：使用清晰的屏幕优化字体（Helvetica Neue/SF Pro风格）
 * - 通用文本：使用系统默认字体，保证最佳可读性
 *
 * 跨平台字体回退：
 * - macOS: Avenir Next, SF Pro Display, Helvetica Neue
 * - Windows: Century Gothic, Segoe UI
 * - 通用后备: system-ui, Inter, Roboto
 */

/** 通用字体族（正文、标签等） */
export const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif';

/**
 * KPI 数字字体族（Futura/Avenir 风格）
 * 用于：KPI卡片大数字、核心指标展示
 * 特点：几何无衬线、现代感、数据突出
 */
export const FONT_FAMILY_KPI = '"Avenir Next", Avenir, "Century Gothic", "SF Pro Display", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", system-ui, sans-serif';

/**
 * 图表数字字体族（Helvetica Neue/SF Pro 风格）
 * 用于：图表轴标签、数据标签、tooltip数值
 * 特点：清晰、等宽数字、专业感
 */
export const FONT_FAMILY_CHART_NUMBER = '"SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", -apple-system, system-ui, sans-serif';

/**
 * 等宽数字字体族（表格数字对齐）
 * 用于：表格数字列、需要垂直对齐的数字
 * 特点：tabular-nums 确保数字等宽
 */
export const FONT_FAMILY_TABULAR = '"SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", -apple-system, system-ui, sans-serif';

/** 统一字号 */
export const FONT_SIZES = {
  xs: 10,
  sm: 11,
  base: 12,
  md: 13,
  lg: 14,
  xl: 16,
  '2xl': 18,
} as const;

// ==================== 图表文字样式 ====================

export const CHART_TEXT_STYLES = {
  /** 轴标签样式（数字使用图表数字字体） */
  axisLabel: {
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.secondary,
    fontFamily: FONT_FAMILY_CHART_NUMBER,
  },
  /** 轴名称样式 */
  axisName: {
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.secondary,
    fontFamily: FONT_FAMILY,
  },
  /** 动态数据标签（数字使用图表数字字体） */
  dynamicLabel: {
    fontSize: FONT_SIZES.sm,
    color: TEXT_COLORS.primary,
    fontWeight: 'normal' as const,
    fontFamily: FONT_FAMILY_CHART_NUMBER,
  },
  /** 静态标签 */
  staticLabel: {
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.secondary,
    fontFamily: FONT_FAMILY,
  },
  /** 图表标题 */
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold' as const,
    color: TEXT_COLORS.primary,
    fontFamily: FONT_FAMILY,
  },
  /** 图表副标题 */
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.tertiary,
    fontFamily: FONT_FAMILY,
  },
  /** 图例 */
  legend: {
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.secondary,
    fontFamily: FONT_FAMILY,
  },
  /** 数据标签（数字使用图表数字字体） */
  label: {
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.primary,
    fontFamily: FONT_FAMILY_CHART_NUMBER,
  },
  /** tooltip 标签（数字使用图表数字字体） */
  tooltip: {
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.primary,
    fontFamily: FONT_FAMILY_CHART_NUMBER,
  },
} as const;

// ==================== 图表布局配置 ====================

export const GRID_CONFIG = {
  left: '3%',
  right: '4%',
  bottom: '12%',
  top: '10%',
  containLabel: true,
} as const;

/** X轴配置 - 确保标签水平显示 */
export const X_AXIS_CONFIG = {
  axisLabel: {
    rotate: 0,  // 水平显示
    interval: 0,
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.secondary,
    fontFamily: FONT_FAMILY_CHART_NUMBER,
  },
  axisLine: {
    lineStyle: {
      color: colors.neutral[200],  // #e8e8e8
    },
  },
  axisTick: {
    show: false,
  },
} as const;

/** Y轴配置 - 确保标签水平显示 */
export const Y_AXIS_CONFIG = {
  axisLabel: {
    rotate: 0,  // 水平显示
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.secondary,
    fontFamily: FONT_FAMILY_CHART_NUMBER,
  },
  axisLine: {
    show: false,
  },
  axisTick: {
    show: false,
  },
  splitLine: {
    lineStyle: {
      color: colors.neutral[100],  // #f5f5f5
      type: 'dashed' as const,
    },
  },
} as const;

export const AXIS_SPLIT_LINE = {
  show: false,
} as const;

// ==================== 表格样式配置 ====================

/** 统一表格样式 */
export const TABLE_STYLES = {
  /** 表头样式 */
  header: {
    fontSize: FONT_SIZES.base,
    fontWeight: 600,
    color: TEXT_COLORS.secondary,
    backgroundColor: colors.neutral[50],  // #fafafa
    padding: '10px 12px',
  },
  /** 单元格样式 */
  cell: {
    fontSize: FONT_SIZES.base,
    fontWeight: 400,
    color: TEXT_COLORS.primary,
    padding: '8px 12px',
  },
  /** 数字单元格样式（右对齐，使用等宽数字字体） */
  numberCell: {
    fontSize: FONT_SIZES.base,
    fontWeight: 400,
    color: TEXT_COLORS.primary,
    textAlign: 'right' as const,
    fontFamily: FONT_FAMILY_TABULAR,
    fontVariantNumeric: 'tabular-nums',
  },
  /** 汇总行样式 */
  summaryRow: {
    fontSize: FONT_SIZES.base,
    fontWeight: 600,
    color: TEXT_COLORS.primary,
    backgroundColor: colors.warning.bg,  // #fffbe6
  },
} as const;

// ==================== Tooltip 配置 ====================

/** 统一 Tooltip 样式 */
export const TOOLTIP_CONFIG = {
  trigger: 'axis' as const,
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  borderColor: colors.neutral[200],  // #e8e8e8
  borderWidth: 1,
  padding: [8, 12],
  textStyle: {
    fontSize: FONT_SIZES.base,
    color: TEXT_COLORS.primary,
    fontFamily: FONT_FAMILY_CHART_NUMBER,
  },
  extraCssText: 'box-shadow: 0 2px 8px rgba(0,0,0,0.1);',
} as const;

// ==================== CSS 类名（用于表格） ====================

/**
 * 统一表格 CSS 类名（基于增长分析表格最佳实践）
 *
 * 特点：
 * - 表头：12px大写字母、灰色背景、中等字重
 * - 单元格：14px、数字使用等宽字体
 * - 悬停：蓝色背景反馈
 * - 无独立滚动条：使用主页面滚动
 */
export const TABLE_CSS_CLASSES = {
  /** 表格容器 - 无独立滚动条 */
  container: 'border rounded border-neutral-200',
  /** 表格本身 */
  table: 'min-w-full divide-y divide-neutral-200',
  /** 表头容器 */
  thead: 'bg-neutral-50',
  /** 表头行 */
  headerRow: '',
  /** 表头单元格（左对齐） */
  headerCell: 'px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider bg-neutral-50',
  /** 表头单元格（右对齐，用于数字列） */
  headerCellRight: 'px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider bg-neutral-50',
  /** 表体容器 */
  tbody: 'bg-white divide-y divide-neutral-200',
  /** 数据行 */
  row: 'hover:bg-primary-bg transition-colors',
  /** 数据行（交替色，可选） */
  rowAlt: 'bg-neutral-50 hover:bg-primary-bg transition-colors',
  /** 单元格（左对齐） */
  cell: 'px-4 py-3 text-sm text-neutral-900',
  /** 单元格（右对齐，用于数字） */
  cellRight: 'px-4 py-3 text-sm text-neutral-900 text-right font-tabular',
  /** 单元格（次要文字，如基期数据） */
  cellSecondary: 'px-4 py-3 text-sm text-neutral-500 text-right font-tabular',
  /** 单元格（强调，如当期数据） */
  cellPrimary: 'px-4 py-3 text-sm font-medium text-neutral-900',
  /** 增长率单元格（正向） */
  cellGrowthPositive: 'px-4 py-3 text-sm text-right font-tabular font-medium text-success-dark',
  /** 增长率单元格（负向） */
  cellGrowthNegative: 'px-4 py-3 text-sm text-right font-tabular font-medium text-danger',
  /** 汇总行 */
  summaryRow: 'bg-warning-bg font-semibold hover:bg-yellow-100 transition-colors',
  /** 汇总单元格 */
  summaryCell: 'px-4 py-3 text-sm text-neutral-800 font-semibold',
  /** 空数据提示 */
  emptyCell: 'px-4 py-8 text-center text-neutral-500',
} as const;

/** 获取增长率单元格样式 */
export const getGrowthCellClass = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return TABLE_CSS_CLASSES.cellRight;
  return value >= 0 ? TABLE_CSS_CLASSES.cellGrowthPositive : TABLE_CSS_CLASSES.cellGrowthNegative;
};

/** 获取增长率颜色 - 使用设计系统 */
export const getGrowthColor = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return colors.neutral[600];  // #595959
  return value >= 0 ? colors.success.DEFAULT : colors.danger.DEFAULT;  // #52c41a : #ff4d4f
};
