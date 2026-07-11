/**
 * 用户级路由白名单对齐 —— 纯函数测试
 *
 * 覆盖：补缺 / 不删多余 / 其余字段不动 / 幂等 / 无关角色跳过 / 缺字段用户补全。
 * 背景见 scripts/ops/align-user-routes.mjs 文件头（2026-07-10 org_user 用户级
 * allowedRoutes 停在旧三条、缺 /home 的生产漂移）。
 */
import { describe, expect, it } from 'vitest';
import {
  planUserRouteAdditions,
  applyUserRouteAdditions,
} from '../lib/align-user-routes-core.mjs';

const PRESET_ROLES = [
  { role: 'branch_admin', name: '分公司管理员', dataScope: 'all' },
  {
    role: 'org_user',
    name: '三级机构用户',
    dataScope: 'org',
    allowedRoutes: ['/home', '/performance-analysis', '/growth', '/specialty'],
    defaultRoute: '/performance-analysis',
  },
  { role: 'telemarketing_user', name: '电销用户', dataScope: 'telemarketing' },
];

const OLD_THREE = ['/performance-analysis', '/growth', '/specialty'];

function makeStore() {
  return {
    users: [
      {
        username: 'tianfu',
        passwordHash: '$2b$10$hash-tianfu',
        role: 'org_user',
        organization: '天府',
        branchCode: 'SC',
        active: true,
        allowedRoutes: [...OLD_THREE],
        defaultRoute: '/performance-analysis',
      },
      {
        username: 'leshan',
        passwordHash: '$2b$10$hash-leshan',
        role: 'org_user',
        organization: '乐山',
        branchCode: 'SC',
        active: true,
        // 管理面有意加过的额外路由：不得被回收
        allowedRoutes: [...OLD_THREE, '/custom-extra'],
      },
      {
        username: 'admin',
        passwordHash: '$2b$10$hash-admin',
        role: 'branch_admin',
        branchCode: 'SC',
        allowedRoutes: ['/anything'],
      },
    ],
    roles: PRESET_ROLES,
  };
}

describe('planUserRouteAdditions', () => {
  it('对停在旧三条的 org_user 计算出缺失 /home', () => {
    const plan = planUserRouteAdditions(makeStore(), PRESET_ROLES);
    const tianfu = plan.find((e) => e.username === 'tianfu');
    expect(tianfu.missing).toEqual(['/home']);
    expect(tianfu.extra).toEqual([]);
  });

  it('多出的路由只登记为 extra，不进 missing', () => {
    const plan = planUserRouteAdditions(makeStore(), PRESET_ROLES);
    const leshan = plan.find((e) => e.username === 'leshan');
    expect(leshan.missing).toEqual(['/home']);
    expect(leshan.extra).toEqual(['/custom-extra']);
  });

  it('角色级无 allowedRoutes 的用户（branch_admin）不进计划', () => {
    const plan = planUserRouteAdditions(makeStore(), PRESET_ROLES);
    expect(plan.find((e) => e.username === 'admin')).toBeUndefined();
  });

  it('缺 allowedRoutes 字段的 org_user 视为空，缺全部 preset 路由', () => {
    const store = makeStore();
    store.users.push({ username: 'nofield', role: 'org_user', passwordHash: 'x' });
    const plan = planUserRouteAdditions(store, PRESET_ROLES);
    const entry = plan.find((e) => e.username === 'nofield');
    expect(entry.hadRoutesField).toBe(false);
    expect(entry.missing).toEqual(PRESET_ROLES[1].allowedRoutes);
  });
});

describe('applyUserRouteAdditions', () => {
  it('只补缺失、不删多余', () => {
    const store = makeStore();
    const next = applyUserRouteAdditions(store, planUserRouteAdditions(store, PRESET_ROLES));
    const tianfu = next.users.find((u) => u.username === 'tianfu');
    const leshan = next.users.find((u) => u.username === 'leshan');
    expect(tianfu.allowedRoutes).toEqual([...OLD_THREE, '/home']);
    expect(leshan.allowedRoutes).toEqual([...OLD_THREE, '/custom-extra', '/home']);
  });

  it('除 allowedRoutes 外其余字段逐一原样保留（含 passwordHash/branchCode/active）', () => {
    const store = makeStore();
    const next = applyUserRouteAdditions(store, planUserRouteAdditions(store, PRESET_ROLES));
    const before = store.users.find((u) => u.username === 'tianfu');
    const after = next.users.find((u) => u.username === 'tianfu');
    const { allowedRoutes: _a, ...beforeRest } = before;
    const { allowedRoutes: _b, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
    // 未涉及的用户对象引用不变（连 roles 段整体也不动）
    const adminBefore = store.users.find((u) => u.username === 'admin');
    expect(next.users).toContain(adminBefore);
    expect(next.roles).toBe(store.roles);
  });

  it('不改入参 store（不可变）', () => {
    const store = makeStore();
    const snapshot = JSON.parse(JSON.stringify(store));
    applyUserRouteAdditions(store, planUserRouteAdditions(store, PRESET_ROLES));
    expect(store).toEqual(snapshot);
  });

  it('幂等：apply 一次后再 plan，全部用户零缺失', () => {
    const store = makeStore();
    const once = applyUserRouteAdditions(store, planUserRouteAdditions(store, PRESET_ROLES));
    const replan = planUserRouteAdditions(once, PRESET_ROLES);
    expect(replan.every((e) => e.missing.length === 0)).toBe(true);
    const twice = applyUserRouteAdditions(once, replan);
    expect(twice).toEqual(once);
  });
});
