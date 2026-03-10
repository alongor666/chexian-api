import { describe, expect, it } from 'vitest';
import { getTrendColorClass, getTrendColorClassByPolarity } from '../src/shared/styles';

describe('metric polarity trend color mapping', () => {
  it('maps positive + up to green', () => {
    expect(getTrendColorClassByPolarity('up', 'positive')).toContain('text-success');
  });

  it('maps positive + down to red', () => {
    expect(getTrendColorClassByPolarity('down', 'positive')).toContain('text-danger');
  });

  it('maps negative + up to red', () => {
    expect(getTrendColorClassByPolarity('up', 'negative')).toContain('text-danger');
  });

  it('maps negative + down to green', () => {
    expect(getTrendColorClassByPolarity('down', 'negative')).toContain('text-success');
  });

  it('keeps inverse parameter backward compatible', () => {
    expect(getTrendColorClass(3.2, true)).toContain('text-danger');
    expect(getTrendColorClass(-1.5, true)).toContain('text-success');
  });
});

