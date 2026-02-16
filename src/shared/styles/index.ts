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
    bg: '#f6ffed',
    border: '#b7eb8f',
  },
  // 警告色 - 橙色系（用于警示、注意事项）
  warning: {
    DEFAULT: '#faad14',
    light: '#ffc53d',
    dark: '#d48806',
    bg: '#fffbe6',
    border: '#ffe58f',
  },
  // 危险色 - 红色系（用于错误、负面状态、下降指标）
  danger: {
    DEFAULT: '#ff4d4f',
    light: '#ff7875',
    dark: '#d9363e',
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
} as const

// ============================================================================
// 语义化颜色扩展（用于状态指示、图表等）
// ============================================================================

export const semanticColors = {
  /** 状态 - 成功/增长 */
  positive: {
    DEFAULT: '#10B981',      // emerald-500
    light: '#34D399',        // emerald-400
    dark: '#059669',         // emerald-600
    bg: '#D1FAE5',           // emerald-100
    text: '#065F46',         // emerald-800
  },
  /** 状态 - 负面/下降 */
  negative: {
    DEFAULT: '#EF4444',      // red-500
    light: '#F87171',        // red-400
    dark: '#DC2626',         // red-600
    bg: '#FEE2E2',           // red-100
    text: '#991B1B',         // red-800
  },
  /** 状态 - 信息/主要 */
  info: {
    DEFAULT: '#3B82F6',      // blue-500
    light: '#60A5FA',        // blue-400
    dark: '#2563EB',         // blue-600
    bg: '#DBEAFE',           // blue-100
    text: '#1E40AF',         // blue-800
  },
  /** 图表专用年份颜色（避免硬编码） */
  chart: {
    year2024: '#FF6B6B',
    year2025: '#4ECDC4',
    year2026: '#95E1D3',
    year2027: '#F38181',
    year2028: '#AA96DA',
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
  base: 'bg-white rounded-lg border border-neutral-200 shadow-sm',
  /** 可交互卡片（带hover效果） */
  interactive: 'bg-white rounded-lg border border-neutral-200 shadow-sm hover:shadow-md transition-shadow',
  /** 紧凑卡片 */
  compact: 'bg-white rounded-lg border border-neutral-200 shadow-sm p-3',
  /** 标准卡片 */
  standard: 'bg-white rounded-lg border border-neutral-200 shadow-sm p-4',
  /** 宽松卡片 */
  spacious: 'bg-white rounded-lg border border-neutral-200 shadow-sm p-6',
  /** 深色模式卡片 */
  dark: 'dark:bg-neutral-800 dark:border-neutral-700',
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
  secondary: 'bg-neutral-100 text-neutral-700 border border-neutral-300 hover:bg-neutral-200 active:bg-neutral-300 focus:ring-neutral-400',
  /** 幽灵按钮 */
  ghost: 'text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 focus:ring-neutral-400',
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
  default: 'bg-neutral-100 text-neutral-700',
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
  default: 'border-neutral-300 bg-white text-neutral-900 placeholder-neutral-400',
  /** 错误状态 */
  error: 'border-danger text-danger focus:ring-danger-400 focus:border-danger',
  /** 禁用状态 */
  disabled: 'bg-neutral-100 text-neutral-500 cursor-not-allowed',
  /** 深色模式 */
  dark: 'dark:bg-neutral-800 dark:border-neutral-600 dark:text-neutral-100 dark:placeholder-neutral-500',
} as const

/**
 * 表格样式
 */
export const tableStyles = {
  /** 表格容器 */
  container: 'bg-white rounded-lg border border-neutral-200 shadow-sm overflow-hidden',
  /** 表头 */
  header: 'bg-neutral-50 border-b border-neutral-200',
  /** 表头单元格 */
  headerCell: 'px-3 py-2 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider',
  /** 表体行 */
  row: 'border-b border-neutral-100 hover:bg-neutral-50 transition-colors',
  /** 表体单元格 */
  cell: 'px-3 py-2 text-sm text-neutral-700',
  /** 数值单元格（右对齐） */
  cellNumeric: 'px-3 py-2 text-sm text-neutral-700 text-right font-mono',
  /** 深色模式 */
  dark: 'dark:bg-neutral-800 dark:border-neutral-700',
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
  numeric: 'font-mono tabular-nums',
} as const

/**
 * 字体样式扩展（用于特殊场景）
 */
export const fontStyles = {
  /** KPI 大数字（使用 Avenir/Century Gothic 风格） */
  kpi: 'font-sans tabular-nums',
  /** 图表数字 */
  chart: 'font-sans tabular-nums',
  /** 等宽数字（表格对齐） */
  tabular: 'font-mono tabular-nums',
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
  loadingOverlay: 'absolute inset-0 bg-white/80 dark:bg-neutral-900/80 flex items-center justify-center z-10',
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
export function getTrendColorClass(value: number, inverse = false): string {
  if (value === 0) return 'text-neutral-500'
  const isPositive = inverse ? value < 0 : value > 0
  return isPositive ? 'text-success' : 'text-danger'
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
  /** 文本颜色 */
  text: {
    // 危险/错误/负面
    danger: 'text-danger dark:text-danger-light',
    dangerDark: 'text-danger-dark dark:text-danger',
    dangerLight: 'text-red-500 dark:text-red-400',
    // 成功/增长/正面
    success: 'text-success dark:text-success-light',
    successDark: 'text-success-dark dark:text-success',
    positive: 'text-emerald-600 dark:text-emerald-400',
    // 警告
    warning: 'text-warning dark:text-warning-light',
    warningDark: 'text-warning-dark dark:text-warning',
    // 主色
    primary: 'text-primary dark:text-primary-light',
    primaryDark: 'text-primary-dark dark:text-primary',
    // 中性色
    neutral: 'text-neutral-600 dark:text-neutral-400',
    neutralDark: 'text-neutral-700 dark:text-neutral-300',
    neutralLight: 'text-neutral-500 dark:text-neutral-400',
    neutralMuted: 'text-neutral-400 dark:text-neutral-500',
    // 增长率专用
    growthPositive: 'text-emerald-600 dark:text-emerald-400',
    growthNegative: 'text-red-500 dark:text-red-400',
  },
  /** 背景颜色 */
  bg: {
    // 危险/错误
    danger: 'bg-danger-bg dark:bg-red-900/30',
    dangerHover: 'hover:bg-red-100 dark:hover:bg-red-900/40',
    dangerSolid: 'bg-red-100 dark:bg-red-900/20',
    // 成功/正面
    success: 'bg-success-bg dark:bg-green-900/30',
    successHover: 'hover:bg-green-100 dark:hover:bg-green-900/40',
    successSolid: 'bg-green-100 dark:bg-green-900/20',
    // 警告
    warning: 'bg-warning-bg dark:bg-yellow-900/30',
    warningSolid: 'bg-yellow-100 dark:bg-yellow-900/20',
    // 主色
    primary: 'bg-primary-bg dark:bg-blue-900/30',
    primarySolid: 'bg-blue-100 dark:bg-blue-900/20',
    // 中性色
    neutral: 'bg-neutral-50 dark:bg-neutral-800',
    neutralLight: 'bg-neutral-100 dark:bg-neutral-700',
    neutralMuted: 'bg-gray-50 dark:bg-neutral-800',
  },
  /** 边框颜色 */
  border: {
    danger: 'border-red-200 dark:border-red-800',
    success: 'border-green-200 dark:border-green-800',
    warning: 'border-yellow-200 dark:border-yellow-800',
    primary: 'border-blue-200 dark:border-blue-800',
    neutral: 'border-neutral-200 dark:border-neutral-700',
  },
} as const

/**
 * 获取年份图表颜色（替代硬编码年份颜色）
 */
export function getYearChartColor(year: string | number): string {
  const yearStr = String(year)
  const yearMap: Record<string, string> = {
    '2024': semanticColors.chart.year2024,
    '2025': semanticColors.chart.year2025,
    '2026': semanticColors.chart.year2026,
    '2027': semanticColors.chart.year2027,
    '2028': semanticColors.chart.year2028,
  }
  return yearMap[yearStr] || colors.primary.DEFAULT
}
