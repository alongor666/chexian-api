/**
 * 飞书 OAuth state 意图区分单测（全员密码闭环 · 阶段二找回双通道，2026-07-11）
 *
 * 锁定语义：
 *   1. intent 只存于服务端签发的 state cookie（`<state>.<intent>`），callback 不信 query；
 *      旧格式 cookie（无后缀）兼容为 login
 *   2. 🔴 reset state 不能换取登录会话：intent=reset 的 callback 绝不 set
 *      cx_access_token / cx_refresh_token，绝不调用 issueCookieSession
 *   3. reset 成功：签发一次性重置令牌 → httpOnly cookie（path 收窄到消费端点）→
 *      跳 /#/reset-password?feishu=ready；审计只落 tokenId 非明文
 *   4. 防枚举：租户不符 / 无映射 / 账号不存在 / 账号停用 → 统一 feishu_reset_failed
 *   5. login intent 原有流程不回归（会话 cookie 照发）
 *
 * 测试层级：mock 全部服务依赖，直接调用导出的 handler（项目无 supertest）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AccessUser } from '../../services/access-control.js';

vi.mock('../../config/env.js', () => ({
  authEnv: { JWT_EXPIRES_IN: '4h', JWT_REFRESH_EXPIRES_IN: '7d' },
  feishuEnv: { FEISHU_DEV_FRONTEND_ORIGIN: 'http://localhost:5173' },
}));

const mockExchange = vi.fn(async () => 'user-access-token');
const mockGetUserInfo = vi.fn(async () => ({
  name: '乐山用户',
  open_id: 'ou_abc',
  mobile: '+8613800000000',
  tenant_key: 'tenant-ok',
}));
const mockIsTenantAllowed = vi.fn((_k?: string) => true);
const mockResolvePermission = vi.fn(async (): Promise<Record<string, unknown> | null> => ({
  username: 'leshan',
  displayName: '乐山机构',
  role: 'org_user',
  branchCode: 'SC',
}));

vi.mock('../../services/feishu.js', () => ({
  feishuService: {
    isConfigured: () => true,
    getConfig: () => ({ appId: 'cli_test' }),
    exchangeUserAccessToken: (...args: unknown[]) => mockExchange(...(args as [])),
    getUserInfo: (...args: unknown[]) => mockGetUserInfo(...(args as [])),
    isTenantAllowed: (k?: string) => mockIsTenantAllowed(k),
    resolvePermission: () => mockResolvePermission(),
  },
}));

const mockIssueCookieSession = vi.fn(() => ({
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  sessionId: 'sid',
}));
const mockIsPasswordNotSetForUsername = vi.fn(async (_u: string) => false);

vi.mock('../../services/auth.js', () => ({
  authService: {
    issueCookieSession: (...args: unknown[]) => mockIssueCookieSession(...(args as [])),
    isPasswordNotSetForUsername: (u: string) => mockIsPasswordNotSetForUsername(u),
  },
}));

const storeUser: AccessUser = {
  id: 'uid-leshan',
  username: 'leshan',
  displayName: '乐山机构',
  passwordHash: 'x',
  role: 'org_user',
  branchCode: 'SC',
  active: true,
};
const mockGetUserByUsername = vi.fn(async (_u: string): Promise<AccessUser | null> => storeUser);
const mockEnsurePresetUser = vi.fn(async (_u: string): Promise<AccessUser | null> => null);

vi.mock('../../services/access-control.js', () => ({
  getUserByUsername: (u: string) => mockGetUserByUsername(u),
  ensurePresetUser: (u: string) => mockEnsurePresetUser(u),
}));

vi.mock('../../services/auth-identity.js', () => ({
  findFeishuAccount: async () => null,
  findOrCreateFeishuAccount: async () => ({
    user: storeUser,
    identity: { id: 'identity-1', userId: storeUser.id, provider: 'feishu', providerSubject: 'u1', enabled: true },
    created: true,
  }),
}));

const mockCreateResetToken = vi.fn(async (_input: unknown) => ({
  plaintext: 'cx_rst_AAAA1111.' + 's'.repeat(43),
  tokenId: 'AAAA1111',
  username: 'leshan',
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
}));

vi.mock('../../services/activation-token.js', () => ({
  createPasswordResetToken: (input: unknown) => mockCreateResetToken(input as never),
}));

const mockAudit = vi.fn();
vi.mock('../../middleware/audit.js', () => ({
  auditAuthEvent: (p: unknown) => mockAudit(p),
}));

vi.mock('../../middleware/rateLimiter.js', () => ({
  resetInitLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import {
  buildStateCookieValue,
  parseStateCookieValue,
  feishuCallbackHandler,
  feishuConfigHandler,
} from '../feishu-auth.js';

interface FakeRes {
  cookies: Record<string, { value: string; opts: Record<string, unknown> }>;
  cleared: string[];
  redirectUrl: string | null;
  jsonBody: unknown;
  statusCode: number;
}

function makeRes(): FakeRes & {
  cookie: (n: string, v: string, o: Record<string, unknown>) => void;
  clearCookie: (n: string) => void;
  redirect: (u: string) => void;
  json: (b: unknown) => void;
  status: (c: number) => unknown;
} {
  const res: any = {
    cookies: {},
    cleared: [],
    redirectUrl: null,
    jsonBody: null,
    statusCode: 200,
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      res.cookies[name] = { value, opts };
    },
    clearCookie(name: string) {
      res.cleared.push(name);
    },
    redirect(url: string) {
      res.redirectUrl = url;
    },
    json(body: unknown) {
      res.jsonBody = body;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
  };
  return res;
}

function makeCallbackReq(state: string, cookieValue: string | null) {
  return {
    query: { code: 'auth-code', state },
    headers: cookieValue === null ? {} : { cookie: `cx_feishu_state=${encodeURIComponent(cookieValue)}` },
    get: () => 'localhost:3000',
    ip: '203.0.113.9',
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserByUsername.mockResolvedValue(storeUser);
  mockResolvePermission.mockResolvedValue({
    username: 'leshan',
    displayName: '乐山机构',
    role: 'org_user',
    branchCode: 'SC',
  });
  mockIsTenantAllowed.mockReturnValue(true);
});

describe('state cookie 值编解码', () => {
  it('build/parse 往返一致；旧格式（无后缀）兼容为 login；非法 intent 兜底 login', () => {
    expect(parseStateCookieValue(buildStateCookieValue('abc123', 'reset'))).toEqual({ state: 'abc123', intent: 'reset' });
    expect(parseStateCookieValue(buildStateCookieValue('abc123', 'login'))).toEqual({ state: 'abc123', intent: 'login' });
    expect(parseStateCookieValue('legacyhexstate')).toEqual({ state: 'legacyhexstate', intent: 'login' });
    expect(parseStateCookieValue('abc123.evil')).toEqual({ state: 'abc123.evil', intent: 'login' });
  });
});

describe('GET /config：intent 内嵌进 state cookie（服务端签发，不信 query）', () => {
  it('intent=reset → cookie 值带 .reset 后缀；缺省 → .login', () => {
    for (const [query, expected] of [[{ intent: 'reset' }, 'reset'], [{}, 'login']] as const) {
      const res = makeRes();
      feishuConfigHandler({ query, get: () => 'localhost:3000' } as never, res as never);
      const cookie = res.cookies['cx_feishu_state'];
      expect(cookie).toBeDefined();
      const parsed = parseStateCookieValue(cookie.value);
      expect(parsed.intent).toBe(expected);
      // 响应里的 state 与 cookie 内 state 部分一致（前端拼授权 URL 用裸 state）
      expect((res.jsonBody as any).data.state).toBe(parsed.state);
    }
  });
});

describe('callback · intent=reset（🔴 reset state 不能换取登录会话）', () => {
  it('成功：不发任何会话 cookie、不调 issueCookieSession；发 path 收窄的重置令牌 cookie；跳设新密页', async () => {
    const res = makeRes();
    await feishuCallbackHandler(makeCallbackReq('st4te', buildStateCookieValue('st4te', 'reset')), res as never);

    // 绝不签发登录会话
    expect(res.cookies['cx_access_token']).toBeUndefined();
    expect(res.cookies['cx_refresh_token']).toBeUndefined();
    expect(mockIssueCookieSession).not.toHaveBeenCalled();

    // 一次性重置令牌进 httpOnly cookie，path 收窄到消费端点
    const resetCookie = res.cookies['cx_reset_token'];
    expect(resetCookie).toBeDefined();
    expect(resetCookie.value).toMatch(/^cx_rst_/);
    expect(resetCookie.opts.httpOnly).toBe(true);
    expect(resetCookie.opts.path).toBe('/api/auth/reset-password');

    expect(mockCreateResetToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'uid-leshan', createdBy: 'feishu-reset', ttlMs: 10 * 60 * 1000 })
    );
    // 审计只落 tokenId，绝无明文
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'reset_token_created', username: 'leshan', tokenId: 'AAAA1111' })
    );
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain('cx_rst_AAAA1111.');

    expect(res.redirectUrl).toBe('http://localhost:5173/#/reset-password?feishu=ready');
  });

  it('防枚举：无映射 / 租户不符 / 账号不存在 / 账号停用 → 统一 feishu_reset_failed，零 cookie', async () => {
    const scenarios: Array<() => void> = [
      () => mockResolvePermission.mockResolvedValueOnce(null),
      () => mockIsTenantAllowed.mockReturnValueOnce(false),
      () => mockGetUserByUsername.mockResolvedValueOnce(null),
      () => mockGetUserByUsername.mockResolvedValueOnce({ ...storeUser, active: false }),
    ];
    for (const arrange of scenarios) {
      vi.clearAllMocks();
      mockGetUserByUsername.mockResolvedValue(storeUser);
      arrange();
      const res = makeRes();
      await feishuCallbackHandler(makeCallbackReq('st4te', buildStateCookieValue('st4te', 'reset')), res as never);
      expect(res.redirectUrl).toBe('http://localhost:5173/#/login?error=feishu_reset_failed');
      expect(res.cookies['cx_reset_token']).toBeUndefined();
      expect(res.cookies['cx_access_token']).toBeUndefined();
      expect(mockIssueCookieSession).not.toHaveBeenCalled();
    }
  });

  it('state 不匹配 → feishu_state_mismatch，既无会话也无重置令牌', async () => {
    const res = makeRes();
    await feishuCallbackHandler(makeCallbackReq('attacker-state', buildStateCookieValue('st4te', 'reset')), res as never);
    expect(res.redirectUrl).toBe('http://localhost:5173/#/login?error=feishu_state_mismatch');
    expect(Object.keys(res.cookies)).toHaveLength(0);
    expect(mockCreateResetToken).not.toHaveBeenCalled();
  });
});

describe('callback · intent=login（原有流程不回归）', () => {
  it('登录意图照常签发会话 cookie，且绝不签发重置令牌', async () => {
    const res = makeRes();
    await feishuCallbackHandler(makeCallbackReq('st4te', buildStateCookieValue('st4te', 'login')), res as never);

    expect(mockIssueCookieSession).toHaveBeenCalledTimes(1);
    expect(res.cookies['cx_access_token']?.value).toBe('access-token');
    expect(res.cookies['cx_refresh_token']?.value).toBe('refresh-token');
    expect(res.cookies['cx_reset_token']).toBeUndefined();
    expect(mockCreateResetToken).not.toHaveBeenCalled();
    expect(res.redirectUrl).toBe('http://localhost:5173/#/login?feishu=success');
  });

  it('旧格式 state cookie（无 intent 后缀，升级窗口存量）→ 按 login 处理', async () => {
    const res = makeRes();
    await feishuCallbackHandler(makeCallbackReq('legacystate', 'legacystate'), res as never);
    expect(mockIssueCookieSession).toHaveBeenCalledTimes(1);
    expect(res.cookies['cx_reset_token']).toBeUndefined();
    expect(res.redirectUrl).toBe('http://localhost:5173/#/login?feishu=success');
  });
});
