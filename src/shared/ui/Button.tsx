/**
 * Button 按钮组件
 * 统一的按钮组件，支持多种变体、尺寸和状态
 */
import { memo, forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../styles'
import { Loader2 } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'link'
export type ButtonSize = 'small' | 'medium' | 'large'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 按钮变体 */
  variant?: ButtonVariant
  /** 按钮尺寸 */
  size?: ButtonSize
  /** 是否加载中 */
  loading?: boolean
  /** 是否占满宽度 */
  block?: boolean
  /** 左侧图标 */
  leftIcon?: ReactNode
  /** 右侧图标 */
  rightIcon?: ReactNode
  /** 子内容 */
  children?: ReactNode
  /** 自定义类名 */
  className?: string
}

const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-400 active:bg-primary-dark focus:ring-primary-400 dark:hover:bg-primary-600',
  secondary: 'bg-neutral-100 text-neutral-700 border border-neutral-300 hover:bg-neutral-200 active:bg-neutral-300 focus:ring-neutral-400 dark:bg-neutral-700 dark:text-neutral-200 dark:border-neutral-600 dark:hover:bg-neutral-600',
  ghost: 'text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 focus:ring-neutral-400 dark:text-neutral-300 dark:hover:bg-neutral-700',
  danger: 'bg-danger text-white hover:bg-danger-light active:bg-danger-dark focus:ring-danger dark:hover:bg-danger-dark',
  success: 'bg-success text-white hover:bg-success-light active:bg-success-dark focus:ring-success dark:hover:bg-success-dark',
  link: 'text-primary hover:text-primary-light active:text-primary-dark underline-offset-4 hover:underline focus:ring-0 p-0',
}

const sizeStyles: Record<ButtonSize, string> = {
  small: 'px-3 py-1.5 text-xs gap-1.5',
  medium: 'px-4 py-2 text-sm gap-2',
  large: 'px-6 py-3 text-base gap-2.5',
}

// link 变体不需要 padding
const linkSizeStyles: Record<ButtonSize, string> = {
  small: 'text-xs gap-1',
  medium: 'text-sm gap-1.5',
  large: 'text-base gap-2',
}

/**
 * 通用按钮组件
 *
 * @example
 * // 主要按钮
 * <Button variant="primary">保存</Button>
 *
 * @example
 * // 带图标的按钮
 * <Button leftIcon={<PlusIcon />}>新增</Button>
 *
 * @example
 * // 加载状态
 * <Button loading>提交中...</Button>
 *
 * @example
 * // 危险操作
 * <Button variant="danger">删除</Button>
 */
export const Button = memo(
  forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
      variant = 'primary',
      size = 'medium',
      loading = false,
      block = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      className,
      type = 'button',
      ...props
    },
    ref
  ) {
    const isDisabled = disabled || loading
    const sizeClass = variant === 'link' ? linkSizeStyles[size] : sizeStyles[size]

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeClass,
          block && 'w-full',
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="animate-spin" size={size === 'small' ? 14 : size === 'large' ? 20 : 16} />
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </button>
    )
  })
)

/**
 * 图标按钮（仅图标，无文字）
 */
export interface IconButtonProps extends Omit<ButtonProps, 'leftIcon' | 'rightIcon' | 'children'> {
  /** 图标 */
  icon: ReactNode
  /** 可访问性标签 */
  'aria-label': string
}

export const IconButton = memo(
  forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    { icon, size = 'medium', className, ...props },
    ref
  ) {
    const iconSizeStyles: Record<ButtonSize, string> = {
      small: 'p-1.5',
      medium: 'p-2',
      large: 'p-3',
    }

    return (
      <Button
        ref={ref}
        size={size}
        className={cn(iconSizeStyles[size], className)}
        {...props}
      >
        {icon}
      </Button>
    )
  })
)

/**
 * 按钮组
 */
export interface ButtonGroupProps {
  /** 子按钮 */
  children: ReactNode
  /** 尺寸（会传递给子按钮） */
  size?: ButtonSize
  /** 是否垂直排列 */
  vertical?: boolean
  /** 自定义类名 */
  className?: string
}

export const ButtonGroup = memo(function ButtonGroup({
  children,
  vertical = false,
  className,
}: ButtonGroupProps) {
  return (
    <div
      className={cn(
        'inline-flex',
        vertical ? 'flex-col' : 'flex-row',
        '[&>button]:rounded-none',
        vertical
          ? '[&>button:first-child]:rounded-t-lg [&>button:last-child]:rounded-b-lg'
          : '[&>button:first-child]:rounded-l-lg [&>button:last-child]:rounded-r-lg',
        !vertical && '[&>button:not(:first-child)]:-ml-px',
        vertical && '[&>button:not(:first-child)]:-mt-px',
        className
      )}
      role="group"
    >
      {children}
    </div>
  )
})

export default Button
