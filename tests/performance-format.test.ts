import { describe, expect, it } from 'vitest';
import { formatWanAdaptive } from '../src/shared/utils/formatters';

describe('performance premium formatting', () => {
  it('should keep 2 decimals when premium in wan is less than 1', () => {
    expect(formatWanAdaptive(0.9999)).toBe('1.00');
    expect(formatWanAdaptive(0.58)).toBe('0.58');
    expect(formatWanAdaptive(0.004)).toBe('0.00');
  });

  it('should keep 1 decimal when premium in wan is >= 1', () => {
    expect(formatWanAdaptive(1)).toBe('1.0');
    expect(formatWanAdaptive(1.24)).toBe('1.2');
    expect(formatWanAdaptive(12.66)).toBe('12.7');
  });
});
