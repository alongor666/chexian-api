import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const FEISHU_ONLY_USER_ID = ['feishu', 'user'].join('-');

vi.mock('../duckdb.js', () => ({
  duckdbService: { query: (...args: unknown[]) => queryMock(...args) },
}));

import {
  assertPasswordAllowed,
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
