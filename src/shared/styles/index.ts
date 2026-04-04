/**
 * 统一设计系统 - 样式常量与工具类
 *
 * 基于 tailwind.config.js 中定义的设计令牌，提供类型安全的样式常量。
 * 所有组件应优先使用这些常量，确保样式一致性。
 */

// ============================================================================
// 颜色系统（与 tailwind.config.js 保持同步）
// ============================================================================

export const colors = {
  // 主色调 - 蓝色系（用于主操作、链接、强调）
  primary: {
    DEFAULT: '#1890ff',
    light: '#40a9ff',
    dark: '#096dd9',
    solid: '#096dd9',
    bg: '#e6f7ff',
    border: '#91d5ff',
    50: '#e6f7ff',
    100: '#bae7ff',
    200: '#91d5ff',
    300: '#69c0ff',
    400: '#40a9ff',
    500: '#1890ff',
    600: '#096dd9',
    700: '#0050b3',
    800: '#003a8c',
    900: '#002766',
  },
  // 成功色 - 绿色系（用于正面状态、增长指标）
  success: {
    DEFAULT: '#52c41a',
    light: '#73d13d',
    dark: '#389e0d',
    solid: '#389e0d',
    bg: '#f6ffed',
    border: '#b7eb8f',
  },
  // 警告色 - 橙色系（用于警示、注意事项）
  warning: {
    DEFAULT: '#faad14',
    light: '#ffc53d',
    dark: '#d48806',
    solid: '#d48806',
    bg: '#fffbe6',
    border: '#ffe58f',
  },
  // 危险色 - 红色系（用于错误、负面状态、下降指标）
  danger: {
    DEFAULT: '#ff4d4f',
    light: '#ff7875',
    dark: '#d9363e',
    solid: '#d9363e',
    bg: '#fff1f0',
    border: '#ffccc7',
  },
  // 中性色 - 灰色系（用于文本、边框、背景）
  neutral: {
    50: '#fafafa',
    100: '#f5f5f5',
    200: '#e8e8e8',
    300: '#d9d9d9',
    400: '#bfbfbf',
    500: '#8c8c8c',
    600: '#595959',
    700: '#434343',
    800: '#262626',
    900: '#1f1f1f',
  },
  // 紫色系
  purple: {
    DEFAULT: '#722ed1',
    light: '#9254de',
    solid: '#531dab',
    bg: '#f9f0ff',
    border: '#d3adf7',
  },
  // 靛蓝色系
  indigo: {
    DEFAULT: '#4f46e5',
    light: '#6366f1',
    solid: '#4338ca',
    bg: '#eef2ff',
    border: '#a5b4fc',
  },
  // 天蓝色系
  sky: {
    DEFAULT: '#0284c7',
    light: '#38bdf8',
    bg: '#f0f9ff',
    border: '#7dd3fc',
  },
  // 橙色系（与 warning 区分：用于业务标签，非警告）
  orange: {
    DEFAULT: '#ea580c',
    light: '#f97316',
    solid: '#c2410c',
    bg: '#fff7ed',
    border: '#fdba74',
  },
  // 琥珀色系
  amber: {
    DEFAULT: '#d97706',
    light: '#f59e0b',
    bg: '#fffbeb',
    border: '#fcd34d',
  },
} as const

// ============================================================================
// 语义化颜色扩展（用于状态指示、图表等）
// ============================================================================

export const semanticColors = {
  /** 状态 - 信息/主要 */
  info: {
    DEFAULT: '#3B82F6',      // blue-500
    light: '#60A5FA',        // blue-400
    dark: '#2563EB',         // blue-600
    bg: '#DBEAFE',           // blue-100
    text: '#1E40AF',         // blue-800
  },
  /** 图表专用年份颜色（dark/light 双模式高对比） */
  chart: {
    year2023: '#6366F1',  // indigo-500 — 深蓝紫
    year2024: '#F97316',  // orange-500 — 暖橙
    year2025: '#10B981',  // emerald-500 — 翠绿
    year2026: '#3B82F6',  // blue-500 — 亮蓝
    year2027: '#EC4899',  // pink-500 — 玫红
    year2028: '#A855F7',  // purple-500 — 紫色
  },
} as const

/**
 * 综合分析页主题令牌
 * - 用于图表 option 与模块状态色统一
 * - 避免在页面层硬编码色值
 */
export const comprehensiveTheme = {
  palette: {
    premium: '#0050B3',
    claim: '#C41D7F',
    expense: '#FA8C16',
    cost: '#531DAB',
    roi: '#08979C',
    neutral: '#8C8C8C',
    splitLine: '#F0F0F0',
    success: '#389E0D',
    danger: '#CF1322',
  },
  threshold: {
    premiumProgressWarn: 99,
    costRateWarn: 91,
    lossRateWarn: 70,
    expenseRateWarn: 16,
    expenseBudget: 14,
  },
} as const

// ============================================================================
// 间距系统
// ============================================================================

export const spacing = {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
  '3xl': '4rem',   // 64px
} as const

// ============================================================================
// 字体大小系统
// ============================================================================

export const fontSize = {
  xs: '0.75rem',    // 12px - 辅助信息、标签
  sm: '0.875rem',   // 14px - 正文、表格内容
  base: '1rem',     // 16px - 标准正文
  lg: '1.125rem',   // 18px - 小标题
  xl: '1.25rem',    // 20px - 中标题
  '2xl': '1.5rem',  // 24px - KPI数值、大标题
  '3xl': '1.875rem', // 30px - 页面标题
  '4xl': '2.25rem', // 36px - 大号标题
} as const

// ============================================================================
// 圆角系统
// ============================================================================

export const borderRadius = {
  none: '0',
  sm: '0.125rem',  // 2px
  md: '0.375rem',  // 6px
  lg: '0.5rem',    // 8px
  xl: '0.75rem',   // 12px
  '2xl': '1rem',   // 16px
  full: '9999px',
} as const

// ============================================================================
// 阴影系统
// ============================================================================

export const boxShadow = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  card: '0 2px 8px rgba(0, 0, 0, 0.09)',
  dropdown: '0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 6px 16px 0 rgba(0, 0, 0, 0.08)',
} as const

// ============================================================================
// 过渡动画
// ============================================================================

export const transition = {
  fast: 'all 0.15s ease-in-out',
  normal: 'all 0.2s ease-in-out',
  slow: 'all 0.3s ease-in-out',
} as const

// ============================================================================
// Tailwind 类名常量 - 组件样式组合
// ============================================================================

/**
 * 卡片样式变体
 */
export const cardStyles = {
  /** 基础卡片 */
  base: 'bg-white dark:bg-surface-1 rounded-lg border border-neutral-200 dark:border-subtle shadow-sm dark:shadow-none',
  /** 可交互卡片（带hover效果） */
  interactive: 'bg-white dark:bg-surface-1 rounded-lg border border-neutral-200 dark:border-subtle shadow-sm dark:shadow-none hover:shadow-md dark:hover:bg-surface-2 transition-all',
  /** 紧凑卡片 */
  compact: 'bg-white dark:bg-surface-1 rounded-lg border border-neutral-200 dark:border-subtle shadow-sm dark:shadow-none p-3',
  /** 标准卡片 */
  standard: 'bg-white dark:bg-surface-1 rounded-lg border border-neutral-200 dark:border-subtle shadow-sm dark:shadow-none p-4',
  /** 宽松卡片 */
  spacious: 'bg-white dark:bg-surface-1 rounded-lg border border-neutral-200 dark:border-subtle shadow-sm dark:shadow-none p-6',
} as const

/**
 * 按钮样式变体
 */
export const buttonStyles = {
  /** 基础按钮 */
  base: 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
  /** 主要按钮 */
  primary: 'bg-primary text-white hover:bg-primary-light active:bg-primary-dark focus:ring-primary-400',
  /** 次要按钮 */
  secondary: 'bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 border border-neutral-300 dark:border-subtle hover:bg-neutral-200 dark:hover:bg-white/15 active:bg-neutral-300 focus:ring-neutral-400',
  /** 幽灵按钮 */
  ghost: 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/8 active:bg-neutral-200 focus:ring-neutral-400',
  /** 危险按钮 */
  danger: 'bg-danger text-white hover:bg-danger-light active:bg-danger-dark focus:ring-danger-400',
  /** 成功按钮 */
  success: 'bg-success text-white hover:bg-success-light active:bg-success-dark focus:ring-success',
  /** 链接样式按钮 */
  link: 'text-primary hover:text-primary-light active:text-primary-dark underline-offset-4 hover:underline',
  /** 尺寸 - 小 */
  sizeSmall: 'px-3 py-1.5 text-sm',
  /** 尺寸 - 中 */
  sizeMedium: 'px-4 py-2 text-sm',
  /** 尺寸 - 大 */
  sizeLarge: 'px-6 py-3 text-base',
} as const

/**
 * 徽章/标签样式变体
 */
export const badgeStyles = {
  /** 基础徽章 */
  base: 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
  /** 状态 - 默认 */
  default: 'bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-300',
  /** 状态 - 主要 */
  primary: 'bg-primary-bg text-primary-dark',
  /** 状态 - 成功 */
  success: 'bg-success-bg text-success-dark',
  /** 状态 - 警告 */
  warning: 'bg-warning-bg text-warning-dark',
  /** 状态 - 危险 */
  danger: 'bg-danger-bg text-danger-dark',
  /** 轮廓样式 */
  outline: 'bg-transparent border',
  /** 点状指示器 */
  dot: 'w-2 h-2 rounded-full',
} as const

/**
 * 输入框样式
 */
export const inputStyles = {
  /** 基础输入框 */
  base: 'w-full px-3 py-2 text-sm border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary',
  /** 默认状态 */
  default: 'border-neutral-300 dark:border-subtle bg-white dark:bg-surface-2 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500',
  /** 错误状态 */
  error: 'border-danger text-danger focus:ring-danger-400 focus:border-danger',
  /** 禁用状态 */
  disabled: 'bg-neutral-100 dark:bg-surface-2 text-neutral-500 dark:text-neutral-400 cursor-not-allowed',
} as const

/**
 * 表格样式
 */
export const tableStyles = {
  /** 表格容器 */
  container: 'bg-white dark:bg-surface-1 rounded-lg border border-neutral-200 dark:border-subtle shadow-sm dark:shadow-none overflow-hidden',
  /** 表头 */
  header: 'bg-neutral-50 dark:bg-surface-2 border-b border-neutral-200 dark:border-subtle',
  /** 表头单元格 */
  headerCell: 'px-3 py-2 text-left text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider',
  /** 表体行 */
  row: 'border-b border-neutral-100 dark:border-subtle hover:bg-neutral-50 dark:hover:bg-surface-3 transition-colors',
  /** 表体单元格 */
  cell: 'px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300',
  /** 数值单元格（右对齐） */
  cellNumeric: 'px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 text-right font-tabular',
} as const

/**
 * 长表滚动与吸顶样式
 */
export const stickyTableStyles = {
  /** 滚动容器 */
  scrollFrame:
    'overflow-auto overscroll-contain rounded-lg border border-neutral-100 bg-white/80 dark:bg-surface-1/80 dark:border-subtle',
  /** 吸顶表头 */
  header:
    'sticky top-0 z-20 bg-white dark:bg-surface-1 shadow-[inset_0_-1px_0_0_rgba(229,231,235,1)] dark:shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.06)]',
  /** 首列冻结 */
  firstColumn:
    'sticky left-0 bg-white dark:bg-surface-1 shadow-[inset_-1px_0_0_0_rgba(229,231,235,1)] dark:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.06)]',
  /** 首列表头交叉单元格 */
  firstColumnHeader:
    'sticky left-0 top-0 z-30 bg-white dark:bg-surface-1 shadow-[inset_-1px_0_0_0_rgba(229,231,235,1),inset_0_-1px_0_0_rgba(229,231,235,1)] dark:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.06),inset_0_-1px_0_0_rgba(255,255,255,0.06)]',
} as const

/**
 * 文本样式
 */
export const textStyles = {
  /** 标题 - 大 */
  titleLarge: 'text-2xl font-bold text-neutral-900 dark:text-neutral-100',
  /** 标题 - 中 */
  titleMedium: 'text-lg font-semibold text-neutral-800 dark:text-neutral-200',
  /** 标题 - 小 */
  titleSmall: 'text-base font-medium text-neutral-700 dark:text-neutral-300',
  /** 正文 */
  body: 'text-sm text-neutral-700 dark:text-neutral-300',
  /** 辅助文本 */
  caption: 'text-xs text-neutral-500 dark:text-neutral-400',
  /** 标签 */
  label: 'text-sm font-medium text-neutral-700 dark:text-neutral-300',
  /** 链接 */
  link: 'text-primary hover:text-primary-light cursor-pointer',
  /** 强调 */
  emphasis: 'font-semibold',
  /** 数值（等宽字体） */
  numeric: 'font-tabular tabular-nums',
} as const

/**
 * 字体样式扩展（用于特殊场景）
 */
export const fontStyles = {
  /** KPI 大数字（使用 Avenir/Century Gothic 风格） */
  kpi: 'font-kpi tabular-nums',
  /** 统一数字字体（图表+表格共用） */
  numeric: 'font-numeric tabular-nums',
  /** @deprecated 用 fontStyles.numeric 替代 */
  chart: 'font-numeric tabular-nums',
  /** @deprecated 用 fontStyles.numeric 替代 */
  tabular: 'font-numeric tabular-nums',
} as const

/**
 * 数字分层样式（对齐仪表盘视觉规范）
 */
export const numericStyles = {
  /** KPI 主数字 (30px — 对齐 text-3xl 阶梯) */
  kpiPrimary: 'font-kpi text-3xl tracking-tight font-bold leading-none',
  /** KPI 次级数字 (24px — 对齐 text-2xl 阶梯) */
  kpiSecondary: 'font-kpi text-2xl tracking-tight font-bold leading-none',
  /** 表格数字单元格 */
  tableValue: 'font-tabular tabular-nums text-sm text-neutral-900 dark:text-neutral-100',
  /** 表格次要数字 */
  tableSecondary: 'font-tabular tabular-nums text-sm text-neutral-500 dark:text-neutral-400',
  /** 小号数字（标签/统计） */
  captionValue: 'font-tabular tabular-nums text-xs',
} as const

/**
 * 布局样式
 */
export const layoutStyles = {
  /** 居中容器 */
  container: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
  /** Flex 居中 */
  flexCenter: 'flex items-center justify-center',
  /** Flex 两端对齐 */
  flexBetween: 'flex items-center justify-between',
  /** Flex 垂直居中 */
  flexVertical: 'flex flex-col',
  /** Grid 2列 */
  grid2: 'grid grid-cols-1 sm:grid-cols-2 gap-4',
  /** Grid 3列 */
  grid3: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4',
  /** Grid 4列 */
  grid4: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
  /** 间距容器 */
  stack: 'space-y-4',
  /** 水平间距容器 */
  row: 'flex items-center gap-4',
} as const

/**
 * 状态样式
 */
export const stateStyles = {
  /** 加载中覆盖层 */
  loadingOverlay: 'absolute inset-0 bg-white/80 dark:bg-surface-0/80 flex items-center justify-center z-10',
  /** 禁用遮罩 */
  disabledMask: 'opacity-50 pointer-events-none',
  /** 错误边框 */
  errorBorder: 'border-danger ring-2 ring-danger-200',
  /** 聚焦环 */
  focusRing: 'focus:ring-2 focus:ring-primary-400 focus:ring-offset-2',
} as const

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 合并多个 className
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * 根据条件返回样式
 */
export function conditionalStyle(
  condition: boolean,
  trueStyle: string,
  falseStyle: string = ''
): string {
  return condition ? trueStyle : falseStyle
}

/**
 * 获取趋势颜色类名（正/负/中性）
 */
export type MetricPolarity = 'positive' | 'negative'
export type TrendDirection = 'up' | 'down' | 'flat'

/**
 * 根据数值计算趋势方向
 */
export function getTrendDirection(value: number): TrendDirection {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}

/**
 * 根据趋势方向 + 指标方向返回文本颜色
 * - positive: 值越大越好（涨绿跌红）
 * - negative: 值越小越好（涨红跌绿）
 */
export function getTrendColorClassByPolarity(
  direction: TrendDirection,
  metricPolarity: MetricPolarity = 'positive'
): string {
  if (direction === 'flat') {
    return colorClasses.text.neutralMuted
  }

  const isPositiveMetricGood = direction === 'up'
  const isGoodChange =
    metricPolarity === 'positive'
      ? isPositiveMetricGood
      : !isPositiveMetricGood

  return isGoodChange ? colorClasses.text.success : colorClasses.text.danger
}

/**
 * 获取趋势颜色类名（兼容旧 inverse 参数）
 */
export function getTrendColorClass(value: number, inverseOrPolarity: boolean | MetricPolarity = false): string {
  const metricPolarity: MetricPolarity = typeof inverseOrPolarity === 'boolean'
    ? (inverseOrPolarity ? 'negative' : 'positive')
    : inverseOrPolarity

  return getTrendColorClassByPolarity(getTrendDirection(value), metricPolarity)
}

/**
 * 获取状态颜色类名
 */
export function getStatusColorClass(
  status: 'success' | 'warning' | 'danger' | 'default' | 'primary'
): string {
  const statusMap = {
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    primary: 'text-primary',
    default: 'text-neutral-600',
  }
  return statusMap[status] || statusMap.default
}

/**
 * 获取背景状态颜色类名
 */
export function getStatusBgClass(
  status: 'success' | 'warning' | 'danger' | 'default' | 'primary'
): string {
  const statusMap = {
    success: 'bg-success-bg',
    warning: 'bg-warning-bg',
    danger: 'bg-danger-bg',
    primary: 'bg-primary-bg',
    default: 'bg-neutral-100',
  }
  return statusMap[status] || statusMap.default
}

// ============================================================================
// Tailwind 颜色类名常量（语义化映射）
// ============================================================================

/**
 * 颜色替换映射表：硬编码 Tailwind 类 → 设计系统类
 *
 * 使用示例：
 *   旧代码：className="text-red-800"
 *   新代码：className={colorClasses.text.danger}
 */
export const colorClasses = {
  /**
   * 文本颜色
   * 语义色走 CSS 变量（自动适配 dark mode），无需 dark: 前缀
   * 中性色仍需手动 dark: 前缀（静态色阶）
   */
  text: {
    // 语义色 — CSS 变量自动 dark mode
    danger: 'text-danger',
    dangerDark: 'text-danger-dark',
    dangerLight: 'text-danger-light',
    success: 'text-success',
    successDark: 'text-success-dark',
    positive: 'text-success',
    warning: 'text-warning',
    warningDark: 'text-warning-dark',
    primary: 'text-primary',
    primaryDark: 'text-primary-dark',
    purple: 'text-purple',
    indigo: 'text-indigo',
    sky: 'text-sky',
    orange: 'text-orange',
    amber: 'text-amber',
    // 增长率专用（映射到语义色）
    growthPositive: 'text-success',
    growthNegative: 'text-danger-light',
    // 中性色 — 静态色阶，需 dark: 前缀
    neutralBlack: 'text-neutral-900 dark:text-neutral-100',
    neutral: 'text-neutral-600 dark:text-neutral-400',
    neutralDark: 'text-neutral-700 dark:text-neutral-300',
    neutralLight: 'text-neutral-500 dark:text-neutral-400',
    neutralMuted: 'text-neutral-400 dark:text-neutral-500',
  },
  /**
   * 背景颜色
   * 语义色走 CSS 变量（自动适配 dark mode）
   */
  bg: {
    // 语义色 — CSS 变量自动 dark mode
    danger: 'bg-danger-bg',
    dangerSolid: 'bg-danger-solid',
    success: 'bg-success-bg',
    successSolid: 'bg-success-solid',
    warning: 'bg-warning-bg',
    warningSolid: 'bg-warning-solid',
    primary: 'bg-primary-bg',
    primarySolid: 'bg-primary-solid',
    purple: 'bg-purple-bg',
    indigo: 'bg-indigo-bg',
    sky: 'bg-sky-bg',
    orange: 'bg-orange-bg',
    amber: 'bg-amber-bg',
    // 中性色 — 静态色阶，需 dark: 前缀
    neutral: 'bg-neutral-50 dark:bg-surface-2',
    neutralLight: 'bg-neutral-100 dark:bg-surface-3',
    neutralMuted: 'bg-neutral-50 dark:bg-surface-2',
  },
  /**
   * 边框颜色
   * 语义色走 CSS 变量（自动适配 dark mode）
   */
  border: {
    // 语义色 — CSS 变量自动 dark mode
    danger: 'border-danger-border',
    success: 'border-success-border',
    warning: 'border-warning-border',
    primary: 'border-primary-border',
    purple: 'border-purple-border',
    indigo: 'border-indigo-border',
    orange: 'border-orange-border',
    sky: 'border-sky-border',
    amber: 'border-amber-border',
    // 中性色 — 静态色阶，需 dark: 前缀
    neutral: 'border-neutral-200 dark:border-subtle',
  },
} as const

// ============================================================================
// 报价转化分析专用颜色（DC-003 合规）
// ============================================================================

/** ECharts 图表色值（hex，用于 ECharts option） */
export const quoteChartColors = {
  /** 报价量柱 - 中性灰 */
  quoteBar: '#94a3b8',
  /** 报价量柱 - 浅灰（时间趋势） */
  quoteBarLight: '#e2e8f0',
  /** 承保量柱 - 蓝色 */
  insuredBar: '#3b82f6',
  /** 转化率线 - 绿色 */
  conversionLine: '#10b981',
  /** 续保转化率线 - 蓝色 */
  renewalLine: '#3b82f6',
  /** 转保转化率线 - 琥珀色 */
  switchLine: '#f59e0b',
} as const

/** 漏斗层级背景色（L1→L4 渐进） */
export const funnelLevelColors = [
  'bg-primary-600',
  'bg-primary-400',
  'bg-success-light',
  'bg-success',
] as const

/** 热力图转化率→背景色映射（使用语义色，自动适配 dark mode） */
export function getHeatmapColor(rate: number): string {
  if (rate >= 15) return 'bg-success-solid text-white'
  if (rate >= 10) return 'bg-success-border text-neutral-900'
  if (rate >= 7) return 'bg-success-bg text-neutral-800'
  if (rate >= 4) return 'bg-amber-bg text-neutral-800'
  if (rate >= 1) return 'bg-danger-bg text-neutral-800'
  return 'bg-danger-border text-neutral-800'
}

/** 维度/粒度切换按钮样式（选中/未选中） */
export const toggleButtonStyles = {
  active: 'bg-neutral-800 text-white dark:bg-white/15 dark:text-neutral-100',
  inactive: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-transparent dark:text-neutral-400 dark:hover:bg-white/8',
} as const

/**
 * 获取年份图表颜色（替代硬编码年份颜色）
 */
export function getYearChartColor(year: string | number): string {
  const yearStr = String(year)
  const yearMap: Record<string, string> = {
    '2023': semanticColors.chart.year2023,
    '2024': semanticColors.chart.year2024,
    '2025': semanticColors.chart.year2025,
    '2026': semanticColors.chart.year2026,
    '2027': semanticColors.chart.year2027,
    '2028': semanticColors.chart.year2028,
  }
  return yearMap[yearStr] || colors.primary.DEFAULT
}
