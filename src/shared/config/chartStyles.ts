/**
 * 全局图表和表格样式配置
 *
 * 统一规范：
 * - 字体：系统默认字体
 * - 字号：12px（正文）、14px（标题）
 * - 颜色：#333（主要文字）、#666（次要文字）、#999（辅助文字）
 * - 保费：万元，1位小数，不显示单位
 * - 率值/占比：百分比，1位小数
 * - 图表轴标签：水平显示（rotate: 0）
 */

// ==================== 颜色配置 ====================

export const TONNAGE_COLORS: Record<string, string> = {
  '1吨以下': '#5470C6',
  '1-2吨': '#91CC75',
  '2-5吨': '#FAC858',
  '5-10吨': '#EE6666',
  '10吨以上': '#73C0DE',
  '未知': '#9A60B4',
};

/** 统一文字颜色 */
export const TEXT_COLORS = {
  primary: '#333333',   // 主要文字
  secondary: '#666666', // 次要文字
  tertiary: '#999999',  // 辅助文字
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
      color: '#E0E0E0',
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
      color: '#F0F0F0',
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
    backgroundColor: '#F8FAFC',
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
    backgroundColor: '#FEF3C7',
  },
} as const;

// ==================== Tooltip 配置 ====================

/** 统一 Tooltip 样式 */
export const TOOLTIP_CONFIG = {
  trigger: 'axis' as const,
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  borderColor: '#E0E0E0',
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
  container: 'border rounded border-gray-200',
  /** 表格本身 */
  table: 'min-w-full divide-y divide-gray-200',
  /** 表头容器 */
  thead: 'bg-gray-50',
  /** 表头行 */
  headerRow: '',
  /** 表头单元格（左对齐） */
  headerCell: 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50',
  /** 表头单元格（右对齐，用于数字列） */
  headerCellRight: 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50',
  /** 表体容器 */
  tbody: 'bg-white divide-y divide-gray-200',
  /** 数据行 */
  row: 'hover:bg-blue-50 transition-colors',
  /** 数据行（交替色，可选） */
  rowAlt: 'bg-gray-50 hover:bg-blue-50 transition-colors',
  /** 单元格（左对齐） */
  cell: 'px-4 py-3 text-sm text-gray-900',
  /** 单元格（右对齐，用于数字） */
  cellRight: 'px-4 py-3 text-sm text-gray-900 text-right font-mono',
  /** 单元格（次要文字，如基期数据） */
  cellSecondary: 'px-4 py-3 text-sm text-gray-500 text-right font-mono',
  /** 单元格（强调，如当期数据） */
  cellPrimary: 'px-4 py-3 text-sm font-medium text-gray-900',
  /** 增长率单元格（正向） */
  cellGrowthPositive: 'px-4 py-3 text-sm text-right font-mono font-medium text-emerald-600',
  /** 增长率单元格（负向） */
  cellGrowthNegative: 'px-4 py-3 text-sm text-right font-mono font-medium text-red-500',
  /** 汇总行 */
  summaryRow: 'bg-amber-50 font-semibold hover:bg-amber-100 transition-colors',
  /** 汇总单元格 */
  summaryCell: 'px-4 py-3 text-sm text-gray-800 font-semibold',
  /** 空数据提示 */
  emptyCell: 'px-4 py-8 text-center text-gray-500',
} as const;

/** 获取增长率单元格样式 */
export const getGrowthCellClass = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return TABLE_CSS_CLASSES.cellRight;
  return value >= 0 ? TABLE_CSS_CLASSES.cellGrowthPositive : TABLE_CSS_CLASSES.cellGrowthNegative;
};

/** 获取增长率颜色 */
export const getGrowthColor = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '#666666';
  return value >= 0 ? '#10B981' : '#EF4444';
};
