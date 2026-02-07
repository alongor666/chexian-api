import { describe, it, expect } from 'vitest';
import { formatDateToISO } from '../src/features/filters/DateRangePicker';

describe('DateRangePicker', () => {
  it('should format date to ISO yyyy-mm-dd', () => {
    const date = new Date('2025-02-03T00:00:00Z');
    expect(formatDateToISO(date)).toBe('2025-02-03');
  });
});
