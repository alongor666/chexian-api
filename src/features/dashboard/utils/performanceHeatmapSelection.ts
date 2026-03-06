import type { PerformanceTimePeriod } from '../hooks/usePerformanceSummary';

export interface PerformanceHeatmapSelection {
  org: string;
  date: string;
}

export interface PerformanceHeatmapPeriodRange {
  startDate: string;
  endDate: string;
}

export type PerformanceDrillSource = 'root' | 'heatmap' | 'row';

const YEAR_RE = /^\d{4}$/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function createUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function parseYmdDate(raw: string): Date | null {
  const token = raw.trim().slice(0, 10);
  if (!DATE_RE.test(token)) return null;

  const [yearText, monthText, dayText] = token.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const parsed = createUtcDate(year, month, day);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function parseYearMonthDate(raw: string): Date | null {
  const token = raw.trim().slice(0, 7);
  if (!YEAR_MONTH_RE.test(token)) return null;

  const [yearText, monthText] = token.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;

  const parsed = createUtcDate(year, month, 1);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1) {
    return null;
  }
  return parsed;
}

function parseYearDate(raw: string): Date | null {
  const token = raw.trim().slice(0, 4);
  if (!YEAR_RE.test(token)) return null;

  const year = Number(token);
  if (!Number.isInteger(year)) return null;
  return createUtcDate(year, 1, 1);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(date: Date, months: number): Date {
  return createUtcDate(date.getUTCFullYear(), date.getUTCMonth() + 1 + months, date.getUTCDate());
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolvePerformanceHeatmapPeriodRange(
  rawDate: string,
  timePeriod: PerformanceTimePeriod
): PerformanceHeatmapPeriodRange | null {
  if (timePeriod === 'year') {
    const start = parseYearDate(rawDate);
    if (!start) return null;
    return {
      startDate: formatUtcDate(start),
      endDate: formatUtcDate(createUtcDate(start.getUTCFullYear(), 12, 31)),
    };
  }

  if (timePeriod === 'month') {
    const start = parseYearMonthDate(rawDate) ?? parseYmdDate(rawDate);
    if (!start) return null;
    return {
      startDate: formatUtcDate(start),
      endDate: formatUtcDate(addUtcDays(addUtcMonths(start, 1), -1)),
    };
  }

  const start = parseYmdDate(rawDate);
  if (!start) return null;

  if (timePeriod === 'quarter') {
    return {
      startDate: formatUtcDate(start),
      endDate: formatUtcDate(addUtcDays(addUtcMonths(start, 3), -1)),
    };
  }

  if (timePeriod === 'week') {
    return {
      startDate: formatUtcDate(start),
      endDate: formatUtcDate(addUtcDays(start, 6)),
    };
  }

  return {
    startDate: formatUtcDate(start),
    endDate: formatUtcDate(start),
  };
}

export function applyPerformanceHeatmapSelectionToParams(
  params: Record<string, string>,
  selection: PerformanceHeatmapSelection | null,
  timePeriod: PerformanceTimePeriod
): Record<string, string> {
  if (!selection) return params;

  const periodRange = resolvePerformanceHeatmapPeriodRange(selection.date, timePeriod);
  if (!periodRange) return params;

  return {
    ...params,
    dateField: 'policy_date',
    startDate: periodRange.startDate,
    endDate: periodRange.endDate,
  };
}

export function resolvePerformanceDrillSource(
  pendingRowValue: string | null,
  heatmapSelection: PerformanceHeatmapSelection | null
): PerformanceDrillSource {
  if (pendingRowValue !== null) return 'row';
  if (heatmapSelection) return 'heatmap';
  return 'root';
}
