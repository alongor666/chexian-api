/**
 * 黄金基线排除语义回归测试（2026-07-17 评审 P1）。
 *
 * 锁定的事故场景：权限管理白名单收口后，基线账号 admin 访问 auth-users/auth-roles 恒 403；
 * 若只从 ENDPOINT_DEFINITIONS 删掉这两个端点，旧 baseline-manifest.json 里的 slug 不在任何
 * 排除集合 → --compare 仍去抓取 → 403 拖红整轮基线，必须先重新 --build 覆盖 oracle 才能用。
 * 修复语义（scripts/lib/golden-baseline-excludes.mjs）：
 *   - skipped（原因字符串）：保留定义供审计，抓取/对比均排除；
 *   - orphaned（定义已消失的 manifest slug）：警告跳过而非失败。
 */
import { describe, expect, it } from 'vitest';
import {
  isExcludedFromOracle,
  resolveComparableEndpoints,
} from '../scripts/lib/golden-baseline-excludes.mjs';

/** 模拟合并前生产机上的旧 manifest：仍含 auth-users / auth-roles */
const OLD_MANIFEST_ENDPOINTS = [
  { slug: 'kpi', path: '/api/query/kpi', deprecated: false },
  { slug: 'auth-me', path: '/api/auth/me', deprecated: false },
  { slug: 'auth-users', path: '/api/auth/users', deprecated: false },
  { slug: 'auth-roles', path: '/api/auth/roles', deprecated: false },
  { slug: 'coefficient', path: '/api/query/coefficient', deprecated: true },
];

const CURRENT_DEFINITIONS = [
  { slug: 'kpi', deprecated: false },
  { slug: 'auth-me', deprecated: false },
  { slug: 'auth-users', deprecated: false, skipped: '权限管理白名单收口，基线账号 admin 恒 403' },
  { slug: 'auth-roles', deprecated: false, skipped: '权限管理白名单收口，基线账号 admin 恒 403' },
  { slug: 'coefficient', deprecated: true },
];

describe('isExcludedFromOracle', () => {
  it('deprecated / volatile / skipped 任一即排除；普通端点不排除', () => {
    expect(isExcludedFromOracle({ slug: 'a', deprecated: true })).toBe(true);
    expect(isExcludedFromOracle({ slug: 'b', volatile: true })).toBe(true);
    expect(isExcludedFromOracle({ slug: 'c', skipped: '理由' })).toBe(true);
    expect(isExcludedFromOracle({ slug: 'd', deprecated: false })).toBe(false);
  });
});

describe('resolveComparableEndpoints × 旧 manifest（事故场景回归）', () => {
  it('skipped 端点即使还在旧 manifest 中也不参与对比（合并后无需先重新 --build）', () => {
    const { comparable, excluded } = resolveComparableEndpoints(
      CURRENT_DEFINITIONS,
      OLD_MANIFEST_ENDPOINTS,
    );
    expect(comparable.map((e) => e.slug)).toEqual(['kpi', 'auth-me']);
    expect(excluded.sort()).toEqual(['auth-roles', 'auth-users', 'coefficient']);
  });

  it('变异·去掉 skipped 标记 → 两端点重新进入对比集合（证明排除确由 skipped 驱动）', () => {
    const mutated = CURRENT_DEFINITIONS.map(({ skipped: _s, ...rest }) => rest);
    const { comparable } = resolveComparableEndpoints(mutated, OLD_MANIFEST_ENDPOINTS);
    expect(comparable.map((e) => e.slug)).toEqual(['kpi', 'auth-me', 'auth-users', 'auth-roles']);
  });

  it('定义中已彻底消失的 slug → orphaned 警告跳过，不进对比（删除定义不再拖红整轮）', () => {
    const withoutAuthPair = CURRENT_DEFINITIONS.filter(
      (e) => e.slug !== 'auth-users' && e.slug !== 'auth-roles',
    );
    const { comparable, orphaned } = resolveComparableEndpoints(
      withoutAuthPair,
      OLD_MANIFEST_ENDPOINTS,
    );
    expect(orphaned.sort()).toEqual(['auth-roles', 'auth-users']);
    expect(comparable.map((e) => e.slug)).toEqual(['kpi', 'auth-me']);
  });

  it('manifest 自带 deprecated 的条目按 excluded 处理（既有语义不回退）', () => {
    const { excluded } = resolveComparableEndpoints(CURRENT_DEFINITIONS, OLD_MANIFEST_ENDPOINTS);
    expect(excluded).toContain('coefficient');
  });
});
