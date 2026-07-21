import { describe, expect, it } from 'vitest';
import { normalizeReleaseMetadata } from '../release.js';

describe('release metadata', () => {
  it('接受真实提交 SHA 与 ISO 构建时间', () => {
    expect(normalizeReleaseMetadata({
      releaseSha: 'a'.repeat(40),
      builtAt: '2026-07-21T07:00:00.000Z',
    })).toEqual({ releaseSha: 'a'.repeat(40), builtAt: '2026-07-21T07:00:00.000Z' });
    expect(normalizeReleaseMetadata({
      releaseSha: 'abc1234',
      builtAt: '2026-07-21T07:00:00.000Z',
    })).toEqual({ releaseSha: 'abc1234', builtAt: '2026-07-21T07:00:00.000Z' });
  });

  it('接受本地开发指纹', () => {
    expect(normalizeReleaseMetadata({
      releaseSha: 'dev',
      builtAt: '2026-07-21T07:00:00.000Z',
    })).toEqual({ releaseSha: 'dev', builtAt: '2026-07-21T07:00:00.000Z' });
  });

  it('拒绝缺失或格式无效的发布指纹', () => {
    expect(normalizeReleaseMetadata({ builtAt: '2026-07-21T07:00:00.000Z' })).toBeNull();
    expect(normalizeReleaseMetadata({ releaseSha: 'main', builtAt: '2026-07-21' })).toBeNull();
  });

  it('拒绝无效构建时间', () => {
    expect(normalizeReleaseMetadata({ releaseSha: 'abc1234', builtAt: 'not-a-date' })).toBeNull();
  });
});
