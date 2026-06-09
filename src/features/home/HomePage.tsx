/**
 * 门户首页 — 登录后第一眼。
 *
 * 顶部欢迎条（含数据截止日 + 用户名） + 入口卡 grid 区。
 * 入口卡数据由 `data/reportEntries.ts` 声明，无需改本文件即可扩展。
 */
import { useQuery } from '@tanstack/react-query'
import { ReportEntryCard } from './components/ReportEntryCard'
import { reportEntries } from './data/reportEntries'
import { usePermission } from '../../shared/contexts/PermissionContext'
import { cn, colorClasses, fontStyles, layoutStyles } from '../../shared/styles'
import { apiClient } from '../../shared/api/client'

export const HomePage = () => {
  const { userPermission } = usePermission()
  const userName = userPermission?.displayName || userPermission?.username || '同事'

  const { data: dataVersion, isLoading } = useQuery({
    queryKey: ['data-version', userPermission?.username ?? null],
    queryFn: () => apiClient.data.version().catch(() => null),
    enabled: !!userPermission,
    staleTime: 60 * 60 * 1000, // 1 小时
  })

  const etlDate = dataVersion?.etlDate ?? null

  return (
    <div className="p-6 space-y-6">
      <section className={cn(
        'rounded-xl border border-neutral-200 dark:border-subtle',
        'bg-gradient-to-r from-primary-bg via-white to-neutral-50',
        'dark:from-surface-1 dark:via-surface-1 dark:to-surface-2',
        'px-6 py-5',
      )}>
        <h1 className="text-xl font-semibold text-neutral-800 dark:text-neutral-200">
          欢迎回来，{userName}
        </h1>
        <p className={cn('mt-1 text-sm', colorClasses.text.neutralMuted)}>
          {isLoading ? (
            <span>正在加载数据状态…</span>
          ) : etlDate ? (
            <>
              数据已就绪，当前截止日{' '}
              <strong className={cn(fontStyles.numeric, 'text-neutral-700 dark:text-neutral-300')}>
                {etlDate}
              </strong>
              {' · '}
              点击下方报告卡，新窗口打开静态报告
            </>
          ) : (
            <span>数据尚未就绪（无法读取 ETL 日期）</span>
          )}
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
          经营全局画像
        </h2>
        <div className={layoutStyles.grid3}>
          {reportEntries.map((entry) => (
            <ReportEntryCard
              key={entry.id}
              entry={entry}
              etlDate={etlDate}
              loading={isLoading}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
