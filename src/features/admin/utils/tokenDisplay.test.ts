import { describe, it, expect, vi } from 'vitest';
import { fmtDate, maskTokenId, isExpired } from './tokenDisplay';
import type { ApiTokenInfo } from '../../../shared/api/client';

/** 仅 isExpired 关心 revokedAt / expiresAt，其余字段填占位 */
function token(partial: Partial<ApiTokenInfo>): ApiTokenInfo {
  return {
    tokenId: 'id',
    name: 'n',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2999-01-01T00:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
    ...partial,
  } as ApiTokenInfo;
}

describe('fmtDate', () => {
  it('空值（null/undefined/空串）→ 「—」', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('')).toBe('—');
  });

  it('合法 ISO → zh-CN 本地化（与 toLocaleString 同源，避免时区耦合）', () => {
    const iso = '2026-06-22T08:30:00Z';
    expect(fmtDate(iso)).toBe(new Date(iso).toLocaleString('zh-CN', { hour12: false }));
  });

  it('非法时间串不抛错，返回字符串（toLocaleString 给 Invalid Date）', () => {
    expect(typeof fmtDate('not-a-date')).toBe('string');
    expect(fmtDate('not-a-date')).toBe(new Date('not-a-date').toLocaleString('zh-CN', { hour12: false }));
  });

  it('toLocaleString 抛错时走 catch 分支 → 回退原 iso 串', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(fmtDate('2026-06-22T08:30:00Z')).toBe('2026-06-22T08:30:00Z');
    spy.mockRestore();
  });
});

describe('maskTokenId', () => {
  it('长度 ≤6 原样返回', () => {
    expect(maskTokenId('')).toBe('');
    expect(maskTokenId('abc')).toBe('abc');
    expect(maskTokenId('abcdef')).toBe('abcdef'); // 恰好 6
  });

  it('长度 >6 脱敏为「首 4…末 2」', () => {
    expect(maskTokenId('abcdefg')).toBe('abcd…fg'); // 7
    expect(maskTokenId('cx_pat_12345')).toBe('cx_p…45');
  });
});

describe('isExpired', () => {
  it('已吊销 → true（即使过期时间在未来）', () => {
    expect(isExpired(token({ revokedAt: '2026-06-01T00:00:00Z', expiresAt: '2999-01-01T00:00:00Z' }))).toBe(true);
  });

  it('未吊销 + 过期时间已过 → true', () => {
    expect(isExpired(token({ revokedAt: null, expiresAt: '2000-01-01T00:00:00Z' }))).toBe(true);
  });

  it('未吊销 + 过期时间在未来 → false', () => {
    expect(isExpired(token({ revokedAt: null, expiresAt: '2999-01-01T00:00:00Z' }))).toBe(false);
  });
});
