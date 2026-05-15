/**
 * 入口卡组件 — 数据驱动，items 在 data/reportEntries.ts 中声明。
 * 点击 → window.open(reportUrl, '_blank')；etlDate 为 null 显示 Skeleton。
 */
import { memo } from 'react'
import { Card } from '../../../shared/ui/Card'
import { badgeStyles, cn, colorClasses } from '../../../shared/styles'
import type { ReportEntry } from '../data/reportEntries'

interface ReportEntryCardProps {
  entry: ReportEntry
  etlDate: string | null
  loading?: boolean
}

export const ReportEntryCard = memo(function ReportEntryCard({
  entry,
  etlDate,
  loading = false,
}: ReportEntryCardProps) {
  const reportUrl = entry.getReportUrl(etlDate)
  const Icon = entry.icon
  const isClickable = !loading && reportUrl !== null

  const handleClick = () => {
    if (!isClickable || !reportUrl) return
    window.open(reportUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <Card
      variant={isClickable ? 'interactive' : 'default'}
      padding="spacious"
      onClick={isClickable ? handleClick : undefined}
      aria-disabled={!isClickable}
      title={
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex-shrink-0 p-2 rounded-lg',
              entry.accent === 'success'
                ? 'bg-success-bg text-success-dark'
                : 'bg-primary-bg text-primary-dark'
            )}
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
          </span>
          <span>{entry.title}</span>
        </div>
      }
      subtitle={entry.subtitle}
    >
      <div className="flex flex-wrap gap-2 mt-2">
        {entry.badges.map((badge) => (
          <span
            key={badge}
            className={cn(badgeStyles.base, badgeStyles.default)}
          >
            {badge}
          </span>
        ))}
      </div>
      <div className={cn('mt-4 text-sm', colorClasses.text.neutralMuted)}>
        {loading ? (
          <span>加载中…</span>
        ) : etlDate ? (
          <span>
            数据截止 <strong className="text-neutral-700 dark:text-neutral-300">{etlDate}</strong> · 点击新窗口打开
          </span>
        ) : (
          <span>报告暂未生成</span>
        )}
      </div>
    </Card>
  )
})
