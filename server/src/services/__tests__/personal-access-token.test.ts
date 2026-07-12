/**
 * Personal Access Token 服务单元测试
 *
 * 通过 mock duckdbService + access-control 验证业务逻辑：
 *  - createPat：token 格式 / ttl 校验 / name 校验
 *  - verifyPat：成功路径 + 各种失败路径（格式/过期/吊销/失活/密钥错误）
 *  - revokePat：越权拒绝
 *  - splitRawToken：边界条件
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 必须在 import 被测模块之前注册 mock
vi.mock('../duckdb.js', () => {
  const queries: Array<{ sql: string }> = [];
  let queryImpl: (sql: string) => Promise<any[]> = async () => [];
  return {
    duckdbService: {
      query: async (sql: string) => {
        queries.push({ sql });
        return queryImpl(sql);
      },
    },
    __setQueryImpl: (fn: (sql: string) => Promise<any[]>) => { queryImpl = fn; },
    __getQueries: () => queries,
    __resetQueries: () => { queries.length = 0; },
  };
});

vi.mock('../access-control.js', () => {
  const fakeUser = {
    id: 'u-1',
    username: 'alice',
    displayName: 'Alice',
    passwordHash: '$2b$10$dummy',
    role: 'org_user',
    organization: '分公司A',
    active: true,
  };
  let mockedUser: any = fakeUser;
  return {
    getUserByUsername: vi.fn(async (_: string) => mockedUser),
    __setMockedUser: (u: any) => { mockedUser = u; },
  };
});

// PAT 持久层 mock：只统计调用次数，不真写文件
// v5 Phase 3：新增 SQLite Repository 方法 mock，默认无副作用 / 成功 resolve
const saveApiTokensSpy = vi.fn(async () => {});
const upsertPatSpy = vi.fn(async (_r: unknown) => {});
const revokePatSpy = vi.fn(async (_id: string, _at: string) => {});
const revokeActiveForUserSpy = vi.fn(async (_uid: string, _at: string) => {});
const unrevokePatSpy = vi.fn(async (_id: string) => {});
const deletePatSpy = vi.fn(async (_id: string) => {});
const updateLastUsedBatchSpy = vi.fn(async (_u: unknown) => {});
const reloadMirrorSpy = vi.fn(async () => {});

vi.mock('../personal-access-token-store.js', () => ({
  saveApiTokens: () => saveApiTokensSpy(),
  upsertPatToSqlite: (r: unknown) => upsertPatSpy(r),
  revokePatInSqlite: (id: string, at: string) => revokePatSpy(id, at),
  revokeActivePatsForUserInSqlite: (uid: string, at: string) => revokeActiveForUserSpy(uid, at),
  unrevokePatInSqlite: (id: string) => unrevokePatSpy(id),
  deletePatFromSqlite: (id: string) => deletePatSpy(id),
  updateLastUsedBatchInSqlite: (u: unknown) => updateLastUsedBatchSpy(u),
  reloadApiTokenMirrorFromSqlite: () => reloadMirrorSpy(),
}));

// dbEnv mock：动态读 process.env.__TEST_BACKEND（默认 'json' 跑原用例）
// 保留 authEnv 等其他 env 真实导出（personal-access-token → auth.ts 依赖）
vi.mock('../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env.js')>();
  return {
    ...actual,
    dbEnv: new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === 'STATE_STORE_BACKEND') return process.env.__TEST_BACKEND ?? 'json';
          if (key === 'STATE_DB_PATH') return process.env.__TEST_STATE_DB_PATH ?? '';
          return undefined;
        },
      },
    ),
  };
});

import {
  createPat,
  verifyPat,
  revokePat,
  revokeActivePatsForUser,
  listPatsByUser,
  _clearVerifyCacheForTest,
  _flushPendingForTest,
} from '../personal-access-token.js';

// 拿到 mock 工厂里挂的辅助函数
import * as duckdbMod from '../duckdb.js';
import * as accessMod from '../access-control.js';
const setQueryImpl = (duckdbMod as any).__setQueryImpl as (fn: (sql: string) => Promise<any[]>) => void;
const getQueries = (duckdbMod as any).__getQueries as () => Array<{ sql: string }>;
const resetQueries = (duckdbMod as any).__resetQueries as () => void;
const setMockedUser = (accessMod as any).__setMockedUser as (u: any) => void;

const defaultUser = {
  id: 'u-1',
  username: 'alice',
  displayName: 'Alice',
  passwordHash: '$2b$10$dummy',
  role: 'org_user',
  organization: '分公司A',
  active: true,
};

beforeEach(() => {
  resetQueries();
  _clearVerifyCacheForTest();
  setMockedUser(defaultUser);
  setQueryImpl(async () => []);
  saveApiTokensSpy.mockClear();
  upsertPatSpy.mockClear().mockImplementation(async () => {});
  revokePatSpy.mockClear().mockImplementation(async () => {});
  revokeActiveForUserSpy.mockClear().mockImplementation(async () => {});
  unrevokePatSpy.mockClear().mockImplementation(async () => {});
  deletePatSpy.mockClear().mockImplementation(async () => {});
  updateLastUsedBatchSpy.mockClear().mockImplementation(async () => {});
  reloadMirrorSpy.mockClear().mockImplementation(async () => {});
  delete process.env.__TEST_BACKEND;  // 默认回到 json
});

describe('createPat', () => {
  it('生成格式 cx_pat_<id8>.<secret43> 的明文，DB 仅存哈希', async () => {
    setQueryImpl(async () => []);
    const result = await createPat({
      userId: 'u-1',
      username: 'alice',
      name: 'claude-desktop',
      ttlDays: 90,
    });
    expect(result.plaintext).toMatch(/^cx_pat_[0-9A-Z]{8}\.[A-Za-z0-9_-]{43}$/);
    expect(result.token.tokenId).toMatch(/^[0-9A-Z]{8}$/);
    expect(result.token.name).toBe('claude-desktop');
    expect(result.token.expiresAt.getTime() - result.token.createdAt.getTime())
      .toBeCloseTo(90 * 86_400_000, -3);
    const inserts = getQueries().filter(q => /INSERT INTO ApiToken/.test(q.sql));
    expect(inserts).toHaveLength(1);
    // 明文 secret 不应出现在 INSERT SQL 里
    const secret = result.plaintext.split('.')[1];
    expect(inserts[0].sql).not.toContain(secret);
  });

  it('拒绝非法 ttlDays', async () => {
    await expect(createPat({
      userId: 'u-1', username: 'alice', name: 'x', ttlDays: 7 as any,
    })).rejects.toThrow(/Invalid ttlDays/);
  });

  it('拒绝空 name 与超长 name', async () => {
    await expect(createPat({
      userId: 'u-1', username: 'alice', name: '   ', ttlDays: 30,
    })).rejects.toThrow(/1-64/);
    await expect(createPat({
      userId: 'u-1', username: 'alice', name: 'a'.repeat(65), ttlDays: 30,
    })).rejects.toThrow(/1-64/);
  });
});

describe('verifyPat', () => {
  /** 用真实 createPat 走一遍，得到 plaintext 与 mock 表中应有的行 */
  async function setupValidToken(overrides: Partial<{ expiresAt: Date; revokedAt: Date | null }> = {}) {
    // 第一步：mock INSERT 不做任何事
    setQueryImpl(async () => []);
    const created = await createPat({
      userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90,
    });
    // 从 INSERT SQL 中提取 token_hash
    const insertSql = getQueries().find(q => /INSERT INTO ApiToken/.test(q.sql))!.sql;
    const hashMatch = insertSql.match(/'\$2b\$10\$[^']+'/);
    if (!hashMatch) throw new Error('Could not extract bcrypt hash from INSERT');
    const tokenHash = hashMatch[0].slice(1, -1);

    const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 90 * 86_400_000);
    const revokedAt = overrides.revokedAt === undefined ? null : overrides.revokedAt;

    // 后续 SELECT 返回这一行
    setQueryImpl(async (sql) => {
      if (/SELECT[\s\S]*FROM ApiToken/i.test(sql)) {
        return [{
          token_id: created.token.tokenId,
          token_hash: tokenHash,
          user_id: 'u-1',
          username: 'alice',
          name: 'cli',
          expires_at: expiresAt,
          revoked_at: revokedAt,
        }];
      }
      return [];
    });
    return created;
  }

  it('校验成功：返回 user + tokenId + name', async () => {
    const created = await setupValidToken();
    const result = await verifyPat(created.plaintext, '127.0.0.1');
    expect(result.tokenId).toBe(created.token.tokenId);
    expect(result.name).toBe('cli');
    expect(result.user.username).toBe('alice');
    expect(result.user.role).toBe('org_user');
    expect(result.user.organization).toBe('分公司A');
  });

  /** 通用错误断言：rejects 抛出的应是 AppError，含期望的 statusCode + message */
  async function expectRejectError(p: Promise<unknown>, statusCode: number, message: string) {
    const err = await p.catch((e) => e) as { statusCode?: number; message?: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(statusCode);
    expect(err.message).toBe(message);
  }

  it('格式错误（非 cx_pat_ 前缀）→ 401', async () => {
    await expectRejectError(verifyPat('Bearer abc.def'), 401, 'Invalid PAT format');
  });

  it('格式错误（缺 .secret 部分）→ 401', async () => {
    await expectRejectError(verifyPat('cx_pat_ABCDEFGH'), 401, 'Invalid PAT format');
  });

  it('token_id 不存在 → 401', async () => {
    setQueryImpl(async () => []);
    await expectRejectError(
      verifyPat('cx_pat_ABCDEFGH.' + 'a'.repeat(43)),
      401, 'Invalid PAT',
    );
  });

  it('已吊销 → 401', async () => {
    const created = await setupValidToken({ revokedAt: new Date() });
    await expectRejectError(verifyPat(created.plaintext), 401, 'PAT has been revoked');
  });

  it('已过期 → 401', async () => {
    const created = await setupValidToken({ expiresAt: new Date(Date.now() - 1000) });
    await expectRejectError(verifyPat(created.plaintext), 401, 'PAT expired');
  });

  it('secret 错误 → 401', async () => {
    const created = await setupValidToken();
    const [prefix] = created.plaintext.split('.');
    const tampered = `${prefix}.${'z'.repeat(43)}`;
    await expectRejectError(verifyPat(tampered), 401, 'Invalid PAT');
  });

  it('用户失活 → 403', async () => {
    const created = await setupValidToken();
    setMockedUser({ ...defaultUser, active: false });
    await expectRejectError(verifyPat(created.plaintext), 403, 'Account disabled');
  });

  it('用户不存在 → 401', async () => {
    const created = await setupValidToken();
    setMockedUser(null);
    await expectRejectError(verifyPat(created.plaintext), 401, 'Token owner no longer exists');
  });

  it('配置了 allowedIps 且 IP 不匹配 → 403（即使 secret 正确）', async () => {
    const created = await setupValidToken();
    setMockedUser({ ...defaultUser, allowedIps: ['10.0.0.1'] });
    await expectRejectError(
      verifyPat(created.plaintext, '10.0.0.2'),
      403, 'Client IP not in the allowlist for this account',
    );
  });

  it('配置了 allowedIps 但拿不到 clientIp → 403（fail-closed）', async () => {
    const created = await setupValidToken();
    setMockedUser({ ...defaultUser, allowedIps: ['10.0.0.1'] });
    await expectRejectError(
      verifyPat(created.plaintext),
      403, 'Client IP not in the allowlist for this account',
    );
  });

  it('allowedIps 为空数组 → 放行（未启用白名单的账号不受影响）', async () => {
    const created = await setupValidToken();
    setMockedUser({ ...defaultUser, allowedIps: [] });
    const result = await verifyPat(created.plaintext, '8.8.8.8');
    expect(result.user.username).toBe('alice');
  });

  it('IPv6 映射前缀归一化后命中白名单 → 放行', async () => {
    const created = await setupValidToken();
    setMockedUser({ ...defaultUser, allowedIps: ['192.168.1.5'] });
    const result = await verifyPat(created.plaintext, '::ffff:192.168.1.5');
    expect(result.tokenId).toBe(created.token.tokenId);
  });

  it('验证缓存命中路径也执行 IP 闸：合法 IP 建缓存后换非法 IP 再调 → 403', async () => {
    const created = await setupValidToken();
    setMockedUser({ ...defaultUser, allowedIps: ['10.0.0.1'] });
    await verifyPat(created.plaintext, '10.0.0.1'); // 首次成功，写入 verifyCache
    await expectRejectError(
      verifyPat(created.plaintext, '6.6.6.6'),
      403, 'Client IP not in the allowlist for this account',
    );
  });

  it('校验缓存命中后跳过 bcrypt（第二次调用即便 bcrypt 慢也快速返回）', async () => {
    const created = await setupValidToken();
    await verifyPat(created.plaintext);
    // 第二次：即使没有变更 mock，也应该走缓存
    const t0 = Date.now();
    await verifyPat(created.plaintext);
    const elapsed = Date.now() - t0;
    // bcrypt.compare cost=10 通常 5-20ms，缓存命中应远小于 5ms
    expect(elapsed).toBeLessThan(20);
  });
});

describe('revokePat', () => {
  it('成功路径：先 SELECT 校验所有权，再 UPDATE 设 revoked_at', async () => {
    const calls: string[] = [];
    setQueryImpl(async (sql) => {
      calls.push(sql);
      if (/SELECT[\s\S]*FROM ApiToken[\s\S]*WHERE token_id/i.test(sql)) {
        return [{ token_id: 'ABC12345' }];
      }
      return [];
    });
    await revokePat('u-1', 'ABC12345');
    expect(calls.some(s => /UPDATE ApiToken[\s\S]*SET revoked_at/.test(s))).toBe(true);
  });

  it('其他用户的 token 越权吊销 → 404', async () => {
    setQueryImpl(async () => []);
    const err = await revokePat('u-1', 'XXXXXXXX').catch(e => e) as { statusCode?: number };
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(404);
  });
});

describe('listPatsByUser', () => {
  it('返回该用户的 token 元数据（不含 token_hash）', async () => {
    setQueryImpl(async (sql) => {
      if (/SELECT[\s\S]*FROM ApiToken[\s\S]*WHERE user_id/i.test(sql)) {
        return [{
          token_id: 'AAAA1111',
          user_id: 'u-1',
          username: 'alice',
          name: 'cli',
          expires_at: new Date('2027-01-01'),
          last_used_at: new Date('2026-05-01'),
          last_used_ip: '10.0.0.1',
          created_at: new Date('2026-01-01'),
          revoked_at: null,
        }];
      }
      return [];
    });
    const tokens = await listPatsByUser('u-1');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenId).toBe('AAAA1111');
    expect((tokens[0] as any).token_hash).toBeUndefined();
  });
});

describe('last_used_at 异步批量写入', () => {
  it('verifyPat 成功后调度更新，flush 时执行 UPDATE', async () => {
    const calls: string[] = [];
    // 用 setupValidToken 同样的方式准备
    setQueryImpl(async () => []);
    const created = await createPat({
      userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90,
    });
    const insertSql = getQueries().find(q => /INSERT INTO ApiToken/.test(q.sql))!.sql;
    const tokenHash = insertSql.match(/'\$2b\$10\$[^']+'/)![0].slice(1, -1);

    setQueryImpl(async (sql) => {
      calls.push(sql);
      if (/SELECT[\s\S]*FROM ApiToken/i.test(sql)) {
        return [{
          token_id: created.token.tokenId,
          token_hash: tokenHash,
          user_id: 'u-1',
          username: 'alice',
          name: 'cli',
          expires_at: new Date(Date.now() + 86_400_000),
          revoked_at: null,
        }];
      }
      return [];
    });

    await verifyPat(created.plaintext, '10.0.0.42');
    await _flushPendingForTest();
    expect(calls.some(s => /UPDATE ApiToken[\s\S]*SET last_used_at/.test(s))).toBe(true);
    expect(calls.some(s => s.includes('10.0.0.42'))).toBe(true);
  });
});

describe('PAT 持久化双写：create / revoke / flush 必须触发 saveApiTokens', () => {
  it('createPat 成功后触发 1 次 saveApiTokens', async () => {
    setQueryImpl(async () => []);
    await createPat({ userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90 });
    expect(saveApiTokensSpy).toHaveBeenCalledTimes(1);
  });

  it('revokePat 成功后触发 1 次 saveApiTokens', async () => {
    setQueryImpl(async (sql) => {
      if (/SELECT token_id FROM ApiToken/i.test(sql)) return [{ token_id: 'AAAAAAAA' }];
      return [];
    });
    await revokePat('u-1', 'AAAAAAAA');
    expect(saveApiTokensSpy).toHaveBeenCalledTimes(1);
  });

  it('last_used_at flush 成功后触发 1 次 saveApiTokens', async () => {
    // 准备一个有效 token + 让 verifyPat 通过
    setQueryImpl(async () => []);
    const created = await createPat({
      userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90,
    });
    const insertSql = getQueries().find(q => /INSERT INTO ApiToken/.test(q.sql))!.sql;
    const tokenHash = insertSql.match(/'\$2b\$10\$[^']+'/)![0].slice(1, -1);

    saveApiTokensSpy.mockClear();  // 清掉 create 这一次

    setQueryImpl(async (sql) => {
      if (/SELECT[\s\S]*FROM ApiToken/i.test(sql)) {
        return [{
          token_id: created.token.tokenId,
          token_hash: tokenHash,
          user_id: 'u-1',
          username: 'alice',
          name: 'cli',
          expires_at: new Date(Date.now() + 86_400_000),
          revoked_at: null,
        }];
      }
      return [];
    });
    await verifyPat(created.plaintext, '10.0.0.42');
    await _flushPendingForTest();
    expect(saveApiTokensSpy).toHaveBeenCalledTimes(1);
  });

  it('flush 无更新（buffer 空）不触发 saveApiTokens', async () => {
    await _flushPendingForTest();
    expect(saveApiTokensSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// v5 Phase 3 (B298)：backend=sqlite 模式三层原子覆盖
// ─────────────────────────────────────────────────────────────
describe('v5 Phase 3: backend=sqlite createPat 三层原子', () => {
  beforeEach(() => {
    process.env.__TEST_BACKEND = 'sqlite';
  });

  it('成功路径：upsertPat → mirror INSERT → saveApiTokens 三层都触发', async () => {
    setQueryImpl(async () => []);
    await createPat({ userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90 });
    expect(upsertPatSpy).toHaveBeenCalledTimes(1);
    // saveApiTokens 也调一次（snapshot 兜底）
    expect(saveApiTokensSpy).toHaveBeenCalledTimes(1);
    // DuckDB INSERT 应被调用一次
    const inserts = getQueries().filter((q) => /INSERT INTO ApiToken/.test(q.sql));
    expect(inserts).toHaveLength(1);
  });

  it('SQLite upsert 失败 → 5xx，DuckDB mirror 不被触达', async () => {
    upsertPatSpy.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    await expect(
      createPat({ userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90 }),
    ).rejects.toThrow(/state\.db 写入失败/);
    const inserts = getQueries().filter((q) => /INSERT INTO ApiToken/.test(q.sql));
    expect(inserts).toHaveLength(0);
    expect(saveApiTokensSpy).not.toHaveBeenCalled();
  });

  it('mirror INSERT 失败 → reload 兜底成功（校验通过）→ 整体成功', async () => {
    let insertAttempt = 0;
    let createdTokenId: string | null = null;
    setQueryImpl(async (sql) => {
      if (/INSERT INTO ApiToken/.test(sql)) {
        insertAttempt++;
        // 第一次 INSERT 失败
        if (insertAttempt === 1) {
          const m = sql.match(/'([0-9A-Z]{8})'/);
          if (m) createdTokenId = m[1];
          throw new Error('mirror crashed');
        }
        return [];
      }
      // reload 后的 SELECT 校验：mirror 已恢复
      if (/SELECT revoked_at FROM ApiToken/.test(sql)) {
        return [{ revoked_at: null }];
      }
      return [];
    });
    const result = await createPat({
      userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90,
    });
    expect(reloadMirrorSpy).toHaveBeenCalledTimes(1);
    // 整体成功 → saveApiTokens 仍被调
    expect(saveApiTokensSpy).toHaveBeenCalledTimes(1);
    // 不回滚 SQLite
    expect(deletePatSpy).not.toHaveBeenCalled();
    expect(result.plaintext).toMatch(/^cx_pat_/);
    expect(createdTokenId).toBeTruthy();
  });

  it('mirror INSERT 失败 + reload 后校验仍缺 token → 回滚 SQLite + 5xx', async () => {
    setQueryImpl(async (sql) => {
      if (/INSERT INTO ApiToken/.test(sql)) {
        throw new Error('mirror crashed');
      }
      // reload 后的校验：mirror 仍然找不到该 token
      if (/SELECT revoked_at FROM ApiToken/.test(sql)) {
        return [];
      }
      return [];
    });
    await expect(
      createPat({ userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90 }),
    ).rejects.toThrow(/DuckDB mirror sync 失败/);
    expect(reloadMirrorSpy).toHaveBeenCalledTimes(1);
    // 回滚 SQLite（create → delete）
    expect(deletePatSpy).toHaveBeenCalledTimes(1);
    // saveApiTokens 不调（前置失败）
    expect(saveApiTokensSpy).not.toHaveBeenCalled();
  });

  it('JSON saveApiTokens 失败 → 5xx，但 SQLite/DuckDB 仍处于一致状态（不回滚）', async () => {
    saveApiTokensSpy.mockImplementationOnce(async () => {
      throw new Error('[PAT] api_tokens.json 写入失败: [INCONSISTENCY] disk full');
    });
    await expect(
      createPat({ userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90 }),
    ).rejects.toThrow(/INCONSISTENCY/);
    expect(upsertPatSpy).toHaveBeenCalledTimes(1);
    // 不触发回滚（运营介入）
    expect(deletePatSpy).not.toHaveBeenCalled();
  });
});

describe('v5 Phase 3: backend=sqlite revokePat 三层原子', () => {
  beforeEach(() => {
    process.env.__TEST_BACKEND = 'sqlite';
  });

  it('成功路径：revokePatInSqlite → mirror UPDATE → saveApiTokens', async () => {
    setQueryImpl(async (sql) => {
      if (/SELECT token_id FROM ApiToken/i.test(sql)) return [{ token_id: 'AAAAAAAA' }];
      return [];
    });
    await revokePat('u-1', 'AAAAAAAA');
    expect(revokePatSpy).toHaveBeenCalledTimes(1);
    expect(saveApiTokensSpy).toHaveBeenCalledTimes(1);
  });

  it('mirror UPDATE 失败 + reload 仍缺 token → 回滚 unrevoke + 5xx', async () => {
    let calls = 0;
    setQueryImpl(async (sql) => {
      if (/SELECT token_id FROM ApiToken/i.test(sql)) return [{ token_id: 'AAAAAAAA' }];
      if (/UPDATE ApiToken[\s\S]*SET revoked_at = TIMESTAMP/i.test(sql)) {
        calls++;
        throw new Error('mirror update crashed');
      }
      if (/SELECT revoked_at FROM ApiToken/.test(sql)) {
        return [];  // mirror 仍缺
      }
      return [];
    });
    await expect(revokePat('u-1', 'AAAAAAAA')).rejects.toThrow(/DuckDB mirror sync 失败/);
    expect(reloadMirrorSpy).toHaveBeenCalledTimes(1);
    expect(unrevokePatSpy).toHaveBeenCalledTimes(1);  // 回滚动作
    expect(saveApiTokensSpy).not.toHaveBeenCalled();
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

describe('v5 Phase 3: backend=sqlite flushPendingUpdates fire-and-forget warn', () => {
  beforeEach(() => {
    process.env.__TEST_BACKEND = 'sqlite';
  });

  it('SQLite batch update 失败仅 warn 不抛（不阻塞热路径）', async () => {
    updateLastUsedBatchSpy.mockImplementationOnce(async () => {
      throw new Error('sqlite batch crashed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 准备一条 PAT 并触发 verifyPat 走 scheduleLastUsedUpdate
      setQueryImpl(async () => []);
      const created = await createPat({ userId: 'u-1', username: 'alice', name: 'cli', ttlDays: 90 });
      const insertSql = getQueries().find((q) => /INSERT INTO ApiToken/.test(q.sql))!.sql;
      const tokenHash = insertSql.match(/'\$2b\$10\$[^']+'/)![0].slice(1, -1);

      setQueryImpl(async (sql) => {
        if (/SELECT[\s\S]*FROM ApiToken/i.test(sql)) {
          return [{
            token_id: created.token.tokenId,
            token_hash: tokenHash,
            user_id: 'u-1',
            username: 'alice',
            name: 'cli',
            expires_at: new Date(Date.now() + 86_400_000),
            revoked_at: null,
          }];
        }
        return [];
      });
      await verifyPat(created.plaintext, '10.0.0.42');
      // flush 不应抛错
      await expect(_flushPendingForTest()).resolves.toBeUndefined();
      // warn 被调用（至少 1 次：SQLite batch / JSON save 其一）
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('revokeActivePatsForUser（凭据轮换联动批量吊销 · M4）', () => {
  // 让 SELECT token_id 返回给定 active token 集合，UPDATE 返回 []
  function withActiveTokens(ids: string[]) {
    setQueryImpl(async (sql: string) => {
      if (/SELECT token_id FROM ApiToken/.test(sql)) {
        return ids.map((token_id) => ({ token_id }));
      }
      return [];
    });
  }

  it('零 active PAT → {revokedCount:0}，不写快照、不发 UPDATE', async () => {
    withActiveTokens([]);
    const res = await revokeActivePatsForUser('u-1');
    expect(res).toEqual({ revokedCount: 0 });
    expect(saveApiTokensSpy).not.toHaveBeenCalled();
    expect(getQueries().some((q) => /UPDATE ApiToken/.test(q.sql))).toBe(false);
  });

  it('多 active PAT → 单条 UPDATE(WHERE user_id AND revoked_at IS NULL) + 单次快照', async () => {
    withActiveTokens(['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC']);
    const res = await revokeActivePatsForUser('u-1');
    expect(res).toEqual({ revokedCount: 3 });
    const updates = getQueries().filter((q) => /UPDATE ApiToken/.test(q.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/user_id = 'u-1'/);
    expect(updates[0].sql).toMatch(/revoked_at IS NULL/);
    // 单次快照（避免逐 token 三层写放大）
    expect(saveApiTokensSpy).toHaveBeenCalledTimes(1);
  });

  it('json backend mirror UPDATE 失败 → 抛 500，不写快照（无部分状态）', async () => {
    setQueryImpl(async (sql: string) => {
      if (/SELECT token_id FROM ApiToken/.test(sql)) return [{ token_id: 'AAAAAAAA' }];
      throw new Error('duckdb down');
    });
    await expect(revokeActivePatsForUser('u-1')).rejects.toThrow(/DuckDB 批量吊销失败/);
    expect(saveApiTokensSpy).not.toHaveBeenCalled();
  });

  it('sqlite backend → 调 SQLite 批量吊销原语 + 单次快照', async () => {
    process.env.__TEST_BACKEND = 'sqlite';
    withActiveTokens(['AAAAAAAA', 'BBBBBBBB']);
    const res = await revokeActivePatsForUser('u-9');
    expect(res).toEqual({ revokedCount: 2 });
    expect(revokeActiveForUserSpy).toHaveBeenCalledTimes(1);
    expect(revokeActiveForUserSpy.mock.calls[0][0]).toBe('u-9'); // userId
    expect(saveApiTokensSpy).toHaveBeenCalledTimes(1);
  });
});
