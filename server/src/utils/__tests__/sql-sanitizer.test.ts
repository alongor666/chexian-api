import { describe, expect, it } from 'vitest';
import { isValidDateFormat, validateDateRange } from '../sql-sanitizer.js';

describe('isValidDateFormat', () => {
  it('accepts ISO YYYY-MM-DD', () => {
    expect(isValidDateFormat('2026-04-26')).toBe(true);
  });

  it('rejects malformed inputs', () => {
    expect(isValidDateFormat('2026/04/26')).toBe(false);
    expect(isValidDateFormat('not-a-date')).toBe(false);
    expect(isValidDateFormat('')).toBe(false);
  });

  it('rejects impossible calendar dates and accepts leap day', () => {
    expect(isValidDateFormat('2026-02-30')).toBe(false);
    expect(isValidDateFormat('2025-02-29')).toBe(false);
    expect(isValidDateFormat('2024-02-29')).toBe(true);
    expect(isValidDateFormat('2026-13-01')).toBe(false);
  });
});

describe('validateDateRange', () => {
  it('passes when both dates are valid and start <= end', () => {
    expect(() => validateDateRange('p', '2026-04-01', '2026-04-26')).not.toThrow();
    expect(() => validateDateRange('p', '2026-04-26', '2026-04-26')).not.toThrow();
  });

  it('passes when one or both ends are undefined (open range)', () => {
    expect(() => validateDateRange('p', undefined, '2026-04-26')).not.toThrow();
    expect(() => validateDateRange('p', '2026-04-01', undefined)).not.toThrow();
    expect(() => validateDateRange('p', undefined, undefined)).not.toThrow();
  });

  it('rejects start > end with helpful message', () => {
    expect(() => validateDateRange('currentPeriod', '2026-04-30', '2026-04-01'))
      .toThrow(/Invalid currentPeriod range: start \(2026-04-30\) is after end \(2026-04-01\)/);
  });

  it('rejects malformed start or end', () => {
    expect(() => validateDateRange('p', '2026/04/01', '2026-04-26'))
      .toThrow(/Invalid p\.start format/);
    expect(() => validateDateRange('p', '2026-04-01', 'bad'))
      .toThrow(/Invalid p\.end format/);
  });
});
