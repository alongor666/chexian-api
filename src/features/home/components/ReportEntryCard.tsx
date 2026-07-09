/**
 * 入口卡组件 — 数据驱动，items 在 data/reportEntries.ts 中声明。
 *
 * 数据日期（etlDate）与报告生成解耦：卡片先读 `/reports/<slug>/manifest.json`
 * 解析出真正存在的最新一期报告（resolveReport），再决定：
 *   - ready       → 正常打开（数据截止 = 报告日期）
 *   - stale       → 数据已更新但报告未刷新：醒目提醒「数据未更新」，仍可打开上一期
 *   - unavailable → 一期报告都没有 / manifest 拉不到：禁用，提示「报告暂未生成」
 */
import { memo, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Card } from '../../../shared/ui/Card'
import { badgeStyles, cn, colorClasses } from '../../../shared/styles'
import { usePermission } from '../../../shared/contexts/PermissionContext'
import { useBranch } from '../../../shared/contexts/BranchContext'
import { getReportUrl, type ReportEntry } from '../data/reportEntries'
import { resolveReportScope } from '../data/reportScope'
import { resolveReport } from '../data/resolveReport'
import { useReportManifest } from '../hooks/useReportManifest'

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
  // B346：报告随用户可见范围而不同 —— 分公司管理员看省级全量，
  // 三级机构用户看本机构版（orgs/<branch>/<org>/），其他角色无权限。
  const { userPermission } = usePermission()
  const scope = useMemo(() => resolveReportScope(userPermission), [userPermission])

  // 全国超管切省信号：仅多省超管把「有效省」透出给门户 URL（普通单省用户 → null，零变化）。
  // 门户 manifest / 报告 HTML 都不经 apiClient，故切省信号必须直接拼进 URL（见 reportEntries.ts）。
  const { isMultiBranch, effectiveBranch } = useBranch()
  const targetBranch = isMultiBranch ? effectiveBranch : null

  const { data: manifest, isLoading: manifestLoading } = useReportManifest(entry, scope, targetBranch)

  const resolution = resolveReport(manifest ?? null, etlDate)

  const reportUrl =
    scope.kind !== 'forbidden' && resolution.reportFile
      ? getReportUrl(entry.slug, resolution.reportFile, targetBranch)
      : null

  const isBusy = loading || manifestLoading
  const isClickable = !isBusy && reportUrl !== null
  const Icon = entry.icon
  const isStale = resolution.status === 'stale'

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
      className={cn(isStale && 'border-warning')}
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

      <ReportStatusFooter
        busy={isBusy}
        forbidden={scope.kind === 'forbidden'}
        orgScoped={scope.kind === 'org'}
        status={resolution.status}
        reportDate={resolution.reportDate}
        etlDate={etlDate}
      />
    </Card>
  )
})

function ReportStatusFooter({
  busy,
  forbidden,
  orgScoped,
  status,
  reportDate,
  etlDate,
}: {
  busy: boolean
  forbidden: boolean
  orgScoped: boolean
  status: ReturnType<typeof resolveReport>['status']
  reportDate: string | null
  etlDate: string | null
}) {
  if (forbidden) {
    return (
      <div className={cn('mt-4 text-sm', colorClasses.text.neutralMuted)}>
        当前账号暂无报告查看权限
      </div>
    )
  }

  if (busy) {
    return <div className={cn('mt-4 text-sm', colorClasses.text.neutralMuted)}>加载中…</div>
  }

  // 数据已更新但报告未刷新 —— 醒目提醒，但仍可打开上一期
  if (status === 'stale') {
    return (
      <div
        className={cn(
          'mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
          'bg-warning-bg text-warning-dark'
        )}
        role="status"
      >
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          数据未更新：报告截止{' '}
          <strong className="text-neutral-700 dark:text-neutral-200">{reportDate}</strong>
          ，当前数据已更新至{' '}
          <strong className="text-neutral-700 dark:text-neutral-200">{etlDate}</strong>
          。展示的是最近一期可用报告，点击新窗口打开。
        </span>
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <div className={cn('mt-4 text-sm', colorClasses.text.neutralMuted)}>
        {orgScoped ? '本机构报告暂未生成' : '报告暂未生成'}
        {etlDate ? `（数据已就绪至 ${etlDate}）` : ''}
      </div>
    )
  }

  // ready：正常可点开
  return (
    <div className={cn('mt-4 text-sm', colorClasses.text.neutralMuted)}>
      {reportDate ? (
        <span>
          数据截止 <strong className="text-neutral-700 dark:text-neutral-300">{reportDate}</strong> · 点击新窗口打开
        </span>
      ) : (
        <span>报告暂未生成</span>
      )}
    </div>
  )
}
