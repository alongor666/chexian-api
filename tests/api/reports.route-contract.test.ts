import { describe, expect, it } from 'vitest';
import { isValidSnapshotDate } from '../../server/src/routes/reports';

describe('reports route contract', () => {
  it('validates snapshot names as real calendar dates', () => {
    expect(isValidSnapshotDate('2026-05-17')).toBe(true);
    expect(isValidSnapshotDate('2026-02-29')).toBe(false);
    expect(isValidSnapshotDate('2026-02-30')).toBe(false);
    expect(isValidSnapshotDate('2026-13-01')).toBe(false);
    expect(isValidSnapshotDate('2026-00-10')).toBe(false);
    expect(isValidSnapshotDate('20260517')).toBe(false);
  });

  it('accepts leap day only in leap years', () => {
    expect(isValidSnapshotDate('2024-02-29')).toBe(true);
    expect(isValidSnapshotDate('2025-02-29')).toBe(false);
  });
});
