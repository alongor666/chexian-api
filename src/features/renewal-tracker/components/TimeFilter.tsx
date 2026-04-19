import { useState, useMemo, useEffect } from 'react';
import { cn, cardStyles, buttonStyles, colorClasses, fontStyles } from '@/shared/styles';
import type { TimeView, TimeRange, RenewalTrackerMeta } from '../types';

interface Props {
  meta: RenewalTrackerMeta | null;
  latestDataDate: string;
  timeView: TimeView;
  onViewChange: (view: TimeView) => void;
  onTimeChange: (range: TimeRange) => void;
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function fmt(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 续保追踪时间筛选器（按 expiry_date 语义，不与主站 FilterProvider 的 policy_date 混用）
 *
 * latestDataDate: 通常为今天或数据最新日（用于 YTD 的 end + cutoff 默认值）
 */
export default function TimeFilter({ meta, latestDataDate, timeView, onViewChange, onTimeChange }: Props) {
  const latest = latestDataDate || '';
  const year = useMemo(() => (latest ? parseInt(latest.slice(0, 4), 10) : new Date().getFullYear()), [latest]);
  const currentMonth = useMemo(() => {
    if (!latest) return 1;
    return parseInt(latest.slice(5, 7), 10);
  }, [latest]);

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [customStart, setCustomStart] = useState(yearStart);
  const [customEnd, setCustomEnd] = useState(latest || yearEnd);

  useEffect(() => {
    setSelectedMonth(currentMonth);
    setCustomStart(yearStart);
    setCustomEnd(latest || yearEnd);
  }, [currentMonth, yearStart, yearEnd, latest]);

  function applyRange(start: string, end: string, cutoff: string) {
    onTimeChange({ start, end, cutoff });
  }

  function handleViewChange(view: TimeView) {
    if (!latest) return;
    onViewChange(view);
    switch (view) {
      case 'ytd':
        applyRange(yearStart, latest, latest);
        break;
      case 'mtd_today':
        applyRange(fmt(year, currentMonth, 1), latest, latest);
        break;
      case 'mtd_full': {
        const last = lastDayOfMonth(year, currentMonth);
        applyRange(fmt(year, currentMonth, 1), fmt(year, currentMonth, last), latest);
        break;
      }
      case 'by_month': {
        const last = lastDayOfMonth(year, selectedMonth);
        applyRange(fmt(year, selectedMonth, 1), fmt(year, selectedMonth, last), latest);
        break;
      }
      case 'custom':
        applyRange(customStart, customEnd, latest);
        break;
    }
  }

  function handleMonthSelect(m: number) {
    if (!latest) return;
    setSelectedMonth(m);
    onViewChange('by_month');
    const last = lastDayOfMonth(year, m);
    applyRange(fmt(year, m, 1), fmt(year, m, last), latest);
  }

  function handleCustomApply() {
    if (!latest) return;
    if (!customStart || !customEnd) return;
    if (customStart > customEnd) return;
    onViewChange('custom');
    applyRange(customStart, customEnd, latest);
  }

  const views: { key: TimeView; label: string; hint: string }[] = [
    { key: 'ytd', label: '年累计', hint: `${yearStart} 至 ${latest || '—'}` },
    { key: 'mtd_today', label: '截至当日', hint: `${year}-${String(currentMonth).padStart(2, '0')}-01 至 ${latest || '—'}` },
    { key: 'mtd_full', label: '当月全月', hint: `${year}-${String(currentMonth).padStart(2, '0')} 全月` },
  ];

  const toggleClass = (active: boolean) =>
    cn(
      buttonStyles.base,
      buttonStyles.sizeSmall,
      active ? buttonStyles.primary : buttonStyles.secondary,
    );

  const monthButtonClass = (active: boolean) =>
    cn(
      'w-8 h-8 text-xs rounded border transition-colors',
      active
        ? cn(colorClasses.bg.primarySolid, 'text-white', colorClasses.border.primary)
        : cn('bg-white dark:bg-surface-2', colorClasses.text.neutralLight, colorClasses.border.neutral, 'hover:bg-neutral-100 dark:hover:bg-surface-3'),
    );

  const dateInputClass = cn(
    'px-2 py-1 text-sm border rounded bg-white dark:bg-surface-2',
    colorClasses.text.neutralBlack,
    colorClasses.border.neutral,
  );

  return (
    <div className={cn(cardStyles.base, 'p-4 mb-4')}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className={cn('text-sm mr-2 shrink-0', colorClasses.text.neutralMuted)}>时间视图 (按到期日):</span>
        {views.map(v => (
          <button
            key={v.key}
            onClick={() => handleViewChange(v.key)}
            title={v.hint}
            className={toggleClass(timeView === v.key)}
          >
            {v.label}
          </button>
        ))}
        <span className={cn('mx-1', colorClasses.text.neutralMuted)}>|</span>
        <span className={cn('text-sm mr-1 shrink-0', colorClasses.text.neutralMuted)}>按到期月:</span>
        {MONTHS.map(m => (
          <button
            key={m}
            onClick={() => handleMonthSelect(m)}
            className={monthButtonClass(timeView === 'by_month' && selectedMonth === m)}
          >
            {m}
          </button>
        ))}
        <span className={cn('mx-1', colorClasses.text.neutralMuted)}>|</span>
        <input
          type="date"
          aria-label="自选时间范围起始日"
          value={customStart}
          min={yearStart}
          max={yearEnd}
          onChange={e => setCustomStart(e.target.value)}
          className={dateInputClass}
        />
        <span className={colorClasses.text.neutralMuted}>—</span>
        <input
          type="date"
          aria-label="自选时间范围截止日"
          value={customEnd}
          min={yearStart}
          max={yearEnd}
          onChange={e => setCustomEnd(e.target.value)}
          className={dateInputClass}
        />
        <button
          onClick={handleCustomApply}
          className={toggleClass(timeView === 'custom')}
        >
          自选
        </button>
      </div>
      {meta && (
        <div className={cn('text-xs', colorClasses.text.neutralMuted)}>
          <span className="mr-3">
            数据截至{' '}
            <span className={cn(colorClasses.text.neutralBlack, 'font-medium', fontStyles.numeric)}>
              {latest}
            </span>
          </span>
          <span className="mr-3">
            Universe{' '}
            <span className={fontStyles.numeric}>
              {meta.exposure_row_count?.toLocaleString()}
            </span>{' '}
            条暴露 /{' '}
            <span className={fontStyles.numeric}>
              {meta.distinct_vehicle_count?.toLocaleString()}
            </span>{' '}
            辆车
          </span>
        </div>
      )}
    </div>
  );
}
