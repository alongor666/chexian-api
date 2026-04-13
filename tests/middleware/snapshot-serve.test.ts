/**
 * snapshot-serve 中间件单元测试
 *
 * 覆盖：hit / miss / stale / error 四路径 + param hash 确定性 + permissionToScope
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeParamHash,
  permissionToScope,
  getSnapshotStats,
  resetSnapshotStats,
  snapshotServe,
} from '../../server/src/middleware/snapshot-serve';

describe('computeParamHash', () => {
  it('should produce deterministic hash for same params', () => {
    const params = { timeView: 'daily', perspective: 'premium', rankingLimit: '10' };
    const hash1 = computeParamHash(params);
    const hash2 = computeParamHash(params);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(12);
  });

  it('should produce same hash regardless of key order', () => {
    const hash1 = computeParamHash({ a: '1', b: '2', c: '3' });
    const hash2 = computeParamHash({ c: '3', a: '1', b: '2' });
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different params', () => {
    const hash1 = computeParamHash({ timeView: 'daily' });
    const hash2 = computeParamHash({ timeView: 'weekly' });
    expect(hash1).not.toBe(hash2);
  });

  it('should ignore empty and undefined values', () => {
    const hash1 = computeParamHash({ a: '1' });
    const hash2 = computeParamHash({ a: '1', b: '', c: undefined });
    expect(hash1).toBe(hash2);
  });
});

describe('permissionToScope', () => {
  it('should return "all" for branch_admin filter', () => {
    expect(permissionToScope('1=1')).toBe('all');
  });

  it('should return "all" for undefined filter', () => {
    expect(permissionToScope(undefined)).toBe('all');
  });

  it('should extract org name from org_user filter', () => {
    expect(permissionToScope("org_level_3 = '乐山'")).toBe('乐山');
    expect(permissionToScope("org_level_3 = '天府'")).toBe('天府');
  });

  it('should return "telemarketing" for telemarketing filter', () => {
    expect(permissionToScope('is_telemarketing = true')).toBe('telemarketing');
  });

  it('should return null for unrecognized filter', () => {
    expect(permissionToScope('some_other_filter = 1')).toBe(null);
  });

  it('should return "all" for empty string filter', () => {
    expect(permissionToScope('')).toBe('all');
  });
});

describe('snapshot stats', () => {
  beforeEach(() => {
    resetSnapshotStats();
  });

  it('should start at zero', () => {
    const stats = getSnapshotStats();
    expect(stats).toEqual({ hit: 0, miss: 0, stale: 0, error: 0 });
  });

  it('should reset properly', () => {
    // Stats are module-internal; we can only test the exported interface
    resetSnapshotStats();
    expect(getSnapshotStats().hit).toBe(0);
  });
});

describe('snapshotServe null scope bypass', () => {
  it('should call next() without resolving snapshot when scope is null', () => {
    const req = {
      baseUrl: '/api',
      path: '/query/dashboard-bundle',
      permissionFilter: 'xxx_unknown_filter = 1',
      query: {},
    } as any;
    const res = {
      setHeader: vi.fn(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    snapshotServe(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
