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
import {
  setActiveUsernames,
  setUserAuthorizationCache,
  __resetActiveUsernamesCacheForTest,
} from '../../services/user-activation-cache.js';

function makeReq(opts: { authorization?: string; cookie?: string; originalUrl?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.authorization) headers.authorization = opts.authorization;
  if (opts.cookie) headers.cookie = opts.cookie;
  return {
    headers,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    // pwc 拦截读 req.originalUrl（业务默认路由；pwc 用例按需覆盖）
    originalUrl: opts.originalUrl ?? '/api/query/kpi',
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
  // 缓存复位为未就绪（null）→ isUsernameActive fail-open，既有 JWT 用例不受实时吊销影响。
  __resetActiveUsernamesCacheForTest();
});

describe('authMiddleware: Bearer PAT 分支', () => {
  it('cx_pat_ 前缀 → 调 verifyPat，注入 req.user + req.pat', async () => {
    verifyPatMock.mockResolvedValueOnce({
      user: {
        id: 'u-1', username: 'alice', displayName: 'Alice', passwordHash: 'x',
        role: 'org_user', organization: '分公司A', active: true,
        allowedRoutes: ['/home'],
      },
      tokenId: 'AB12CD34',
      name: 'cli',
    });

    const req = makeReq({ authorization: 'Bearer cx_pat_AB12CD34.' + 'a'.repeat(43) });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user).toEqual({
      userId: 'u-1', username: 'alice', role: 'org_user', organization: '分公司A',
      allowedRoutes: ['/home'],
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
    setUserAuthorizationCache([
      { username: 'alice', active: true, allowedRoutes: ['/home', '/growth'] },
    ]);
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
    expect(req.user.allowedRoutes).toEqual(['/home', '/growth']);
    expect(req.pat).toBeUndefined();
    expect(verifyPatMock).not.toHaveBeenCalled();
  });

  it('运行时 store 白名单覆盖 JWT 中的旧值，确保管理员修改后免重登生效', async () => {
    setUserAuthorizationCache([
      { username: 'alice', active: true, allowedRoutes: ['/home'] },
    ]);
    const token = jwt.sign(
      { userId: 'u-1', username: 'alice', role: 'org_user', allowedRoutes: ['/cost'] },
      'test-secret',
      { expiresIn: '1h' },
    );
    const req = makeReq({ authorization: `Bearer ${token}` });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user.allowedRoutes).toEqual(['/home']);
  });

  it('缓存未就绪时不信任 JWT 中的旧白名单，清空后交由权限层按角色兜底', async () => {
    const token = jwt.sign(
      { userId: 'u-1', username: 'alice', role: 'org_user', allowedRoutes: ['/cost'] },
      'test-secret',
      { expiresIn: '1h' },
    );
    const req = makeReq({ authorization: `Bearer ${token}` });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user.allowedRoutes).toBeUndefined();
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
    setUserAuthorizationCache([
      { username: 'alice', active: true, allowedRoutes: ['/specialty'] },
    ]);
    const token = jwt.sign(
      { userId: 'u-1', username: 'alice', role: 'org_user', organization: '分公司A' },
      'test-secret',
      { expiresIn: '1h' },
    );
    const req = makeReq({ cookie: `cx_access_token=${encodeURIComponent(token)}; other=1` });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user.organization).toBe('分公司A');
    expect(req.user.allowedRoutes).toEqual(['/specialty']);
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

describe('authMiddleware: JWT 实时吊销（isUsernameActive 二次校验）', () => {
  function jwtFor(username: string): string {
    return jwt.sign({ userId: 'u', username, role: 'branch_admin' }, 'test-secret', {
      expiresIn: '1h',
    });
  }

  it('缓存就绪 + 账号仍 active → 放行', async () => {
    setActiveUsernames(['alice', 'bob']);
    const req = makeReq({ authorization: `Bearer ${jwtFor('alice')}` });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user.username).toBe('alice');
  });

  it('账号被禁用/删除（不在 active 集合）→ 签名合法的旧 JWT 立即 401', async () => {
    setActiveUsernames(['alice']); // bob 已被禁用/删除
    const req = makeReq({ authorization: `Bearer ${jwtFor('bob')}` });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
    expect((err as AppError).message).toMatch(/disabled|removed/i);
  });

  it('Cookie JWT 出口同样受实时吊销约束', async () => {
    setActiveUsernames(['alice']);
    const token = jwtFor('bob');
    const req = makeReq({ cookie: `cx_access_token=${encodeURIComponent(token)}` });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
  });

  it('缓存未就绪（null）→ fail-open，不误锁（既有会话行为不变）', async () => {
    __resetActiveUsernamesCacheForTest();
    const req = makeReq({ authorization: `Bearer ${jwtFor('whoever')}` });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pns（password-not-set，尚未自设密码）拦截 —— 强制设密的服务端代码兜底（Prompt 禁令须代码兜底）
// 锁死安全边界：带 pns 声明的会话打业务路由必 403，只放行设密/激活/会话生命周期白名单。
// 精确匹配（防前缀污染）回归锁沿用 #1067 对抗性评审修复。
// ─────────────────────────────────────────────────────────────────────────────
describe('authMiddleware: pns 强制设密拦截', () => {
  // 带 pns:true 的 JWT（模拟尚未自设密码的会话：存量旧密码登录 / 飞书首登）
  function pnsJwt(username = 'liangchunfan'): string {
    return jwt.sign(
      { userId: 'u', username, role: 'branch_admin', branchCode: 'SX', pns: true },
      'test-secret',
      { expiresIn: '1h' },
    );
  }

  beforeEach(() => {
    // active 缓存就绪（账号本身有效），确保 403 只可能来自 pns 而非实时吊销
    setActiveUsernames(['liangchunfan', 'admin']);
  });

  it('pns 会话打业务路由 → 403 PASSWORD_NOT_SET', async () => {
    const req = makeReq({ authorization: `Bearer ${pnsJwt()}`, originalUrl: '/api/query/kpi' });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).message).toBe('PASSWORD_NOT_SET');
    expect(req.user).toBeUndefined(); // 拦在赋值前，不泄漏身份给下游
  });

  it.each([
    '/api/auth/change-password',
    '/api/auth/me',
    '/api/auth/logout',
    '/api/auth/refresh',
    '/api/auth/activate',
    '/api/auth/me?x=1', // 带 query string 仍放行（剥 ? 后匹配）
  ])('pns 会话打白名单 %s → 放行', async (originalUrl) => {
    const req = makeReq({ authorization: `Bearer ${pnsJwt()}`, originalUrl });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user?.username).toBe('liangchunfan');
  });

  it.each([
    '/api/auth/change-password-history', // 前缀污染：以白名单项为前缀但语义不同
    '/api/auth/mentions', // 以 /api/auth/me 为裸前缀
    '/api/auth/activated-list', // 以 /api/auth/activate 为裸前缀
  ])('pns 会话打伪装成白名单前缀的路由 %s → 仍 403（精确匹配，非裸 startsWith）', async (originalUrl) => {
    const req = makeReq({ authorization: `Bearer ${pnsJwt()}`, originalUrl });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('无 pns 声明的普通会话打业务路由 → 放行（对照，证明 403 确由 pns 触发）', async () => {
    const token = jwt.sign(
      { userId: 'u', username: 'liangchunfan', role: 'branch_admin' },
      'test-secret',
      { expiresIn: '1h' },
    );
    const req = makeReq({ authorization: `Bearer ${token}`, originalUrl: '/api/query/kpi' });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user?.username).toBe('liangchunfan');
  });

  it('admin 豁免（对照）：admin 会话不带 pns 声明（签发层豁免），业务路由畅通', async () => {
    // 豁免在签发层（authService.isPasswordNotSet 对 admin 恒 false），中间件只信声明；
    // 此处锁死「正常 admin token（无 pns）打业务路由放行」的端到端结果。
    const token = jwt.sign(
      { userId: 'admin', username: 'admin', role: 'branch_admin' },
      'test-secret',
      { expiresIn: '1h' },
    );
    const req = makeReq({ authorization: `Bearer ${token}`, originalUrl: '/api/query/kpi' });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user?.username).toBe('admin');
  });

  it('pns 会话经 Cookie 出口打业务路由 → 同样 403（cookie 分支不漏兜底）', async () => {
    const req = makeReq({
      cookie: `cx_access_token=${encodeURIComponent(pnsJwt())}`,
      originalUrl: '/api/query/kpi',
    });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// visibleBranches 派生对登录方式不敏感（2026-07-14-claude-ec5dba 核实结论）
//
// issueCookieSession()（server/src/services/auth.ts）签发 JWT 时，无论密码登录还是飞书扫码，
// payload 构造都只列出 userId/sub/username/role/organization/branchCode/pns/amr/identityId
// 固定字段，**从不写入 visibleBranches**——该字段单一事实源在 PRESET_USERS，由本文件顶部
// decorateVisibleBranches() 在 authMiddleware 内按已验证 token 的 username 统一派生注入
// （codex 闸-1 P1-3），覆盖 JWT/PAT/cookie 全部出口，与签发时用的是密码登录还是飞书登录无关。
// 下面两个用例直接模拟「飞书扫码签发的 JWT（同样不含 visibleBranches 字段）」，验证该机制
// 已经覆盖飞书登录路径：全国超管映射用户名（xuechenglong）应派生 visibleBranches；
// 飞书部门个人账号（authProvisioning=personal_feishu，username 非 PRESET_USERS 已注册键）应保持
// undefined，不误得全国超管切省能力。
// ─────────────────────────────────────────────────────────────────────────────
describe('authMiddleware: visibleBranches 派生覆盖飞书登录路径（回归锁）', () => {
  it('模拟飞书扫码签发的 JWT（全国超管映射用户名 xuechenglong，JWT 本身不含 visibleBranches）→ 仍派生 [SC,SX]', async () => {
    // 与 issueCookieSession 的 payload 字段集合一致：故意不写 visibleBranches，
    // 复现飞书登录后签发的真实 JWT 形态。
    const token = jwt.sign(
      { userId: 'xuechenglong', sub: 'xuechenglong', username: 'xuechenglong', role: 'branch_admin', branchCode: 'SC', amr: ['feishu'] },
      'test-secret',
      { expiresIn: '1h' },
    );
    const req = makeReq({ authorization: `Bearer ${token}` });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user.visibleBranches).toEqual(['SC', 'SX']);
  });

  it('飞书部门个人账号（org_user，username 非 PRESET_USERS 已注册键）→ visibleBranches 保持 undefined，不误得切省能力', async () => {
    const token = jwt.sign(
      { userId: 'feishu-open-id-xyz', sub: 'feishu-open-id-xyz', username: 'ou_feishu_dept_member', role: 'org_user', organization: '运城', branchCode: 'SX', amr: ['feishu'] },
      'test-secret',
      { expiresIn: '1h' },
    );
    const req = makeReq({ authorization: `Bearer ${token}` });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.user.visibleBranches).toBeUndefined();
  });
});
