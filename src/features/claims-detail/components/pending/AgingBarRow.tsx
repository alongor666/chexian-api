/**
 * 未决赔案监控 — 账龄分布单行（水平件数 + 金额条）
 */
import { cn, colorClasses, fontStyles } from '@/shared/styles';
import { formatCount } from '@/shared/utils/formatters';
import { StatusPill } from './atoms';

interface AgingBarRowProps {
  label: string;
  cases: number;
  amountWan: number;
  totalCases: number;
  totalAmount: number;
  warn?: boolean;
}

export function AgingBarRow({
  label,
  cases,
  amountWan,
  totalCases,
  totalAmount,
  warn,
}: AgingBarRowProps) {
  const empty = cases === 0 && amountWan === 0;
  const casePct = totalCases > 0 ? Math.min((cases / totalCases) * 100, 100) : 0;
  const amountPct = totalAmount > 0 ? Math.min((amountWan / totalAmount) * 100, 100) : 0;
  return (
    <div className={empty ? 'opacity-40' : ''}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {warn && <StatusPill severity="warn" label="关注" />}
          <span className={cn('text-sm font-medium', colorClasses.text.neutralBlack)}>
            {label}
          </span>
        </div>
        <span className={cn(fontStyles.numeric, 'text-xs', colorClasses.text.neutralDark)}>
          <span className={cn('font-semibold', colorClasses.text.neutralBlack)}>
            {formatCount(cases)}
          </span>
          {' 件'}
          <span className={cn('mx-2', colorClasses.text.neutralMuted)}>·</span>
          <span className={cn('font-semibold', colorClasses.text.neutralBlack)}>
            {formatCount(amountWan)}
          </span>
          {' 万'}
        </span>
      </div>
      <div className="grid grid-cols-[40px_1fr] gap-2 items-center mb-1">
        <span className={cn('text-[10px]', colorClasses.text.neutralMuted)}>件数</span>
        <div className="h-2 rounded-full bg-neutral-100 dark:bg-surface-2 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${casePct}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-[40px_1fr] gap-2 items-center">
        <span className={cn('text-[10px]', colorClasses.text.neutralMuted)}>金额</span>
        <div className="h-2 rounded-full bg-neutral-100 dark:bg-surface-2 overflow-hidden">
          <div
            className="h-full bg-sky rounded-full transition-all"
            style={{ width: `${amountPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
