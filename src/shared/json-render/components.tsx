/**
 * JSON Render 组件注册表
 *
 * 将 catalog 中定义的组件映射到实际的 React 实现。
 * 这些组件会被 AI 生成的 JSON 渲染出来。
 */

import type { ReactNode } from 'react'
import type { ComponentRegistry, ComponentRenderProps } from '@json-render/react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart as EBarChart, LineChart as ELineChart, PieChart as EPieChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  FileText,
} from 'lucide-react'
import {
  cardStyles,
  textStyles,
  buttonStyles,
  badgeStyles,
  tableStyles,
  layoutStyles,
  cn,
  getTrendColorClass,
} from '../styles'
import type { MetricPolarity } from '../styles'
import { formatPercent, formatCount, formatPremiumWan } from '../utils/formatters'
import { useTheme } from '../theme'
import { getChartTheme } from '../config/chartStyles'

// 注册 ECharts 组件
echarts.use([
  EBarChart,
  ELineChart,
  EPieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
])

/** 获取图表 dark 主题（供 json-render 图表组件复用） */
function useChartDarkTheme() {
  const { resolvedTheme } = useTheme()
  return getChartTheme(resolvedTheme === 'dark')
}

// ============================================================================
// 类型定义
// ============================================================================

/** 表格列定义 */
interface TableColumn {
  key: string
  title: string
  align?: 'left' | 'center' | 'right'
  format?: 'text' | 'number' | 'percent' | 'currency'
}

/** 图表数据项 */
interface ChartDataItem {
  name: string
  value: number
  group?: string
}

/** 折线图数据项 */
interface LineChartDataItem {
  x: string | number
  y: number
  series?: string
}

/** 饼图数据项 */
interface PieChartDataItem {
  name: string
  value: number
}

// ============================================================================
// 组件注册表
// ============================================================================

export const componentRegistry: ComponentRegistry = {
  // --------------------------------------------------------------------------
  // 布局组件
  // --------------------------------------------------------------------------

  Card: ({ element, children }: ComponentRenderProps) => {
    const { title, subtitle, variant = 'base' } = element.props as {
      title?: string
      subtitle?: string
      variant?: 'base' | 'compact' | 'spacious'
    }
    const variantClass = {
      base: cardStyles.base,
      compact: cardStyles.compact,
      spacious: cardStyles.spacious,
    }[variant] || cardStyles.base

    return (
      <div className={cn(variantClass, 'p-4')}>
        {(title || subtitle) && (
          <div className="mb-3">
            {title && <h3 className={textStyles.titleMedium}>{title}</h3>}
            {subtitle && <p className={cn(textStyles.caption, 'mt-1')}>{subtitle}</p>}
          </div>
        )}
        <div>{children}</div>
      </div>
    )
  },

  Grid: ({ element, children }: ComponentRenderProps) => {
    const { columns = 2, gap = 'md' } = element.props as {
      columns?: number
      gap?: 'sm' | 'md' | 'lg'
    }
    const gapClass = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' }[gap] || 'gap-4'
    const colsClass = {
      1: 'grid-cols-1',
      2: 'grid-cols-1 sm:grid-cols-2',
      3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
      5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5',
      6: 'grid-cols-1 sm:grid-cols-3 lg:grid-cols-6',
    }[columns] || 'grid-cols-2'

    return <div className={cn('grid', colsClass, gapClass)}>{children}</div>
  },

  Stack: ({ element, children }: ComponentRenderProps) => {
    const { direction = 'vertical', gap = 'md', align = 'left' } = element.props as {
      direction?: 'vertical' | 'horizontal'
      gap?: 'sm' | 'md' | 'lg'
      align?: 'left' | 'center' | 'right'
    }
    const gapClass = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' }[gap] || 'gap-4'
    const alignClass = {
      left: 'items-start',
      center: 'items-center',
      right: 'items-end',
    }[align] || 'items-start'
    const dirClass = direction === 'horizontal' ? 'flex-row' : 'flex-col'

    return <div className={cn('flex', dirClass, gapClass, alignClass)}>{children}</div>
  },

  // --------------------------------------------------------------------------
  // 数据展示组件
  // --------------------------------------------------------------------------

  KpiCard: ({ element }: ComponentRenderProps) => {
    const {
      title,
      value,
      unit,
      trend,
      trendLabel,
      variant = 'default',
      metricPolarity = 'positive',
    } = element.props as {
      title: string
      value: string | number
      unit?: string
      trend?: number
      trendLabel?: string
      variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
      metricPolarity?: MetricPolarity
    }
    const variantColorMap: Record<string, string> = {
      default: 'border-neutral-200',
      primary: 'border-primary-300 bg-primary-50',
      success: 'border-success-300 bg-success-bg',
      warning: 'border-warning-300 bg-warning-bg',
      danger: 'border-danger-300 bg-danger-bg',
    }
    const borderColor = variantColorMap[variant] || variantColorMap.default

    return (
      <div className={cn(cardStyles.base, borderColor, 'p-4')}>
        <div className={cn(textStyles.caption, 'mb-2')}>{title}</div>
        <div className="flex items-baseline gap-1">
          <span className={cn(textStyles.titleLarge, textStyles.numeric)}>{value}</span>
          {unit && <span className={textStyles.caption}>{unit}</span>}
        </div>
        {trend !== undefined && (
          <div className={cn('flex items-center gap-1 mt-2', getTrendColorClass(trend, metricPolarity))}>
            {trend > 0 ? <TrendingUp size={14} /> : trend < 0 ? <TrendingDown size={14} /> : <Minus size={14} />}
            <span className={cn(textStyles.caption, textStyles.numeric)}>
              {formatPercent(Math.abs(trend))}
            </span>
            {trendLabel && <span className={textStyles.caption}>{trendLabel}</span>}
          </div>
        )}
      </div>
    )
  },

  DataTable: ({ element }: ComponentRenderProps) => {
    const { columns = [], data = [], title, pageSize = 10 } = element.props as {
      columns?: TableColumn[]
      data?: Record<string, unknown>[]
      title?: string
      pageSize?: number
    }

    // 空数据检查
    if (!data || data.length === 0 || !columns || columns.length === 0) {
      return (
        <div className={tableStyles.container}>
          {title && (
            <div className="px-4 py-3 border-b border-neutral-200 dark:border-subtle">
              <h3 className={textStyles.titleSmall}>{title}</h3>
            </div>
          )}
          <div className="px-4 py-8 text-center text-neutral-400">
            暂无数据
          </div>
        </div>
      )
    }

    const formatCell = (value: unknown, format?: string): string => {
      if (value === null || value === undefined) return '-'
      switch (format) {
        case 'number': return formatCount(Number(value))
        case 'percent': return formatPercent(Number(value))
        case 'currency': return formatPremiumWan(Number(value))
        default: return String(value)
      }
    }

    return (
      <div className={tableStyles.container}>
        {title && (
          <div className="px-4 py-3 border-b border-neutral-200 dark:border-subtle">
            <h3 className={textStyles.titleSmall}>{title}</h3>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className={tableStyles.header}>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      tableStyles.headerCell,
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center'
                    )}
                  >
                    {col.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, pageSize).map((row, idx) => (
                <tr key={idx} className={tableStyles.row}>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        col.format && ['number', 'percent', 'currency'].includes(col.format)
                          ? tableStyles.cellNumeric
                          : tableStyles.cell,
                        col.align === 'center' && 'text-center'
                      )}
                    >
                      {formatCell(row[col.key], col.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.length > pageSize && (
          <div className="px-4 py-2 text-sm text-neutral-500 border-t border-neutral-200 dark:border-subtle">
            显示 {pageSize} / {data.length} 条
          </div>
        )}
      </div>
    )
  },

  BarChart: ({ element }: ComponentRenderProps) => {
    const { title, data = [], xAxisLabel, yAxisLabel, showLegend = true, stacked = false, horizontal = false } = element.props as {
      title?: string
      data?: ChartDataItem[]
      xAxisLabel?: string
      yAxisLabel?: string
      showLegend?: boolean
      stacked?: boolean
      horizontal?: boolean
    }

    // 空数据检查
    if (!data || data.length === 0) {
      return (
        <div className={cn(cardStyles.base, 'p-4')}>
          {title && <h3 className={cn(textStyles.titleSmall, 'mb-4')}>{title}</h3>}
          <div className="h-[300px] flex items-center justify-center text-neutral-400">暂无数据</div>
        </div>
      )
    }

    // 处理分组数据
    const groups = [...new Set(data.map(d => d.group).filter(Boolean))] as string[]
    const hasGroups = groups.length > 0
    const categories = [...new Set(data.map(d => d.name))]

    const series = hasGroups
      ? groups.map(group => ({
          name: group,
          type: 'bar' as const,
          stack: stacked ? 'total' : undefined,
          data: categories.map(cat => {
            const item = data.find(d => d.name === cat && d.group === group)
            return item?.value || 0
          }),
        }))
      : [{
          type: 'bar' as const,
          data: data.map(d => d.value),
        }]

    const theme = useChartDarkTheme()

    const option = {
      title: title ? { text: title, left: 'center', textStyle: { ...theme.chartTextStyles.title, fontSize: 14 } } : undefined,
      tooltip: { ...theme.tooltipConfig, trigger: 'axis' as const },
      legend: showLegend && hasGroups ? { bottom: 0, textStyle: { color: theme.textColors.secondary } } : undefined,
      grid: { left: '3%', right: '4%', bottom: showLegend ? '15%' : '3%', containLabel: true },
      xAxis: {
        type: (horizontal ? 'value' : 'category') as 'value' | 'category',
        data: horizontal ? undefined : categories,
        name: xAxisLabel,
        ...theme.xAxisConfig,
      },
      yAxis: {
        type: (horizontal ? 'category' : 'value') as 'value' | 'category',
        data: horizontal ? categories : undefined,
        name: yAxisLabel,
        ...theme.yAxisConfig,
        splitLine: { show: false },
      },
      series,
    }

    return <ReactEChartsCore echarts={echarts} option={option} style={{ height: 300 }} />
  },

  LineChart: ({ element }: ComponentRenderProps) => {
    const { title, data = [], xAxisLabel, yAxisLabel, showLegend = true, smooth = true, showArea = false } = element.props as {
      title?: string
      data?: LineChartDataItem[]
      xAxisLabel?: string
      yAxisLabel?: string
      showLegend?: boolean
      smooth?: boolean
      showArea?: boolean
    }

    // 空数据检查
    if (!data || data.length === 0) {
      return (
        <div className={cn(cardStyles.base, 'p-4')}>
          {title && <h3 className={cn(textStyles.titleSmall, 'mb-4')}>{title}</h3>}
          <div className="h-[300px] flex items-center justify-center text-neutral-400">暂无数据</div>
        </div>
      )
    }

    const seriesNames = [...new Set(data.map(d => d.series).filter(Boolean))] as string[]
    const hasMultipleSeries = seriesNames.length > 0
    const xData = [...new Set(data.map(d => d.x))]

    const series = hasMultipleSeries
      ? seriesNames.map(name => ({
          name,
          type: 'line' as const,
          smooth,
          areaStyle: showArea ? {} : undefined,
          data: xData.map(x => {
            const item = data.find(d => d.x === x && d.series === name)
            return item?.y || 0
          }),
        }))
      : [{
          type: 'line' as const,
          smooth,
          areaStyle: showArea ? {} : undefined,
          data: data.map(d => d.y),
        }]

    const theme = useChartDarkTheme()

    const option = {
      title: title ? { text: title, left: 'center', textStyle: { ...theme.chartTextStyles.title, fontSize: 14 } } : undefined,
      tooltip: { ...theme.tooltipConfig, trigger: 'axis' as const },
      legend: showLegend && hasMultipleSeries ? { bottom: 0, textStyle: { color: theme.textColors.secondary } } : undefined,
      grid: { left: '3%', right: '4%', bottom: showLegend ? '15%' : '3%', containLabel: true },
      xAxis: { type: 'category' as const, data: xData, name: xAxisLabel, ...theme.xAxisConfig },
      yAxis: { type: 'value' as const, name: yAxisLabel, ...theme.yAxisConfig, splitLine: { show: false } },
      series,
    }

    return <ReactEChartsCore echarts={echarts} option={option} style={{ height: 300 }} />
  },

  PieChart: ({ element }: ComponentRenderProps) => {
    const { title, data = [], showLegend = true, donut = false, showLabel = true } = element.props as {
      title?: string
      data?: PieChartDataItem[]
      showLegend?: boolean
      donut?: boolean
      showLabel?: boolean
    }

    // 空数据检查
    if (!data || data.length === 0) {
      return (
        <div className={cn(cardStyles.base, 'p-4')}>
          {title && <h3 className={cn(textStyles.titleSmall, 'mb-4')}>{title}</h3>}
          <div className="h-[300px] flex items-center justify-center text-neutral-400">暂无数据</div>
        </div>
      )
    }

    const theme = useChartDarkTheme()

    const option = {
      title: title ? { text: title, left: 'center', textStyle: { ...theme.chartTextStyles.title, fontSize: 14 } } : undefined,
      tooltip: { ...theme.tooltipConfig, trigger: 'item' as const, formatter: '{b}: {c} ({d}%)' },
      legend: showLegend ? { bottom: 0, textStyle: { color: theme.textColors.secondary } } : undefined,
      series: [{
        type: 'pie' as const,
        radius: donut ? ['40%', '70%'] : '70%',
        center: ['50%', '50%'],
        data: data.map(d => ({ name: d.name, value: d.value })),
        label: { show: showLabel },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      }],
    }

    return <ReactEChartsCore echarts={echarts} option={option} style={{ height: 300 }} />
  },

  // --------------------------------------------------------------------------
  // 文本和状态组件
  // --------------------------------------------------------------------------

  Text: ({ element }: ComponentRenderProps) => {
    const { content, variant = 'body', color, align = 'left' } = element.props as {
      content: string
      variant?: 'title-large' | 'title-medium' | 'title-small' | 'body' | 'caption' | 'label'
      color?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
      align?: 'left' | 'center' | 'right'
    }
    const variantClass: Record<string, string> = {
      'title-large': textStyles.titleLarge,
      'title-medium': textStyles.titleMedium,
      'title-small': textStyles.titleSmall,
      'body': textStyles.body,
      'caption': textStyles.caption,
      'label': textStyles.label,
    }

    const colorClassMap: Record<string, string> = {
      default: 'text-neutral-700',
      primary: 'text-primary',
      success: 'text-success',
      warning: 'text-warning',
      danger: 'text-danger',
    }

    const alignClass: Record<string, string> = {
      left: 'text-left',
      center: 'text-center',
      right: 'text-right',
    }

    return (
      <p className={cn(
        variantClass[variant] || textStyles.body,
        color ? colorClassMap[color] : '',
        alignClass[align]
      )}>
        {content}
      </p>
    )
  },

  Badge: ({ element }: ComponentRenderProps) => {
    const { text, variant = 'default', size = 'md' } = element.props as {
      text: string
      variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
      size?: 'sm' | 'md' | 'lg'
    }
    const variantClass: Record<string, string> = {
      default: badgeStyles.default,
      primary: badgeStyles.primary,
      success: badgeStyles.success,
      warning: badgeStyles.warning,
      danger: badgeStyles.danger,
    }

    const sizeClass: Record<string, string> = {
      sm: 'px-1.5 py-0.5 text-xs',
      md: 'px-2 py-0.5 text-xs',
      lg: 'px-2.5 py-1 text-sm',
    }

    return (
      <span className={cn(
        badgeStyles.base,
        variantClass[variant] || badgeStyles.default,
        sizeClass[size] || sizeClass.md
      )}>
        {text}
      </span>
    )
  },

  TrendIndicator: ({ element }: ComponentRenderProps) => {
    const { value, label, inverse = false, metricPolarity, format = 'percent' } = element.props as {
      value: number
      label?: string
      inverse?: boolean
      metricPolarity?: MetricPolarity
      format?: 'percent' | 'number'
    }
    const effectivePolarity = metricPolarity ?? (inverse ? 'negative' : 'positive')
    const colorClass = getTrendColorClass(value, effectivePolarity)
    const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus
    const formattedValue = format === 'percent'
      ? formatPercent(Math.abs(value))
      : formatCount(Math.abs(value))

    return (
      <div className={cn('flex items-center gap-1', colorClass)}>
        <Icon size={14} />
        <span className={textStyles.numeric}>{formattedValue}</span>
        {label && <span className={textStyles.caption}>{label}</span>}
      </div>
    )
  },

  Progress: ({ element }: ComponentRenderProps) => {
    const { value, max = 100, label, showValue = true, variant = 'primary', size = 'md' } = element.props as {
      value: number
      max?: number
      label?: string
      showValue?: boolean
      variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
      size?: 'sm' | 'md' | 'lg'
    }
    const percentage = Math.min(100, Math.max(0, (value / max) * 100))
    const colorClass: Record<string, string> = {
      default: 'bg-neutral-500',
      primary: 'bg-primary',
      success: 'bg-success',
      warning: 'bg-warning',
      danger: 'bg-danger',
    }

    const heightClass: Record<string, string> = {
      sm: 'h-1',
      md: 'h-2',
      lg: 'h-3',
    }

    return (
      <div className="w-full">
        {(label || showValue) && (
          <div className={cn(layoutStyles.flexBetween, 'mb-1')}>
            {label && <span className={textStyles.caption}>{label}</span>}
            {showValue && (
              <span className={cn(textStyles.caption, textStyles.numeric)}>
                {formatPercent(percentage)}
              </span>
            )}
          </div>
        )}
        <div className={cn('w-full bg-neutral-200 dark:bg-white/10 rounded-full', heightClass[size] || heightClass.md)}>
          <div
            className={cn(colorClass[variant] || colorClass.primary, 'rounded-full transition-all', heightClass[size] || heightClass.md)}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    )
  },

  // --------------------------------------------------------------------------
  // 交互组件
  // --------------------------------------------------------------------------

  Button: ({ element, onAction }: ComponentRenderProps) => {
    const { text, variant = 'primary', size = 'md', disabled = false } = element.props as {
      text: string
      variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
      size?: 'sm' | 'md' | 'lg'
      disabled?: boolean
    }
    const variantClass: Record<string, string> = {
      primary: buttonStyles.primary,
      secondary: buttonStyles.secondary,
      ghost: buttonStyles.ghost,
      danger: buttonStyles.danger,
    }

    const sizeClass: Record<string, string> = {
      sm: buttonStyles.sizeSmall,
      md: buttonStyles.sizeMedium,
      lg: buttonStyles.sizeLarge,
    }

    return (
      <button
        className={cn(
          buttonStyles.base,
          variantClass[variant] || buttonStyles.primary,
          sizeClass[size] || buttonStyles.sizeMedium
        )}
        disabled={disabled}
        onClick={() => onAction?.({ name: 'buttonClick', params: {} })}
      >
        {text}
      </button>
    )
  },

  Empty: ({ element }: ComponentRenderProps) => {
    const { title = '暂无数据', description } = element.props as {
      title?: string
      description?: string
    }
    return (
      <div className={cn(layoutStyles.flexCenter, 'flex-col py-12 text-center')}>
        <FileText size={48} className="text-neutral-300 mb-4" />
        <h3 className={textStyles.titleSmall}>{title}</h3>
        {description && <p className={cn(textStyles.caption, 'mt-2')}>{description}</p>}
      </div>
    )
  },

  Loading: ({ element }: ComponentRenderProps) => {
    const { text = '加载中...', size = 'md' } = element.props as {
      text?: string
      size?: 'sm' | 'md' | 'lg'
    }
    const sizeMap: Record<string, number> = { sm: 16, md: 24, lg: 32 }
    const iconSize = sizeMap[size] || 24

    return (
      <div className={cn(layoutStyles.flexCenter, 'py-8 gap-2')}>
        <Loader2 size={iconSize} className="animate-spin text-primary" />
        <span className={textStyles.body}>{text}</span>
      </div>
    )
  },
}

/** 渲染子元素的辅助类型 */
export type RenderChildren = (keys: string[]) => ReactNode
