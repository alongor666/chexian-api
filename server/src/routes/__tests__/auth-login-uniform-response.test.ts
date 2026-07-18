/**
 * 登录端点对外响应统一化（M6 · 2026-07-12 loop 823570）
 *
 * 缺陷背景：authService.login() 对「账号禁用」「IP 不允许」分别抛 403 Account disabled /
 * 403 IP not allowed，与「用户名或密码错误」的 401 状态码 + 文案不同——路由层此前原样把这两个
 * 403 透传给客户端，直接暴露账号是否存在 / 是否被禁用 / IP 是否被拒绝。
 *
 * 修复验证（路由层 loginHandler，server/src/routes/auth.ts）：
 *   - 服务层保留原有 403 Account disabled / 403 IP not allowed 内部契约（供审计记录真实原因，
 *     不破坏 auth-sx-active-gate.test.ts 等既有服务层测试）；
 *   - 路由层捕获这两种 403 后，对客户端统一改写为 401 + 与「用户名或密码错误」完全相同的文案；
 *   - 审计日志（auditAuthEvent）仍记录真实原因（login_account_disabled / login_ip_denied），
 *     不因对外统一化而丢失可追溯性；
 *   - 未知用户 / 密码错误两种既有 401 路径行为不变（本就统一，不用改写）；
 *   - M6 残余面收口（2026-07-18）：无密码凭据账号（飞书专属）的 403 AUTH_METHOD_NOT_ALLOWED
 *     同样改写为统一 401，真实原因入审计（login_password_not_allowed）。
 *
 * 测试层级：直接调用导出的 loginHandler（项目无 supertest），mock authService / rateLimiter /
 * audit 三个直接依赖，其余依赖使用真实模块（已验证可安全裸导入，无 DB 副作用）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { AppError } from '../../middleware/error.js';

const mockLogin = vi.fn();
const mockIssueCookieSession = vi.fn(() => ({
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  sessionId: 'sid',
}));

vi.mock('../../services/auth.js', () => ({
  authService: {
    login: (...args: unknown[]) => mockLogin(...(args as [])),
    issueCookieSession: (...args: unknown[]) => mockIssueCookieSession(...(args as [])),
  },
}));

const mockCheckAccountLock = vi.fn();
const mockRecordLoginFailure = vi.fn();
const mockResetLoginAttempts = vi.fn();

vi.mock('../../middleware/rateLimiter.js', () => ({
  checkAccountLock: (...args: unknown[]) => mockCheckAccountLock(...(args as [])),
  recordLoginFailure: (...args: unknown[]) => mockRecordLoginFailure(...(args as [])),
  resetLoginAttempts: (...args: unknown[]) => mockResetLoginAttempts(...(args as [])),
}));

const mockAudit = vi.fn();
vi.mock('../../middleware/audit.js', () => ({
  auditAuthEvent: (p: unknown) => mockAudit(p),
}));

import { loginHandler } from '../auth.js';

interface FakeRes {
  cookies: Record<string, { value: string; opts: Record<string, unknown> }>;
  jsonBody: unknown;
}

function makeRes(): FakeRes & {
  cookie: (n: string, v: string, o: Record<string, unknown>) => void;
  json: (b: unknown) => void;
} {
  const res: any = {
    cookies: {},
    jsonBody: null,
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      res.cookies[name] = { value, opts };
    },
    json(body: unknown) {
      res.jsonBody = body;
    },
  };
  return res;
}

function makeReq(username: string, password: string, ip = '203.0.113.9'): Request {
  return {
    body: { username, password },
    ip,
    connection: {},
    socket: {},
  } as unknown as Request;
}

/** 测试专用 FakeRes → Express Response 类型断言（项目无 supertest，走裸对象 mock） */
function asExpressResponse(res: ReturnType<typeof makeRes>): Response {
  return res as unknown as Response;
}

const GENERIC_401 = { statusCode: 401, message: 'Invalid username or password' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/login — 对外响应统一化（防用户名/账号状态枚举）', () => {
  it('未知用户：服务层 401 原样透传（本就是统一文案，不用改写）', async () => {
    mockLogin.mockRejectedValueOnce(new AppError(401, 'Invalid username or password'));

    await expect(loginHandler(makeReq('ghost', 'x'), asExpressResponse(makeRes()))).rejects.toMatchObject(GENERIC_401);

    expect(mockRecordLoginFailure).toHaveBeenCalledWith('203.0.113.9', 'ghost');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_failure', username: 'ghost' })
    );
  });

  it('密码错误：服务层 401 原样透传', async () => {
    mockLogin.mockRejectedValueOnce(new AppError(401, 'Invalid username or password'));

    await expect(loginHandler(makeReq('testuser', 'wrong'), asExpressResponse(makeRes()))).rejects.toMatchObject(GENERIC_401);

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_failure', username: 'testuser' })
    );
  });

  it('禁用账号：客户端只看到 401 通用文案，403 Account disabled 不透出；真实原因入审计', async () => {
    mockLogin.mockRejectedValueOnce(new AppError(403, 'Account disabled'));

    await expect(loginHandler(makeReq('disableduser', 'any'), asExpressResponse(makeRes()))).rejects.toMatchObject(GENERIC_401);

    // 计入登录失败锁定（与密码错误同等对待，防止「不计次」被用来无限试探哪些账号被禁用）
    expect(mockRecordLoginFailure).toHaveBeenCalledWith('203.0.113.9', 'disableduser');
    // 审计日志记录真实原因，供服务端追溯（不是笼统的 login_failure）
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_account_disabled', username: 'disableduser', ip: '203.0.113.9' })
    );
  });

  it('IP 不允许：客户端只看到 401 通用文案，403 IP not allowed 不透出；真实原因入审计；计入登录失败锁定', async () => {
    mockLogin.mockRejectedValueOnce(new AppError(403, 'IP not allowed'));

    await expect(
      loginHandler(makeReq('ipuser', 'any', '198.51.100.7'), asExpressResponse(makeRes()))
    ).rejects.toMatchObject(GENERIC_401);

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_ip_denied', username: 'ipuser', ip: '198.51.100.7' })
    );
    // 代码审查发现（P1）：若 IP 拒绝不计入锁定计数，而其余三种失败场景都计入，
    // 则「该用户名反复从被拒 IP 试探永不触发 429 锁定」本身构成一种多请求行为侧信道
    // （区分「IP 受限的真实账号」与「无限制的未知/任意账号」）。四种失败场景对客户端的
    // 单次响应已字节级一致，此处让锁定计数也保持一致，堵住这条残余枚举面。
    expect(mockRecordLoginFailure).toHaveBeenCalledWith('198.51.100.7', 'ipuser');
  });

  it('无密码凭据账号（飞书专属）：客户端只看到 401 通用文案，403 AUTH_METHOD_NOT_ALLOWED 不透出；真实原因入审计；计入登录失败锁定', async () => {
    mockLogin.mockRejectedValueOnce(new AppError(403, 'AUTH_METHOD_NOT_ALLOWED'));

    await expect(
      loginHandler(makeReq('feishuonlyuser', 'any'), asExpressResponse(makeRes()))
    ).rejects.toMatchObject(GENERIC_401);

    // M6 残余面收口（2026-07-18）：若原样透传 403 AUTH_METHOD_NOT_ALLOWED，响应差异
    // 泄露「该用户名存在且是飞书专属/无密码账号」——与禁用/IP 拒绝同类枚举面，同等对待。
    expect(mockRecordLoginFailure).toHaveBeenCalledWith('203.0.113.9', 'feishuonlyuser');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'login_password_not_allowed',
        username: 'feishuonlyuser',
        ip: '203.0.113.9',
      })
    );
  });

  it('五种失败场景对外响应字节级一致（statusCode + message 完全相同，防枚举核心断言）', async () => {
    const scenarios: Array<[string, AppError]> = [
      ['unknown-user', new AppError(401, 'Invalid username or password')],
      ['wrong-password', new AppError(401, 'Invalid username or password')],
      ['disabled-account', new AppError(403, 'Account disabled')],
      ['ip-denied', new AppError(403, 'IP not allowed')],
      ['feishu-only-no-password', new AppError(403, 'AUTH_METHOD_NOT_ALLOWED')],
    ];

    const responses: unknown[] = [];
    for (const [username, err] of scenarios) {
      mockLogin.mockRejectedValueOnce(err);
      const caught = await loginHandler(makeReq(username, 'x'), asExpressResponse(makeRes())).catch((e) => e);
      responses.push({ statusCode: (caught as AppError).statusCode, message: (caught as AppError).message });
    }

    // 全部五种场景对外必须是完全相同的 {401, 'Invalid username or password'}
    for (const r of responses) {
      expect(r).toEqual({ statusCode: 401, message: 'Invalid username or password' });
    }
  });

  it('登录成功：resetLoginAttempts + login_success 审计 + 会话 cookie 正常签发', async () => {
    mockLogin.mockResolvedValueOnce({
      user: { username: 'testuser', role: 'org_user', organization: '乐山' },
    });
    const res = makeRes();

    await loginHandler(makeReq('testuser', 'correct-pw'), asExpressResponse(res));

    expect(mockResetLoginAttempts).toHaveBeenCalledWith('203.0.113.9', 'testuser');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_success', username: 'testuser' })
    );
    expect(res.cookies['cx_access_token']).toBeDefined();
    expect(res.cookies['cx_refresh_token']).toBeDefined();
    expect((res.jsonBody as any).success).toBe(true);
  });

  it('账号/IP 锁定：checkAccountLock 抛错时不调用 authService.login（既有行为不回归）', async () => {
    mockCheckAccountLock.mockImplementationOnce(() => {
      throw new AppError(429, '登录失败次数过多，请 2 分钟后再试');
    });

    await expect(loginHandler(makeReq('lockeduser', 'x'), asExpressResponse(makeRes()))).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });
});
