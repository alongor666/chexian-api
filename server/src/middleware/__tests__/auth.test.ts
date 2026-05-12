/**
 * authMiddleware 三入口分支单测
 *  1) Bearer PAT (cx_pat_*)  → verifyPat
 *  2) Bearer JWT             → jwt.verify
 *  3) Cookie JWT             → jwt.verify
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// PAT 验证 mock：根据 raw token 决定成功/失败
const verifyPatMock = vi.fn();
vi.mock('../../services/personal-access-token.js', () => ({
  verifyPat: (...args: unknown[]) => (verifyPatMock as any)(...args),
}));

// JWT secret + 简化的 authConfig
vi.mock('../../config/auth.js', () => ({
  authConfig: { jwtSecret: 'test-secret', jwtExpiresIn: '4h', bcryptSaltRounds: 10 },
}));

import jwt from 'jsonwebtoken';
import { authMiddleware } from '../auth.js';
import { AppError } from '../error.js';

function makeReq(opts: { authorization?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.authorization) headers.authorization = opts.authorization;
  if (opts.cookie) headers.cookie = opts.cookie;
  return {
    headers,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as any;
}

async function runMiddleware(req: any) {
  let nextErr: unknown;
  await new Promise<void>((resolve) => {
    authMiddleware(req, {} as any, (err?: unknown) => {
      nextErr = err;
      resolve();
    });
  });
  return nextErr;
}

beforeEach(() => {
  verifyPatMock.mockReset();
});

describe('authMiddleware: Bearer PAT 分支', () => {
  it('cx_pat_ 前缀 → 调 verifyPat，注入 req.user + req.pat', async () => {
    verifyPatMock.mockResolvedValueOnce({
      user: {
        id: 'u-1', username: 'alice', displayName: 'Alice', passwordHash: 'x',
        role: 'org_user', organization: '分公司A', active: true,
      },
      tokenId: 'AB12CD34',
      name: 'cli',
    });

    const req = makeReq({ authorization: 'Bearer cx_pat_AB12CD34.' + 'a'.repeat(43) });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user).toEqual({
      userId: 'u-1', username: 'alice', role: 'org_user', organization: '分公司A',
    });
    expect(req.pat).toEqual({ tokenId: 'AB12CD34', name: 'cli' });
    expect(verifyPatMock).toHaveBeenCalledOnce();
  });

  it('verifyPat 抛 AppError 时 next(error)', async () => {
    verifyPatMock.mockRejectedValueOnce(new AppError(401, 'PAT expired'));
    const req = makeReq({ authorization: 'Bearer cx_pat_AB12CD34.' + 'a'.repeat(43) });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
    expect((err as AppError).message).toBe('PAT expired');
  });
});

describe('authMiddleware: Bearer JWT 分支', () => {
  it('合法 JWT → req.user 注入 + 不调 verifyPat', async () => {
    const token = jwt.sign(
      { userId: 'u-1', username: 'alice', role: 'branch_admin' },
      'test-secret',
      { expiresIn: '1h' },
    );
    const req = makeReq({ authorization: `Bearer ${token}` });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user.username).toBe('alice');
    expect(req.user.role).toBe('branch_admin');
    expect(req.pat).toBeUndefined();
    expect(verifyPatMock).not.toHaveBeenCalled();
  });

  it('非法 JWT → 401 Invalid token', async () => {
    const req = makeReq({ authorization: 'Bearer not-a-real-jwt' });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
  });
});

describe('authMiddleware: Cookie JWT 分支', () => {
  it('cx_access_token cookie → req.user 注入', async () => {
    const token = jwt.sign(
      { userId: 'u-1', username: 'alice', role: 'org_user', organization: '分公司A' },
      'test-secret',
      { expiresIn: '1h' },
    );
    const req = makeReq({ cookie: `cx_access_token=${encodeURIComponent(token)}; other=1` });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user.organization).toBe('分公司A');
    expect(req.pat).toBeUndefined();
  });

  it('Bearer PAT 与 Cookie 同时存在时 PAT 优先', async () => {
    verifyPatMock.mockResolvedValueOnce({
      user: { id: 'u-1', username: 'alice', role: 'org_user', active: true } as any,
      tokenId: 'AB12CD34',
      name: 'cli',
    });
    const cookieToken = jwt.sign({ userId: 'b', username: 'bob', role: 'branch_admin' },
      'test-secret', { expiresIn: '1h' });
    const req = makeReq({
      authorization: 'Bearer cx_pat_AB12CD34.' + 'a'.repeat(43),
      cookie: `cx_access_token=${cookieToken}`,
    });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user.username).toBe('alice'); // PAT 来的用户，不是 cookie 的 bob
    expect(req.pat?.tokenId).toBe('AB12CD34');
  });
});

describe('authMiddleware: 无凭证', () => {
  it('既无 Bearer 也无 Cookie → 401 No token provided', async () => {
    const req = makeReq();
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
    expect((err as AppError).message).toBe('No token provided');
  });
});
