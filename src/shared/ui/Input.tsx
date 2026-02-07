/**
 * Input 输入框组件
 * 统一的表单输入组件，支持多种变体和状态
 */
import { memo, forwardRef, useState, useId } from 'react'
import type { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'
import { cn } from '../styles'
import { Eye, EyeOff, Search, X } from 'lucide-react'

export type InputSize = 'small' | 'medium' | 'large'
export type InputStatus = 'default' | 'error' | 'success' | 'warning'

// ============================================================================
// 基础输入框
// ============================================================================

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  /** 输入框尺寸 */
  inputSize?: InputSize
  /** 状态 */
  status?: InputStatus
  /** 左侧图标/前缀 */
  prefix?: ReactNode
  /** 右侧图标/后缀 */
  suffix?: ReactNode
  /** 是否允许清空 */
  allowClear?: boolean
  /** 清空回调 */
  onClear?: () => void
  /** 自定义类名 */
  className?: string
  /** 容器类名 */
  containerClassName?: string
}

const inputBaseStyles = 'w-full border rounded-lg transition-colors focus:outline-none focus:ring-2 disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-100'

const inputSizeStyles: Record<InputSize, string> = {
  small: 'px-2.5 py-1.5 text-xs',
  medium: 'px-3 py-2 text-sm',
  large: 'px-4 py-2.5 text-base',
}

const inputStatusStyles: Record<InputStatus, string> = {
  default: 'border-neutral-300 focus:border-primary focus:ring-primary-400 dark:border-neutral-600',
  error: 'border-danger focus:border-danger focus:ring-danger',
  success: 'border-success focus:border-success focus:ring-success',
  warning: 'border-warning focus:border-warning focus:ring-warning',
}

const addonSizeStyles: Record<InputSize, string> = {
  small: 'text-xs',
  medium: 'text-sm',
  large: 'text-base',
}

/**
 * 基础输入框组件
 *
 * @example
 * // 基础用法
 * <Input placeholder="请输入" />
 *
 * @example
 * // 带前缀图标
 * <Input prefix={<SearchIcon />} placeholder="搜索" />
 *
 * @example
 * // 可清空
 * <Input allowClear value={value} onChange={onChange} onClear={() => setValue('')} />
 *
 * @example
 * // 错误状态
 * <Input status="error" />
 */
export const Input = memo(
  forwardRef<HTMLInputElement, InputProps>(function Input(
    {
      inputSize = 'medium',
      status = 'default',
      prefix,
      suffix,
      allowClear = false,
      onClear,
      className,
      containerClassName,
      value,
      disabled,
      ...props
    },
    ref
  ) {
    const hasValue = value !== undefined && value !== ''
    const showClear = allowClear && hasValue && !disabled

    // 计算 padding
    const hasPrefixPadding = prefix ? 'pl-9' : ''
    const hasSuffixPadding = suffix || showClear ? 'pr-9' : ''

    return (
      <div className={cn('relative', containerClassName)}>
        {prefix && (
          <span className={cn(
            'absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none',
            addonSizeStyles[inputSize]
          )}>
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          value={value}
          disabled={disabled}
          className={cn(
            inputBaseStyles,
            inputSizeStyles[inputSize],
            inputStatusStyles[status],
            hasPrefixPadding,
            hasSuffixPadding,
            className
          )}
          {...props}
        />
        {(suffix || showClear) && (
          <span className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1',
            addonSizeStyles[inputSize]
          )}>
            {showClear && (
              <button
                type="button"
                onClick={onClear}
                aria-label="清空"
                title="清空"
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                <X size={14} />
              </button>
            )}
            {suffix && (
              <span className="text-neutral-400 pointer-events-none">{suffix}</span>
            )}
          </span>
        )}
      </div>
    )
  })
)

// ============================================================================
// 搜索输入框
// ============================================================================

export interface SearchInputProps extends Omit<InputProps, 'prefix' | 'type'> {
  /** 搜索回调 */
  onSearch?: (value: string) => void
}

export const SearchInput = memo(
  forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
    { onSearch, onKeyDown, ...props },
    ref
  ) {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && onSearch) {
        onSearch((e.target as HTMLInputElement).value)
      }
      onKeyDown?.(e)
    }

    return (
      <Input
        ref={ref}
        type="search"
        prefix={<Search size={16} />}
        allowClear
        onKeyDown={handleKeyDown}
        {...props}
      />
    )
  })
)

// ============================================================================
// 密码输入框
// ============================================================================

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'suffix'> {
  /** 是否显示切换按钮 */
  showToggle?: boolean
}

export const PasswordInput = memo(
  forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
    { showToggle = true, ...props },
    ref
  ) {
    const [visible, setVisible] = useState(false)

    const toggleVisibility = () => setVisible(!visible)

    const suffixIcon = showToggle ? (
      <button
        type="button"
        onClick={toggleVisibility}
        className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    ) : undefined

    return (
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        suffix={suffixIcon}
        {...props}
      />
    )
  })
)

// ============================================================================
// 文本域
// ============================================================================

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  /** 尺寸 */
  inputSize?: InputSize
  /** 状态 */
  status?: InputStatus
  /** 是否显示字数统计 */
  showCount?: boolean
  /** 自定义类名 */
  className?: string
}

export const TextArea = memo(
  forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
    {
      inputSize = 'medium',
      status = 'default',
      showCount = false,
      maxLength,
      value,
      className,
      ...props
    },
    ref
  ) {
    const currentLength = typeof value === 'string' ? value.length : 0

    return (
      <div className="relative">
        <textarea
          ref={ref}
          value={value}
          maxLength={maxLength}
          className={cn(
            inputBaseStyles,
            inputSizeStyles[inputSize],
            inputStatusStyles[status],
            'min-h-[80px] resize-y',
            showCount && 'pb-6',
            className
          )}
          {...props}
        />
        {showCount && (
          <span className="absolute right-3 bottom-2 text-xs text-neutral-400">
            {currentLength}{maxLength ? `/${maxLength}` : ''}
          </span>
        )}
      </div>
    )
  })
)

// ============================================================================
// 表单项包装器
// ============================================================================

export interface FormItemProps {
  /** 标签 */
  label?: string
  /** 是否必填 */
  required?: boolean
  /** 错误信息 */
  error?: string
  /** 帮助文本 */
  help?: string
  /** 子元素 */
  children: ReactNode
  /** 自定义类名 */
  className?: string
}

export const FormItem = memo(function FormItem({
  label,
  required,
  error,
  help,
  children,
  className,
}: FormItemProps) {
  const id = useId()

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}
      {!error && help && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{help}</p>
      )}
    </div>
  )
})

export default Input
