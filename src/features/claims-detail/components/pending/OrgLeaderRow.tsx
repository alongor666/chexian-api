/**
 * 未决赔案监控 — 机构排行单行
 * 序号 + 机构名 + 件数·万·案均 + 最长滞留高亮 + 风险条
 */
import { cn, colorClasses, fontStyles } from '@/shared/styles';
import { formatCount } from '@/shared/utils/formatters';
import { RiskBar } from './atoms';
import { severityForStayDays, severityToColor } from './insights';
import type { OrgRow } from './types';

interface Props {
  rank: number;
  org: OrgRow;
}

export function OrgLeaderRow({ rank, org }: Props) {
  const sev = severityForStayDays(org.max_pending_days);
  const c = severityToColor(sev);
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_60px_56px] gap-3 items-center py-2 border-t border-neutral-100 dark:border-subtle first:border-t-0">
      <span
        className={cn(
          'inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold',
          'bg-neutral-100 dark:bg-surface-2',
          colorClasses.text.neutralDark,
          fontStyles.numeric,
        )}
      >
        {rank.toString().padStart(2, '0')}
      </span>
      <div className="min-w-0">
        <div className={cn('text-sm font-semibold truncate', colorClasses.text.neutralBlack)}>
          {org.org ?? '—'}
        </div>
        <div
          className={cn(
            'text-[11px] mt-0.5',
            fontStyles.numeric,
            colorClasses.text.neutralMuted,
          )}
        >
          {formatCount(org.cases ?? 0)} 件 · {formatCount(org.reserve_wan ?? 0)} 万 ·
          案均 {formatCount(org.avg_reserve ?? 0)}
        </div>
      </div>
      <div className="text-right">
        <div className={cn('text-base font-bold', fontStyles.numeric, c.text)}>
          {org.max_pending_days ?? '-'}
        </div>
        <div className={cn('text-[10px]', colorClasses.text.neutralMuted)}>最长滞留</div>
      </div>
      <div className="justify-self-end">
        <RiskBar severity={sev} />
      </div>
    </div>
  );
}
