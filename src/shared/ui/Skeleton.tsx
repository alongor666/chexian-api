/**
 * Skeleton 骨架屏组件
 * 用于数据加载时的占位展示
 */
import { memo } from 'react'

type SkeletonVariant = 'text' | 'circular' | 'rectangular'
type SkeletonAnimation = 'pulse' | 'shimmer' | 'none'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 骨架屏形状 */
  variant?: SkeletonVariant
  /** 宽度 */
  width?: string | number
  /** 高度 */
  height?: string | number
  /** 动画类型 */
  animation?: SkeletonAnimation
  /** 自定义类名 */
  className?: string
}

const variantStyles: Record<SkeletonVariant, string> = {
  text: 'rounded h-4',
  circular: 'rounded-full',
  rectangular: 'rounded-md',
}

const animationStyles: Record<SkeletonAnimation, string> = {
  pulse: 'animate-pulse',
  shimmer: 'bg-gradient-to-r from-neutral-200 via-neutral-100 to-neutral-200 bg-[length:200%_100%] animate-shimmer',
  none: '',
}

/**
 * 基础骨架屏组件
 */
export const Skeleton = memo(function Skeleton({
  variant = 'text',
  width,
  height,
  animation = 'pulse',
  className = '',
  ...props
}: SkeletonProps) {
  const style: React.CSSProperties = {}
  if (width) style.width = typeof width === 'number' ? `${width}px` : width
  if (height) style.height = typeof height === 'number' ? `${height}px` : height

  return (
    <div
      className={`bg-neutral-200 ${variantStyles[variant]} ${animationStyles[animation]} ${className}`}
      style={style}
      role="status"
      aria-label="加载中"
      {...props}
    >
      <span className="sr-only">加载中...</span>
    </div>
  )
})

/**
 * KPI卡片骨架屏
 */
export const KpiCardSkeleton = memo(function KpiCardSkeleton() {
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-card p-4 space-y-3">
      <Skeleton variant="text" width="60%" height={16} />
      <Skeleton variant="text" width="80%" height={28} />
      <div className="flex items-center gap-2">
        <Skeleton variant="text" width={40} height={14} />
        <Skeleton variant="text" width={60} height={14} />
      </div>
    </div>
  )
})

/**
 * KPI卡片组骨架屏
 */
export const KpiGridSkeleton = memo(function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  )
})

/**
 * 表格骨架屏
 */
export const TableSkeleton = memo(function TableSkeleton({
  rows = 5,
  columns = 4,
}: {
  rows?: number
  columns?: number
}) {
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-card overflow-hidden">
      {/* 表头 */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-3">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="flex-1 px-2">
            <Skeleton variant="text" height={16} />
          </div>
        ))}
      </div>
      {/* 表体 */}
      <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex p-3">
            {Array.from({ length: columns }).map((_, colIndex) => (
              <div key={colIndex} className="flex-1 px-2">
                <Skeleton variant="text" height={14} width={`${60 + Math.random() * 30}%`} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
})

/**
 * 图表骨架屏
 */
export const ChartSkeleton = memo(function ChartSkeleton({
  height = 300,
}: {
  height?: number
}) {
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-card p-4">
      <Skeleton variant="text" width="40%" height={20} className="mb-4" />
      <Skeleton variant="rectangular" width="100%" height={height - 60} />
    </div>
  )
})

/**
 * 筛选器骨架屏
 */
export const FilterSkeleton = memo(function FilterSkeleton() {
  return (
    <div className="flex flex-wrap gap-3 p-4 bg-white dark:bg-neutral-800 rounded-lg shadow-card">
      <Skeleton variant="rectangular" width={120} height={36} />
      <Skeleton variant="rectangular" width={150} height={36} />
      <Skeleton variant="rectangular" width={100} height={36} />
      <Skeleton variant="rectangular" width={80} height={36} />
    </div>
  )
})

/**
 * 仪表盘页面骨架屏
 */
export const DashboardSkeleton = memo(function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-4">
      {/* 筛选器 */}
      <FilterSkeleton />
      {/* KPI卡片 */}
      <KpiGridSkeleton count={4} />
      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSkeleton height={300} />
        <ChartSkeleton height={300} />
      </div>
      {/* 表格 */}
      <TableSkeleton rows={5} columns={6} />
    </div>
  )
})

/**
 * 列表项骨架屏
 */
export const ListItemSkeleton = memo(function ListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton variant="circular" width={40} height={40} />
      <div className="flex-1 space-y-2">
        <Skeleton variant="text" width="60%" height={16} />
        <Skeleton variant="text" width="40%" height={14} />
      </div>
    </div>
  )
})

/**
 * 列表骨架屏
 */
export const ListSkeleton = memo(function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-card divide-y divide-neutral-100 dark:divide-neutral-700">
      {Array.from({ length: count }).map((_, i) => (
        <ListItemSkeleton key={i} />
      ))}
    </div>
  )
})
