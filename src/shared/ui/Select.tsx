/**
 * Select 选择器组件
 * 统一的下拉选择组件，支持单选和多选
 */
import { memo, forwardRef } from 'react'
import type { SelectHTMLAttributes, ReactNode } from 'react'
import { cn } from '../styles'
import { ChevronDown } from 'lucide-react'

export type SelectSize = 'small' | 'medium' | 'large'
export type SelectStatus = 'default' | 'error' | 'success' | 'warning'

export interface SelectOption {
  /** 选项值 */
  value: string | number
  /** 显示文本 */
  label: string
  /** 是否禁用 */
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** 选择器尺寸 */
  selectSize?: SelectSize
  /** 状态 */
  status?: SelectStatus
  /** 选项列表 */
  options?: SelectOption[]
  /** 占位文本 */
  placeholder?: string
  /** 是否允许清空 */
  allowClear?: boolean
  /** 自定义类名 */
  className?: string
  /** 容器类名 */
  containerClassName?: string
  /** 子元素（option 元素） */
  children?: ReactNode
}

const selectBaseStyles = 'w-full border rounded-lg transition-colors focus:outline-none focus:ring-2 appearance-none bg-white cursor-pointer disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-100'

const selectSizeStyles: Record<SelectSize, string> = {
  small: 'px-2.5 py-1.5 pr-8 text-xs',
  medium: 'px-3 py-2 pr-9 text-sm',
  large: 'px-4 py-2.5 pr-10 text-base',
}

const selectStatusStyles: Record<SelectStatus, string> = {
  default: 'border-neutral-300 focus:border-primary focus:ring-primary-400 dark:border-neutral-600',
  error: 'border-danger focus:border-danger focus:ring-danger',
  success: 'border-success focus:border-success focus:ring-success',
  warning: 'border-warning focus:border-warning focus:ring-warning',
}

const iconSizeStyles: Record<SelectSize, number> = {
  small: 14,
  medium: 16,
  large: 18,
}

/**
 * 基础选择器组件
 *
 * @example
 * // 使用 options 属性
 * <Select
 *   options={[
 *     { value: '1', label: '选项一' },
 *     { value: '2', label: '选项二' },
 *   ]}
 *   placeholder="请选择"
 * />
 *
 * @example
 * // 使用 children
 * <Select placeholder="请选择">
 *   <option value="1">选项一</option>
 *   <option value="2">选项二</option>
 * </Select>
 */
export const Select = memo(
  forwardRef<HTMLSelectElement, SelectProps>(function Select(
    {
      selectSize = 'medium',
      status = 'default',
      options,
      placeholder,
      allowClear,
      className,
      containerClassName,
      children,
      ...props
    },
    ref
  ) {
    return (
      <div className={cn('relative', containerClassName)}>
        <select
          ref={ref}
          className={cn(
            selectBaseStyles,
            selectSizeStyles[selectSize],
            selectStatusStyles[status],
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options
            ? options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          size={iconSizeStyles[selectSize]}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
          aria-hidden="true"
        />
      </div>
    )
  })
)

/**
 * 原生多选框组件（用于简单多选场景）
 */
export interface MultiSelectProps extends Omit<SelectProps, 'multiple' | 'value' | 'onChange'> {
  /** 选中的值 */
  value?: (string | number)[]
  /** 值变化回调 */
  onChange?: (values: (string | number)[]) => void
  /** 最大高度（行数） */
  maxRows?: number
}

export const NativeMultiSelect = memo(
  forwardRef<HTMLSelectElement, MultiSelectProps>(function NativeMultiSelect(
    {
      selectSize = 'medium',
      status = 'default',
      options,
      value = [],
      onChange,
      maxRows = 5,
      className,
      containerClassName,
      children,
      ...props
    },
    ref
  ) {
    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const selectedOptions = Array.from(e.target.selectedOptions, (option) => option.value)
      onChange?.(selectedOptions)
    }

    const rowHeight = selectSize === 'small' ? 24 : selectSize === 'large' ? 36 : 30
    const maxHeight = rowHeight * maxRows

    return (
      <div className={cn('relative', containerClassName)}>
        <select
          ref={ref}
          multiple
          value={value.map(String)}
          onChange={handleChange}
          className={cn(
            'w-full border rounded-lg transition-colors focus:outline-none focus:ring-2 bg-white dark:bg-neutral-800 dark:text-neutral-100',
            selectSizeStyles[selectSize].replace('pr-8', '').replace('pr-9', '').replace('pr-10', ''),
            selectStatusStyles[status],
            'p-1',
            className
          )}
          style={{ maxHeight }}
          {...props}
        >
          {options
            ? options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="px-2 py-1 rounded cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  {option.label}
                </option>
              ))
            : children}
        </select>
      </div>
    )
  })
)

/**
 * 选项组标签
 */
export interface OptGroupProps {
  /** 分组标签 */
  label: string
  /** 子选项 */
  children: ReactNode
}

export const OptGroup = memo(function OptGroup({ label, children }: OptGroupProps) {
  return (
    <optgroup label={label} className="font-medium text-neutral-700 dark:text-neutral-300">
      {children}
    </optgroup>
  )
})

export default Select
