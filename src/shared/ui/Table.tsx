/**
 * Table 表格组件
 * 统一的表格组件，支持排序、固定列、响应式等功能
 */
import { memo, forwardRef, useState } from 'react'
import type { HTMLAttributes, ReactNode, CSSProperties } from 'react'
import { cn, fontStyles, getTrendColorClassByPolarity, getTrendDirection } from '../styles'
import type { MetricPolarity } from '../styles'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

// ============================================================================
// 类型定义
// ============================================================================

export type TableSize = 'small' | 'medium' | 'large'
export type SortDirection = 'asc' | 'desc' | null

export interface TableColumn<T = unknown> {
  /** 列唯一标识 */
  key: string
  /** 列标题 */
  title: ReactNode
  /** 数据字段名 */
  dataIndex?: keyof T | string
  /** 列宽 */
  width?: number | string
  /** 最小列宽 */
  minWidth?: number
  /** 对齐方式 */
  align?: 'left' | 'center' | 'right'
  /** 是否固定列 */
  fixed?: 'left' | 'right'
  /** 是否可排序 */
  sortable?: boolean
  /** 自定义渲染 */
  render?: (value: unknown, record: T, index: number) => ReactNode
  /** 表头类名 */
  headerClassName?: string
  /** 单元格类名 */
  cellClassName?: string
}

export interface TableProps<T = unknown> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 列配置 */
  columns: TableColumn<T>[]
  /** 数据源 */
  dataSource: T[]
  /** 行唯一键 */
  rowKey: keyof T | ((record: T) => string | number)
  /** 表格尺寸 */
  size?: TableSize
  /** 是否显示边框 */
  bordered?: boolean
  /** 是否斑马纹 */
  striped?: boolean
  /** 是否显示悬浮效果 */
  hoverable?: boolean
  /** 是否加载中 */
  loading?: boolean
  /** 空状态内容 */
  emptyContent?: ReactNode
  /** 排序变化回调 */
  onSort?: (key: string, direction: SortDirection) => void
  /** 行点击回调 */
  onRowClick?: (record: T, index: number) => void
  /** 固定表头 */
  stickyHeader?: boolean
  /** 最大高度（用于固定表头时） */
  maxHeight?: number | string
  /** 自定义类名 */
  className?: string
  /** 表格容器类名 */
  containerClassName?: string
}

// ============================================================================
// 样式常量
// ============================================================================

const sizeStyles: Record<TableSize, { header: string; cell: string }> = {
  small: {
    header: 'px-2 py-1.5 text-xs',
    cell: 'px-2 py-1.5 text-xs',
  },
  medium: {
    header: 'px-3 py-2 text-xs',
    cell: 'px-3 py-2 text-sm',
  },
  large: {
    header: 'px-4 py-3 text-sm',
    cell: 'px-4 py-3 text-sm',
  },
}

const alignStyles: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

// ============================================================================
// 子组件
// ============================================================================

/**
 * 排序图标
 */
const SortIcon = memo(function SortIcon({
  direction,
}: {
  direction: SortDirection
}) {
  if (direction === 'asc') {
    return <ChevronUp size={14} className="text-primary" />
  }
  if (direction === 'desc') {
    return <ChevronDown size={14} className="text-primary" />
  }
  return <ChevronsUpDown size={14} className="text-neutral-400" />
})

/**
 * 表格加载遮罩
 */
const TableLoading = memo(function TableLoading() {
  return (
    <div className="absolute inset-0 bg-white/80 dark:bg-neutral-900/80 flex items-center justify-center z-10">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  )
})

/**
 * 空状态
 */
const TableEmpty = memo(function TableEmpty({
  content,
  colSpan,
}: {
  content?: ReactNode
  colSpan: number
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center">
        <div className="text-neutral-400 dark:text-neutral-500">
          {content || '暂无数据'}
        </div>
      </td>
    </tr>
  )
})

// ============================================================================
// 主组件
// ============================================================================

/**
 * 表格组件
 *
 * @example
 * // 基础用法
 * <Table
 *   columns={[
 *     { key: 'name', title: '姓名', dataIndex: 'name' },
 *     { key: 'age', title: '年龄', dataIndex: 'age', align: 'right' },
 *   ]}
 *   dataSource={data}
 *   rowKey="id"
 * />
 *
 * @example
 * // 可排序 + 自定义渲染
 * <Table
 *   columns={[
 *     { key: 'name', title: '姓名', dataIndex: 'name', sortable: true },
 *     {
 *       key: 'status',
 *       title: '状态',
 *       render: (_, record) => <Badge>{record.status}</Badge>
 *     },
 *   ]}
 *   dataSource={data}
 *   rowKey="id"
 *   onSort={(key, dir) => logger.debug(key, dir)}
 * />
 */
function TableInner<T extends Record<string, unknown>>(
  {
    columns,
    dataSource,
    rowKey,
    size = 'medium',
    bordered = false,
    striped = false,
    hoverable = true,
    loading = false,
    emptyContent,
    onSort,
    onRowClick,
    stickyHeader = false,
    maxHeight,
    className,
    containerClassName,
    ...props
  }: TableProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const [sortState, setSortState] = useState<{
    key: string | null
    direction: SortDirection
  }>({ key: null, direction: null })

  // 获取行 key
  const getRowKey = (record: T, _index: number): string | number => {
    if (typeof rowKey === 'function') {
      return rowKey(record)
    }
    return record[rowKey] as string | number
  }

  // 获取单元格值
  const getCellValue = (record: T, column: TableColumn<T>): unknown => {
    if (column.dataIndex) {
      const keys = String(column.dataIndex).split('.')
      let value: unknown = record
      for (const key of keys) {
        value = (value as Record<string, unknown>)?.[key]
      }
      return value
    }
    return undefined
  }

  // 处理排序点击
  const handleSortClick = (column: TableColumn<T>) => {
    if (!column.sortable) return

    let newDirection: SortDirection
    if (sortState.key === column.key) {
      newDirection =
        sortState.direction === 'asc'
          ? 'desc'
          : sortState.direction === 'desc'
          ? null
          : 'asc'
    } else {
      newDirection = 'asc'
    }

    setSortState({
      key: newDirection ? column.key : null,
      direction: newDirection,
    })
    onSort?.(column.key, newDirection)
  }

  // 计算列样式
  const getColumnStyle = (column: TableColumn<T>): CSSProperties => {
    const style: CSSProperties = {}
    if (column.width) {
      style.width = typeof column.width === 'number' ? `${column.width}px` : column.width
    }
    if (column.minWidth) {
      style.minWidth = `${column.minWidth}px`
    }
    return style
  }

  const sizeStyle = sizeStyles[size]

  return (
    <div
      ref={ref}
      className={cn(
        'relative bg-white rounded-lg border border-neutral-200 overflow-hidden dark:bg-neutral-800 dark:border-neutral-700',
        containerClassName
      )}
      {...props}
    >
      {loading && <TableLoading />}
      <div
        className={cn('overflow-auto', className)}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full border-collapse">
          <thead
            className={cn(
              'bg-neutral-50 dark:bg-neutral-900',
              stickyHeader && 'sticky top-0 z-10'
            )}
          >
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    sizeStyle.header,
                    alignStyles[column.align || 'left'],
                    'font-semibold text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-700 whitespace-nowrap',
                    column.sortable && 'cursor-pointer select-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                    column.headerClassName
                  )}
                  style={getColumnStyle(column)}
                  aria-sort={
                    column.sortable && sortState.key === column.key
                      ? sortState.direction === 'asc' ? 'ascending' : sortState.direction === 'desc' ? 'descending' : undefined
                      : undefined
                  }
                  onClick={() => handleSortClick(column)}
                >
                  <div className={cn('flex items-center gap-1', column.align === 'right' && 'justify-end', column.align === 'center' && 'justify-center')}>
                    <span>{column.title}</span>
                    {column.sortable && (
                      <SortIcon
                        direction={
                          sortState.key === column.key ? sortState.direction : null
                        }
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {dataSource.length === 0 ? (
              <TableEmpty content={emptyContent} colSpan={columns.length} />
            ) : (
              dataSource.map((record, rowIndex) => (
                <tr
                  key={getRowKey(record, rowIndex)}
                  className={cn(
                    'transition-colors',
                    striped && rowIndex % 2 === 1 && 'bg-neutral-50 dark:bg-neutral-900/50',
                    hoverable && 'hover:bg-neutral-50 dark:hover:bg-neutral-800',
                    onRowClick && 'cursor-pointer'
                  )}
                  onClick={() => onRowClick?.(record, rowIndex)}
                >
                  {columns.map((column) => {
                    const value = getCellValue(record, column)
                    const content = column.render
                      ? column.render(value, record, rowIndex)
                      : (value as ReactNode)

                    return (
                      <td
                        key={column.key}
                        className={cn(
                          sizeStyle.cell,
                          alignStyles[column.align || 'left'],
                          'text-neutral-700 dark:text-neutral-300',
                          bordered && 'border-r border-neutral-200 dark:border-neutral-700 last:border-r-0',
                          column.cellClassName
                        )}
                        style={getColumnStyle(column)}
                      >
                        {content}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const Table = memo(forwardRef(TableInner)) as <T extends Record<string, unknown>>(
  props: TableProps<T> & { ref?: React.ForwardedRef<HTMLDivElement> }
) => ReturnType<typeof TableInner>

// ============================================================================
// 辅助组件
// ============================================================================

/**
 * 数值单元格 - 右对齐等宽字体
 */
export const NumericCell = memo(function NumericCell({
  value,
  className,
}: {
  value: string | number | null | undefined
  className?: string
}) {
  return (
    <span className={cn(fontStyles.numeric, className)}>
      {value ?? '-'}
    </span>
  )
})

/**
 * 趋势单元格 - 带颜色指示
 */
export const TrendCell = memo(function TrendCell({
  value,
  formatter,
  inverse = false,
  metricPolarity,
  className,
}: {
  value: number | null | undefined
  formatter?: (v: number) => string
  /** @deprecated 优先使用 metricPolarity */
  inverse?: boolean
  /** 指标方向（默认正向指标：涨绿跌红） */
  metricPolarity?: MetricPolarity
  className?: string
}) {
  if (value === null || value === undefined) {
    return <span className="text-neutral-400">-</span>
  }

  const resolvedPolarity: MetricPolarity = metricPolarity ?? (inverse ? 'negative' : 'positive')
  const colorClass = getTrendColorClassByPolarity(getTrendDirection(value), resolvedPolarity)
  const prefix = value > 0 ? '+' : ''
  const displayValue = formatter ? formatter(value) : value.toString()

  return (
    <span className={cn(fontStyles.numeric, colorClass, className)}>
      {prefix}{displayValue}
    </span>
  )
})

/**
 * 状态单元格
 */
export const StatusCell = memo(function StatusCell({
  status,
  label,
  className,
}: {
  status: 'success' | 'warning' | 'danger' | 'default'
  label: string
  className?: string
}) {
  const dotColorClass = {
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    default: 'bg-neutral-400',
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', dotColorClass[status])} />
      {label}
    </span>
  )
})

export default Table
