/**
 * Badge 徽章/标签组件
 * 用于状态标识、分类标签、计数显示等场景
 */
import { memo, forwardRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../styles'

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'outline'
export type BadgeSize = 'small' | 'medium' | 'large'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** 徽章变体 */
  variant?: BadgeVariant
  /** 徽章尺寸 */
  size?: BadgeSize
  /** 是否显示圆点 */
  dot?: boolean
  /** 圆点颜色（当 dot=true 时生效） */
  dotColor?: string
  /** 子内容 */
  children?: ReactNode
  /** 自定义类名 */
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300',
  primary: 'bg-primary-bg text-primary-dark dark:bg-primary-900/30 dark:text-primary-300',
  success: 'bg-success-bg text-success-dark dark:bg-green-900/30 dark:text-green-300',
  warning: 'bg-warning-bg text-warning-dark dark:bg-yellow-900/30 dark:text-yellow-300',
  danger: 'bg-danger-bg text-danger-dark dark:bg-red-900/30 dark:text-red-300',
  outline: 'bg-transparent border border-current',
}

const sizeStyles: Record<BadgeSize, string> = {
  small: 'px-1.5 py-0.5 text-xs',
  medium: 'px-2 py-0.5 text-xs',
  large: 'px-2.5 py-1 text-sm',
}

const dotSizeStyles: Record<BadgeSize, string> = {
  small: 'w-1.5 h-1.5',
  medium: 'w-2 h-2',
  large: 'w-2.5 h-2.5',
}

/**
 * 徽章/标签组件
 *
 * @example
 * // 基础用法
 * <Badge>默认</Badge>
 * <Badge variant="success">成功</Badge>
 * <Badge variant="danger">错误</Badge>
 *
 * @example
 * // 带圆点
 * <Badge variant="success" dot>在线</Badge>
 *
 * @example
 * // 轮廓样式
 * <Badge variant="outline">标签</Badge>
 */
export const Badge = memo(
  forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
    {
      variant = 'default',
      size = 'medium',
      dot = false,
      dotColor,
      children,
      className,
      ...props
    },
    ref
  ) {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full font-medium',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {dot && (
          <span
            className={cn(
              'rounded-full flex-shrink-0',
              dotSizeStyles[size],
              !dotColor && variant === 'default' && 'bg-neutral-400',
              !dotColor && variant === 'primary' && 'bg-primary',
              !dotColor && variant === 'success' && 'bg-success',
              !dotColor && variant === 'warning' && 'bg-warning',
              !dotColor && variant === 'danger' && 'bg-danger',
              !dotColor && variant === 'outline' && 'bg-current'
            )}
            style={dotColor ? { backgroundColor: dotColor } : undefined}
          />
        )}
        {children}
      </span>
    )
  })
)

/**
 * 状态徽章 - 预设的状态标识
 */
export type StatusBadgeStatus = 'online' | 'offline' | 'busy' | 'away' | 'success' | 'error' | 'pending'

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant' | 'dot'> {
  /** 状态类型 */
  status: StatusBadgeStatus
  /** 是否只显示圆点（不显示文字） */
  dotOnly?: boolean
}

const statusConfig: Record<StatusBadgeStatus, { variant: BadgeVariant; label: string; dotColor: string }> = {
  online: { variant: 'success', label: '在线', dotColor: '#52c41a' },
  offline: { variant: 'default', label: '离线', dotColor: '#8c8c8c' },
  busy: { variant: 'danger', label: '忙碌', dotColor: '#ff4d4f' },
  away: { variant: 'warning', label: '离开', dotColor: '#faad14' },
  success: { variant: 'success', label: '成功', dotColor: '#52c41a' },
  error: { variant: 'danger', label: '错误', dotColor: '#ff4d4f' },
  pending: { variant: 'warning', label: '待处理', dotColor: '#faad14' },
}

export const StatusBadge = memo(function StatusBadge({
  status,
  dotOnly = false,
  children,
  ...props
}: StatusBadgeProps) {
  const config = statusConfig[status]

  if (dotOnly) {
    return (
      <span
        className={cn('w-2 h-2 rounded-full inline-block')}
        style={{ backgroundColor: config.dotColor }}
        title={config.label}
      />
    )
  }

  return (
    <Badge variant={config.variant} dot dotColor={config.dotColor} {...props}>
      {children || config.label}
    </Badge>
  )
})

/**
 * 计数徽章 - 用于显示数量
 */
export interface CountBadgeProps extends Omit<BadgeProps, 'children'> {
  /** 数量 */
  count: number
  /** 最大显示数量，超过显示 max+ */
  max?: number
  /** 是否在数量为 0 时隐藏 */
  showZero?: boolean
}

export const CountBadge = memo(function CountBadge({
  count,
  max = 99,
  showZero = false,
  variant = 'danger',
  size = 'small',
  ...props
}: CountBadgeProps) {
  if (count === 0 && !showZero) {
    return null
  }

  const displayCount = count > max ? `${max}+` : count.toString()

  return (
    <Badge
      variant={variant}
      size={size}
      className="min-w-[1.25rem] justify-center"
      {...props}
    >
      {displayCount}
    </Badge>
  )
})

/**
 * 标签组 - 用于显示多个标签
 */
export interface TagGroupProps {
  /** 标签列表 */
  tags: Array<{
    label: string
    variant?: BadgeVariant
    onClick?: () => void
  }>
  /** 尺寸 */
  size?: BadgeSize
  /** 最大显示数量 */
  max?: number
  /** 自定义类名 */
  className?: string
}

export const TagGroup = memo(function TagGroup({
  tags,
  size = 'small',
  max,
  className,
}: TagGroupProps) {
  const displayTags = max ? tags.slice(0, max) : tags
  const hiddenCount = max ? Math.max(0, tags.length - max) : 0

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {displayTags.map((tag, index) => (
        <Badge
          key={index}
          variant={tag.variant}
          size={size}
          className={tag.onClick ? 'cursor-pointer hover:opacity-80' : undefined}
          onClick={tag.onClick}
        >
          {tag.label}
        </Badge>
      ))}
      {hiddenCount > 0 && (
        <Badge variant="default" size={size}>
          +{hiddenCount}
        </Badge>
      )}
    </div>
  )
})

export default Badge
