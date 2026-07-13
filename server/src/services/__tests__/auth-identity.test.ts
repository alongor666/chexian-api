import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  identities: new Map<string, any>(),
  users: new Map<string, any>(),
  creates: 0,
}));
const query = vi.hoisted(() => vi.fn(async (sql: string) => {
  if (sql.includes('SELECT * FROM AuthIdentity')) {
    const subject = sql.match(/provider_subject = '([^']+)'/)?.[1] ?? '';
    const identity = state.identities.get(subject);
    return identity ? [identity] : [];
  }
  if (sql.includes('INSERT INTO AuthIdentity')) {
    const values = sql.match(/VALUES \('([^']+)', '([^']+)', 'feishu', '([^']+)'/) ?? [];
    state.identities.set(values[3], {
      id: values[1], user_id: values[2], provider: 'feishu', provider_subject: values[3], enabled: true,
      last_verified_at: 'now', created_at: 'now', updated_at: 'now',
    });
  }
  if (sql.includes('UPDATE AuthIdentity SET enabled = true')) {
    const identityId = sql.match(/WHERE id = '([^']+)'/)?.[1];
    for (const identity of state.identities.values()) {
      if (identity.id === identityId) identity.enabled = true;
    }
  }
  return [];
}));

vi.mock('../duckdb.js', () => ({ duckdbService: { query } }));
vi.mock('../access-control.js', () => ({
  createFeishuUserWithIdentity: async (input: any) => {
    state.creates += 1;
    const user = { id: `user-${state.creates}`, ...input, active: true };
    state.users.set(user.id, user);
    state.identities.set(input.providerSubject, {
      id: input.identityId, user_id: user.id, provider: 'feishu', provider_subject: input.providerSubject,
      enabled: true, last_verified_at: input.verifiedAt, created_at: input.verifiedAt, updated_at: input.verifiedAt,
    });
    return user;
  },
  getUserById: async (id: string) => state.users.get(id) ?? null,
  updateFeishuUserEntitlement: async (user: any, input: any) => {
    const updated = { ...user, ...input };
    state.users.set(user.id, updated);
    return updated;
  },
  reactivateFeishuUserEntitlement: async (user: any, input: any) => {
    const updated = { ...user, ...input, active: true };
    state.users.set(user.id, updated);
    return updated;
  },
  persistAccessControlState: async () => {},
  refreshActiveUsernames: async () => {},
}));

import { buildFeishuUsername, findOrCreateFeishuAccount } from '../auth-identity.js';

beforeEach(() => {
  state.identities.clear(); state.users.clear(); state.creates = 0; query.mockClear();
});

const input = (feishuUserId: string, displayName = '张伟') => ({
  feishuUserId, displayName, role: 'org_user' as const, organization: '运城', branchCode: 'SX',
});

describe('飞书个人身份开户', () => {
  it('用户名可读且绑定稳定，改名不改用户名', async () => {
    expect(buildFeishuUsername('张伟', 'u-a')).toMatch(/^zhangwei_[a-f0-9]{6}$/);
    const first = await findOrCreateFeishuAccount(input('u-a'));
    const second = await findOrCreateFeishuAccount(input('u-a'));
    const renamed = await findOrCreateFeishuAccount(input('u-a', '张伟新名'));
    expect(first.user.id).toBe(second.user.id);
    expect(renamed.user.username).toBe(first.user.username);
    expect(renamed.user.displayName).toBe('张伟新名');
  });

  it('同名不同飞书用户得到不同账号', async () => {
    const userA = (await findOrCreateFeishuAccount(input('u-a'))).user;
    const userB = (await findOrCreateFeishuAccount(input('u-b'))).user;
    expect(userA.username).not.toBe(userB.username);
  });

  it('超长姓名不会生成无界用户名', () => {
    expect(buildFeishuUsername('张'.repeat(100), 'u-long')).toHaveLength(55);
  });

  it('并发首次登录只创建一个账号', async () => {
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => findOrCreateFeishuAccount(input('u-a'))));
    expect(new Set(concurrent.map(result => result.user.id))).toHaveLength(1);
    expect(state.creates).toBe(1);
  });

  it('离开部门后重新加入会复用并重启用原账号', async () => {
    const first = await findOrCreateFeishuAccount(input('u-a'));
    const identity = state.identities.get('u-a');
    identity.enabled = false;
    state.users.set(first.user.id, { ...first.user, active: false });

    const rejoined = await findOrCreateFeishuAccount(input('u-a', '张伟复职'));

    expect(rejoined.created).toBe(false);
    expect(rejoined.user.id).toBe(first.user.id);
    expect(rejoined.identity.id).toBe(first.identity.id);
    expect(rejoined.identity.enabled).toBe(true);
    expect(rejoined.user.active).toBe(true);
    expect(rejoined.user.username).toBe(first.user.username);
    expect(state.creates).toBe(1);
  });

  it('身份仍启用但账号被管理员停用时不自动复活', async () => {
    const first = await findOrCreateFeishuAccount(input('u-a'));
    state.users.set(first.user.id, { ...first.user, active: false });

    await expect(findOrCreateFeishuAccount(input('u-a'))).rejects.toMatchObject({
      statusCode: 403,
      message: 'Account disabled',
    });
  });
});
