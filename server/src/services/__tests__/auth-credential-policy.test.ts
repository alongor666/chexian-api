import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const FEISHU_ONLY_USER_ID = ['feishu', 'user'].join('-');

vi.mock('../duckdb.js', () => ({
  duckdbService: { query: (...args: unknown[]) => queryMock(...args) },
}));

import {
  assertPasswordAllowed,
  assertPatAllowed,
  credentialSetupRequired,
  getAuthMethods,
  getPasswordCredential,
} from '../credential-policy.js';

beforeEach(() => {
  queryMock.mockReset();
});

describe('credential policy', () => {
  it('returns password credentials and bootstrap state for legacy password accounts', async () => {
    queryMock.mockResolvedValueOnce([
      {
        user_id: 'password-user',
        password_hash: 'hash',
        state: 'bootstrap_required',
        changed_at: null,
      },
    ]);
    await expect(getPasswordCredential('password-user')).resolves.toEqual({
      userId: 'password-user',
      passwordHash: 'hash',
      state: 'bootstrap_required',
      changedAt: undefined,
    });

    queryMock.mockResolvedValueOnce([
      { user_id: 'password-user', password_hash: 'hash', state: 'bootstrap_required', changed_at: null },
    ]);
    await expect(credentialSetupRequired('password-user')).resolves.toBe(true);
  });

  it('treats a Feishu-only account as a valid account without password setup', async () => {
    queryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ provider: 'feishu' }]);
    await expect(getAuthMethods(FEISHU_ONLY_USER_ID)).resolves.toEqual(['feishu']);

    queryMock.mockResolvedValueOnce([]);
    await expect(credentialSetupRequired(FEISHU_ONLY_USER_ID)).resolves.toBe(false);

    queryMock.mockResolvedValueOnce([]);
    await expect(assertPasswordAllowed(FEISHU_ONLY_USER_ID)).rejects.toMatchObject({
      statusCode: 403,
      message: 'AUTH_METHOD_NOT_ALLOWED',
    });
  });

  it('reports hybrid accounts in deterministic order', async () => {
    queryMock
      .mockResolvedValueOnce([{ user_id: 'hybrid', password_hash: 'hash', state: 'active', changed_at: 'now' }])
      .mockResolvedValueOnce([{ provider: 'feishu' }]);
    const methods = await getAuthMethods('hybrid');
    expect(methods).toHaveLength(2);
    expect(methods[0]).not.toBe('feishu');
    expect(methods[1]).toBe('feishu');
  });
});

describe('assertPatAllowed — PAT 会话 userId=用户名 与 PasswordCredential.user_id=uuid 的键解析（2026-07-15 修复）', () => {
  it('user_id 直接命中（历史行/单测行）→ 放行，不做第二次查询', async () => {
    queryMock.mockResolvedValueOnce([
      // password_hash 为显式假值（GitGuardian 曾把 'hash' 字面量误报为 Generic Password）
      { user_id: 'u-uuid-1', password_hash: 'unit-test-fake-hash', state: 'active', changed_at: '2026-07-11' },
    ]);
    await expect(assertPatAllowed('u-uuid-1')).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('原值未命中 → 经 UserAccount.username JOIN 解析命中 → 放行（修复前此路径恒 403）', async () => {
    queryMock
      .mockResolvedValueOnce([]) // getPasswordCredential('chexianbu') 未命中（uuid 键）
      .mockResolvedValueOnce([{ user_id: 'u-uuid-2' }]); // JOIN UserAccount.username 命中
    await expect(assertPatAllowed('chexianbu')).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('无密码凭据但有启用的飞书身份（纯飞书账号）→ 放行（PAT 全员自助，2026-07-17 评审 P1 收口）', async () => {
    queryMock
      .mockResolvedValueOnce([]) // getPasswordCredential 未命中
      .mockResolvedValueOnce([]) // PasswordCredential JOIN UserAccount 未命中
      .mockResolvedValueOnce([{ provider: 'feishu' }]); // AuthIdentity 启用身份命中
    await expect(assertPatAllowed('feishu-only')).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('密码凭据与启用身份均不存在 → 403 AUTH_METHOD_NOT_ALLOWED', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(assertPatAllowed('ghost-user')).rejects.toMatchObject({
      statusCode: 403,
      message: 'AUTH_METHOD_NOT_ALLOWED',
    });
  });
});
