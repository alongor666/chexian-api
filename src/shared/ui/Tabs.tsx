/**
 * Tabs 标签页组件
 * 通用可复用的标签页切换组件
 */
import { memo } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../styles'

export interface TabItem {
  key: string
  label: ReactNode
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  activeKey: string
  onChange: (key: string) => void
  variant?: 'underline' | 'pills'
  size?: 'mini' | 'small' | 'medium'
  className?: string
}

export const Tabs = memo(function Tabs({
  items,
  activeKey,
  onChange,
  variant = 'pills',
  size = 'medium',
  className,
}: TabsProps) {
  const isUnderline = variant === 'underline'
  const isMini = size === 'mini'
  const isSmall = size === 'small'

  return (
    <div
      className={cn(
        'flex gap-1',
        isUnderline && 'border-b border-neutral-200 dark:border-subtle gap-0',
        className
      )}
      role="tablist"
    >
      {items.map((item) => {
        const isActive = item.key === activeKey

        return (
          <button
            key={item.key}
            role="tab"
            aria-selected={isActive}
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.key)}
            className={cn(
              'inline-flex items-center justify-center font-medium transition-colors focus:outline-none',
              isMini ? 'px-2 py-0.5 text-[11px]' : isSmall ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
              item.disabled && 'opacity-50 cursor-not-allowed',
              !item.disabled && 'cursor-pointer',
              // Pills variant
              !isUnderline && 'rounded-lg',
              !isUnderline && (isActive
                ? 'bg-primary text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/8 hover:text-neutral-800 dark:hover:text-neutral-200'),
              // Underline variant
              isUnderline && '-mb-px border-b-2',
              isUnderline && (isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600'),
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
})

export default Tabs
