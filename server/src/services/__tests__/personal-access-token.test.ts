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

import {
  createPat,
  verifyPat,
  revokePat,
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
