import { formatRate } from '../../../shared/utils/formatters';

export function formatPercent1(val: number | null | undefined): string {
  if (val === null || val === undefined) return '-';
  return formatRate(val);
}

export function getSafeDateStr(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date) {
    const year = val.getFullYear();
    const month = String(val.getMonth() + 1).padStart(2, '0');
    const day = String(val.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof val === 'number') {
    const date = new Date(val);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  if (typeof val === 'string') {
    return val.split('T')[0];
  }
  return String(val);
}
