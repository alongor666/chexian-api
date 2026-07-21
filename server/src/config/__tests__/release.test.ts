import { describe, expect, it } from 'vitest';
import { normalizeReleaseMetadata } from '../release.js';

describe('release metadata', () => {
  it('接受真实提交 SHA 与 ISO 构建时间', () => {
    expect(normalizeReleaseMetadata({
      releaseSha: 'a'.repeat(40),
      builtAt: '2026-07-21T07:00:00.000Z',
    })).toEqual({ releaseSha: 'a'.repeat(40), builtAt: '2026-07-21T07:00:00.000Z' });
  });

  it('拒绝缺失或伪造的生产发布指纹', () => {
    expect(normalizeReleaseMetadata({ releaseSha: 'main', builtAt: '2026-07-21' })).toBeNull();
    expect(normalizeReleaseMetadata({ releaseSha: 'abc1234', builtAt: 'not-a-date' })).toBeNull();
  });
});
