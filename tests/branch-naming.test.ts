/**
 * 多省 ETL 路由纯函数单测（0a：SX 输出隔离，绝不进 current/）
 *
 * 锁定：
 * - SC（四川/默认）行为＝现状：源读脚本根、输出写 fact/policy/current
 * - 非 SC 省：源读 staging/<省>、输出写 validation/<省>（隔离）
 * - 硬护栏：非 SC 省输出根若落入 policy/current 必 throw（ADR D5 防回归）
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { branchSourceDir, branchOutputRoot } from '../数据管理/lib/branch-naming.mjs';

describe('branchSourceDir', () => {
  it('SC / 空 → 脚本根（现状，零差异）', () => {
    expect(branchSourceDir('/r', 'SC')).toBe('/r');
    expect(branchSourceDir('/r', undefined)).toBe('/r');
  });

  it('SX → staging/SX', () => {
    expect(branchSourceDir('/r', 'SX')).toBe(join('/r', 'staging', 'SX'));
  });
});

describe('branchOutputRoot', () => {
  it('SC / 空 → fact/policy/current（共享 runtime，现状）', () => {
    expect(branchOutputRoot('/w', 'SC')).toBe(join('/w', 'fact', 'policy', 'current'));
    expect(branchOutputRoot('/w', undefined)).toBe(join('/w', 'fact', 'policy', 'current'));
  });

  it('SX → validation/SX（隔离目录，不进 current/）', () => {
    const out = branchOutputRoot('/w', 'SX');
    expect(out).toBe(join('/w', 'validation', 'SX'));
    expect(out.includes(join('policy', 'current'))).toBe(false);
  });

  it('硬护栏：非 SC 省输出根落入 policy/current 必 throw（D5 防回归）', () => {
    // warehouseRoot 被误传成 current 目录 → 结果会含 policy/current → 必须拦截
    expect(() => branchOutputRoot(join('/w', 'fact', 'policy', 'current'), 'SX')).toThrow(/policy/);
  });
});
