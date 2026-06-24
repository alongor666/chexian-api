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
import { branchSourceDir, branchOutputRoot, isPolicyCurrentSubdirLayout } from '../数据管理/lib/branch-naming.mjs';

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

  // B2 gated 写侧：subdirLayout 显式传参（纯函数，不依赖 env）
  it('SC + subdirLayout=true → current/SC/（gated 子目录布局）', () => {
    expect(branchOutputRoot('/w', 'SC', { subdirLayout: true }))
      .toBe(join('/w', 'fact', 'policy', 'current', 'SC'));
  });

  it('SC + subdirLayout=false → current/（扁平，字节安全默认）', () => {
    expect(branchOutputRoot('/w', 'SC', { subdirLayout: false }))
      .toBe(join('/w', 'fact', 'policy', 'current'));
  });

  it('SX + subdirLayout=true → 仍 validation/SX（subdirLayout 不影响非 SC，SX 仍 GATED 隔离）', () => {
    expect(branchOutputRoot('/w', 'SX', { subdirLayout: true }))
      .toBe(join('/w', 'validation', 'SX'));
  });
});

describe('isPolicyCurrentSubdirLayout（B2 gated 写侧专用开关）', () => {
  it('POLICY_CURRENT_SUBDIR_LAYOUT=true → true', () => {
    expect(isPolicyCurrentSubdirLayout({ POLICY_CURRENT_SUBDIR_LAYOUT: 'true' })).toBe(true);
  });

  it('未设 / 其它值 → false（默认扁平，字节安全）', () => {
    expect(isPolicyCurrentSubdirLayout({})).toBe(false);
    expect(isPolicyCurrentSubdirLayout({ POLICY_CURRENT_SUBDIR_LAYOUT: 'false' })).toBe(false);
    expect(isPolicyCurrentSubdirLayout({ POLICY_CURRENT_SUBDIR_LAYOUT: '1' })).toBe(false);
  });

  it('不复用 BRANCH_RLS_ENABLED（codex 闸-1 P0-3：RLS 开关不驱动 ETL 写布局）', () => {
    expect(isPolicyCurrentSubdirLayout({ BRANCH_RLS_ENABLED: 'true' })).toBe(false);
  });
});
