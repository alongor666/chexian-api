/**
 * 概览带（借鉴方案 B/C）— 一眼定位大盘 + 最差机构预警
 *
 * 左：整体续保率（核心健康指标，按分级着色）+ 整体报价率
 * 中：应续→报价→已续 大漏斗
 * 右：续保率最低的机构排行（点击即选中下钻，与左表联动）
 */
import { useMemo } from 'react';
import { cn, cardStyles, colorClasses, fontStyles } from '@/shared/styles';
import { formatCount } from '@/shared/utils/formatters';
import HeroFunnel from './HeroFunnel';
import { formatPct } from '../utils/format';
import { gradeRate, renewRate, isBadRow, type Grade } from '../utils/grading';
import type { RenewalRow, Selection } from '../types';

interface Props {
  overall: RenewalRow | null;
  orgRows: RenewalRow[];
  selection: Selection;
  onSelectOrg: (org: string) => void;
}

const RATE_TEXT: Record<Grade, string> = {
  g: colorClasses.text.neutralBlack,
  w: colorClasses.text.warningDark,
  d: colorClasses.text.dangerDark,
};

const TRACK_FILL: Record<Grade, string> = {
  g: 'bg-success',
  w: 'bg-warning',
  d: 'bg-danger',
};

function shortOrg(name: string | null): string {
  return (name || '—').replace('中心支公司', '').replace('分公司', '');
}

export default function OverviewBand({ overall, orgRows, selection, onSelectOrg }: Props) {
  const orgs = useMemo(() => orgRows.filter(r => r.row_level === 'org'), [orgRows]);

  // 仅对有应续业务（A>0）的机构排「续保率最低」——零应续是无数据，不是最差
  const worst = useMemo(() => {
    return orgs
      .filter(o => o.A > 0)
      .sort((a, b) => (renewRate(a) ?? 0) - (renewRate(b) ?? 0))
      .slice(0, 5);
  }, [orgs]);

  if (!overall) return null;

  const overallRate = renewRate(overall);
  const overallGrade = gradeRate('renew', overallRate);
  // 仅当确有续保率跌破健康线的机构时才升起 ⚠ 红标，避免「全员健康」时过度预警
  const hasBad = worst.some(isBadRow);

  return (
    <div className={cn(cardStyles.base, 'mb-4 overflow-hidden')}>
      <div className="grid grid-cols-1 lg:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1fr)] gap-7 items-center px-5 py-4">
        {/* KPI */}
        <div className="flex gap-7">
          <div className="flex flex-col gap-0.5">
            <span className={cn(fontStyles.kpi, 'text-[34px] leading-none', RATE_TEXT[overallGrade])}>
              {formatPct(overall.C, overall.A)}
            </span>
            <span
              className={cn('text-xs', colorClasses.text.neutralLight)}
              title="续保率 = 已续件数 ÷ 应续件数（按到期日统计、车架号去重）"
            >整体续保率 C/A · 核心健康指标</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className={cn(fontStyles.kpi, 'text-[26px] leading-none', colorClasses.text.neutral)}>
              {formatPct(overall.B, overall.A)}
            </span>
            <span
              className={cn('text-xs', colorClasses.text.neutralLight)}
              title="应续报价率 = 报价件数 ÷ 应续件数（按到期日统计、车架号去重）。注意区分：「报价转化分析」页的承保转化率以报价单量为分母，两页口径不同"
            >整体应续报价率 B/A</span>
          </div>
        </div>

        {/* Hero funnel */}
        <HeroFunnel row={overall} />

        {/* Worst orgs */}
        <div className="min-w-0">
          <div className={cn('text-xs mb-1.5 flex items-center gap-1.5', hasBad ? colorClasses.text.dangerDark : colorClasses.text.neutralLight)}>
            {hasBad && <span aria-hidden>⚠</span>}
            <span>续保率最低的机构（点击下钻）</span>
          </div>
          <div className="flex flex-col gap-1">
            {worst.map(o => {
              const rate = renewRate(o);
              const grade = gradeRate('renew', rate);
              const selected = selection.kind !== 'overall' && selection.org === o.org_level_3;
              return (
                <button
                  key={o.org_level_3}
                  type="button"
                  onClick={() => o.org_level_3 && onSelectOrg(o.org_level_3)}
                  className={cn(
                    'grid grid-cols-[64px_1fr_52px] items-center gap-2.5 w-full px-1.5 py-1 rounded-md text-left transition-colors',
                    selected ? colorClasses.bg.primary : 'hover:bg-neutral-50 dark:hover:bg-surface-2',
                  )}
                  title={`${o.org_level_3} · 续保率 ${formatPct(o.C, o.A)} · 应续 ${formatCount(o.A)}`}
                >
                  <span className={cn('text-xs truncate', colorClasses.text.neutral)}>{shortOrg(o.org_level_3)}</span>
                  <span className="h-2.5 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
                    <span
                      className={cn('block h-full rounded-full', TRACK_FILL[grade])}
                      style={{ width: `${Math.min(100, (rate ?? 0) * 100)}%` }}
                    />
                  </span>
                  <span className={cn('text-xs font-semibold text-right', fontStyles.numeric, RATE_TEXT[grade])}>
                    {formatPct(o.C, o.A)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
