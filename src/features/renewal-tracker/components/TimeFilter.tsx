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

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function fmt(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 在指定日期加 N 天，返回 YYYY-MM-DD（本地时区）
 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return fmt(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/**
 * 续保追踪时间筛选器（按 expiry_date 语义）
 *
 * 4 种视图 + 按到期月下拉：
 *   ytd          年累计（截至当日） — 1-1 ~ 最新日
 *   mtd_today    当月至当日         — 当月 1 日 ~ 最新日
 *   next_to_eom  次日至月底         — 最新日+1 ~ 当月月末
 *   next_30_days 未来 30 天         — 最新日+1 ~ +30
 *   by_month     按到期月           — 下拉选中的月 1 日 ~ 月末（只允许 1 ~ 当月）
 */
export default function TimeFilter({ meta, latestDataDate, timeView, onViewChange, onTimeChange }: Props) {
  const latest = latestDataDate || '';
  const year = useMemo(() => (latest ? parseInt(latest.slice(0, 4), 10) : new Date().getFullYear()), [latest]);
  const currentMonth = useMemo(() => {
    if (!latest) return 1;
    return parseInt(latest.slice(5, 7), 10);
  }, [latest]);

  const yearStart = `${year}-01-01`;
  const monthOptions = useMemo(
    () => Array.from({ length: currentMonth }, (_, i) => i + 1),
    [currentMonth]
  );

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  useEffect(() => {
    setSelectedMonth(currentMonth);
  }, [currentMonth]);

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
      case 'next_to_eom': {
        const last = lastDayOfMonth(year, currentMonth);
        const next = addDays(latest, 1);
        const end = fmt(year, currentMonth, last);
        applyRange(next, end, latest);
        break;
      }
      case 'next_30_days': {
        const next = addDays(latest, 1);
        const end = addDays(latest, 30);
        applyRange(next, end, latest);
        break;
      }
      case 'by_month': {
        const last = lastDayOfMonth(year, selectedMonth);
        applyRange(fmt(year, selectedMonth, 1), fmt(year, selectedMonth, last), latest);
        break;
      }
    }
  }

  function handleMonthSelect(m: number) {
    if (!latest) return;
    setSelectedMonth(m);
    onViewChange('by_month');
    const last = lastDayOfMonth(year, m);
    applyRange(fmt(year, m, 1), fmt(year, m, last), latest);
  }

  const views: { key: TimeView; label: string; hint: string }[] = useMemo(() => {
    if (!latest) {
      return [
        { key: 'ytd', label: '年累计', hint: '—' },
        { key: 'mtd_today', label: '当月至当日', hint: '—' },
        { key: 'next_to_eom', label: '次日至月底', hint: '—' },
        { key: 'next_30_days', label: '未来30天', hint: '—' },
      ];
    }
    const last = lastDayOfMonth(year, currentMonth);
    const eomStr = fmt(year, currentMonth, last);
    const nextDay = addDays(latest, 1);
    const plus30 = addDays(latest, 30);
    return [
      { key: 'ytd', label: '年累计', hint: `${yearStart} 至 ${latest}` },
      { key: 'mtd_today', label: '当月至当日', hint: `${fmt(year, currentMonth, 1)} 至 ${latest}` },
      { key: 'next_to_eom', label: '次日至月底', hint: `${nextDay} 至 ${eomStr}` },
      { key: 'next_30_days', label: '未来30天', hint: `${nextDay} 至 ${plus30}` },
    ];
  }, [latest, year, currentMonth, yearStart]);

  const toggleClass = (active: boolean) =>
    cn(
      buttonStyles.base,
      buttonStyles.sizeSmall,
      active ? buttonStyles.primary : buttonStyles.secondary,
    );

  const selectClass = cn(
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
        <label className={cn('text-sm mr-1 shrink-0', colorClasses.text.neutralMuted)} htmlFor="expiry-month-select">
          按到期月:
        </label>
        <select
          id="expiry-month-select"
          value={timeView === 'by_month' ? selectedMonth : currentMonth}
          onChange={e => handleMonthSelect(parseInt(e.target.value, 10))}
          className={selectClass}
          aria-label="到期月"
        >
          {monthOptions.map(m => (
            <option key={m} value={m}>
              {year}-{String(m).padStart(2, '0')}
            </option>
          ))}
        </select>
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
