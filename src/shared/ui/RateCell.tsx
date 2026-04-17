import { memo } from 'react'
import {
  cn,
  getTrendColorClass,
  textStyles,
  type MetricPolarity,
} from '../styles'

export interface RateCellProps {
  /** 率值（SQL 已返回百分数，如 68.5） */
  value: number | null | undefined
  /** 小数位，默认 1（除自主系数 4） */
  decimals?: number
  /** 极性：赔付率/费用率=negative（越高越差），达成率=positive */
  polarity?: MetricPolarity
  /** 与阈值/基准的比较值，传入时启用趋势上色 */
  baseline?: number
  className?: string
}

/**
 * 率值单元格（表格/热力图专用）
 * - SQL 返回已乘 100 的纯百分数（如 68.5），本组件仅 `toFixed(decimals)` 呈现，不追加 `%`
 * - 单位 `(%)` 请写在列头/标签，不在单元格
 * - 独立展示（卡片、tooltip、叙述）请继续使用 `formatPercent`
 *
 * @example <RateCell value={68.52} />          // "68.5"
 * @example <RateCell value={88.2} decimals={1} polarity="negative" baseline={85} /> // 带趋势色
 */
export const RateCell = memo<RateCellProps>(
  ({ value, decimals = 1, polarity, baseline, className }) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return (
        <span className={cn(textStyles.numeric, 'text-neutral-400', className)}>
          -
        </span>
      )
    }

    const trendClass =
      polarity && baseline !== undefined
        ? getTrendColorClass(value - baseline, polarity)
        : undefined

    return (
      <span className={cn(textStyles.numeric, trendClass, className)}>
        {value.toFixed(decimals)}
      </span>
    )
  },
)

RateCell.displayName = 'RateCell'
