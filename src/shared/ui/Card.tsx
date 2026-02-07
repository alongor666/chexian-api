/**
 * Card 卡片组件
 * 统一的卡片容器组件，支持多种变体和尺寸
 */
import { memo, forwardRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../styles'

export type CardVariant = 'default' | 'interactive' | 'flat' | 'elevated'
export type CardPadding = 'none' | 'compact' | 'standard' | 'spacious'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 卡片变体 */
  variant?: CardVariant
  /** 内边距 */
  padding?: CardPadding
  /** 标题 */
  title?: ReactNode
  /** 副标题 */
  subtitle?: ReactNode
  /** 右侧操作区 */
  extra?: ReactNode
  /** 是否显示加载状态 */
  loading?: boolean
  /** 子内容 */
  children?: ReactNode
  /** 自定义类名 */
  className?: string
  /** 头部区域自定义类名 */
  headerClassName?: string
  /** 内容区域自定义类名 */
  bodyClassName?: string
}

const variantStyles: Record<CardVariant, string> = {
  default: 'bg-white rounded-lg border border-neutral-200 shadow-sm dark:bg-neutral-800 dark:border-neutral-700',
  interactive: 'bg-white rounded-lg border border-neutral-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer dark:bg-neutral-800 dark:border-neutral-700',
  flat: 'bg-white rounded-lg border border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700',
  elevated: 'bg-white rounded-lg shadow-card dark:bg-neutral-800',
}

const paddingStyles: Record<CardPadding, string> = {
  none: '',
  compact: 'p-3',
  standard: 'p-4',
  spacious: 'p-6',
}

/**
 * 卡片头部组件
 */
const CardHeader = memo(function CardHeader({
  title,
  subtitle,
  extra,
  className,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  extra?: ReactNode
  className?: string
}) {
  if (!title && !subtitle && !extra) return null

  return (
    <div className={cn('flex items-start justify-between mb-4', className)}>
      <div className="flex-1 min-w-0">
        {title && (
          <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 truncate">
            {title}
          </h3>
        )}
        {subtitle && (
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {subtitle}
          </p>
        )}
      </div>
      {extra && <div className="flex-shrink-0 ml-4">{extra}</div>}
    </div>
  )
})

/**
 * 卡片加载状态遮罩
 */
const CardLoading = memo(function CardLoading() {
  return (
    <div className="absolute inset-0 bg-white/80 dark:bg-neutral-900/80 flex items-center justify-center z-10 rounded-lg">
      <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
    </div>
  )
})

/**
 * 通用卡片组件
 *
 * @example
 * // 基础卡片
 * <Card padding="standard">内容</Card>
 *
 * @example
 * // 带标题的卡片
 * <Card title="标题" subtitle="描述" extra={<Button>操作</Button>}>
 *   内容
 * </Card>
 *
 * @example
 * // 可交互卡片
 * <Card variant="interactive" onClick={handleClick}>
 *   点击卡片
 * </Card>
 */
export const Card = memo(
  forwardRef<HTMLDivElement, CardProps>(function Card(
    {
      variant = 'default',
      padding = 'standard',
      title,
      subtitle,
      extra,
      loading = false,
      children,
      className,
      headerClassName,
      bodyClassName,
      ...props
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'relative',
          variantStyles[variant],
          paddingStyles[padding],
          className
        )}
        {...props}
      >
        {loading && <CardLoading />}
        <CardHeader
          title={title}
          subtitle={subtitle}
          extra={extra}
          className={headerClassName}
        />
        {children && (
          <div className={cn(bodyClassName)}>{children}</div>
        )}
      </div>
    )
  })
)

/**
 * 卡片分隔线
 */
export const CardDivider = memo(function CardDivider({
  className,
}: {
  className?: string
}) {
  return (
    <div
      className={cn(
        '-mx-4 my-4 border-t border-neutral-200 dark:border-neutral-700',
        className
      )}
    />
  )
})

/**
 * 卡片底部操作区
 */
export const CardFooter = memo(function CardFooter({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 pt-4 mt-4 border-t border-neutral-200 dark:border-neutral-700',
        className
      )}
    >
      {children}
    </div>
  )
})

/**
 * 统计数值卡片
 */
export interface StatCardProps extends Omit<CardProps, 'title' | 'children'> {
  /** 标题 */
  title: string
  /** 数值 */
  value: string | number
  /** 描述/趋势 */
  description?: ReactNode
  /** 图标 */
  icon?: ReactNode
  /** 趋势方向 */
  trend?: 'up' | 'down' | 'neutral'
  /** 趋势值 */
  trendValue?: string
}

export const StatCard = memo(function StatCard({
  title,
  value,
  description,
  icon,
  trend,
  trendValue,
  loading,
  ...props
}: StatCardProps) {
  const trendColorClass = {
    up: 'text-success',
    down: 'text-danger',
    neutral: 'text-neutral-500',
  }

  return (
    <Card variant="default" padding="standard" loading={loading} {...props}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 truncate">
            {title}
          </p>
          <p className="mt-2 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {loading ? '--' : value}
          </p>
          {(description || (trend && trendValue)) && (
            <div className="mt-2 flex items-center gap-2">
              {trend && trendValue && (
                <span className={cn('text-sm font-medium', trendColorClass[trend])}>
                  {trend === 'up' && '+'}{trendValue}
                </span>
              )}
              {description && (
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {description}
                </span>
              )}
            </div>
          )}
        </div>
        {icon && (
          <div className="flex-shrink-0 p-2 bg-primary-bg dark:bg-primary-900/20 rounded-lg">
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
})

export default Card
