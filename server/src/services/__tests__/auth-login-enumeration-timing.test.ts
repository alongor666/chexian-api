/**
 * 登录用户枚举 + 计时侧信道防护（M6 · 2026-07-12 loop 823570）
 *
 * 缺陷背景：
 *   1. 未知用户在 bcrypt 比对之前早退（提前 401），与「账号存在但密码错误」的响应耗时不同，
 *      构成计时侧信道，可探测用户名是否存在。
 *   2. 禁用账号（Account disabled）/ IP 不允许（IP not allowed）在密码校验之前早退 403，
 *      同样构成计时侧信道，且状态码/文案与「用户名或密码错误」不同，直接暴露账号存在性。
 *
 * 修复验证（服务层 authService.login）：
 *   - 未知用户名：跑一次「哑」bcrypt 比对（进程级固定的运行时生成哈希，非真实用户哈希），再统一抛 401。
 *   - 禁用账号 / IP 不允许：先跑一次「真实」bcrypt 比对（针对该账号真实哈希），再抛出
 *     原有的 403（服务层内部错误契约不变，供审计/路由层区分真实原因；对外文案统一化
 *     在路由层完成，见 auth-login-route-uniform-response.test.ts）。
 *   - 密码错误：跑一次真实 bcrypt 比对，抛 401。
 *   - 四种路径（未知用户 / 密码错误 / 账号禁用 / IP 不允许）均恰好调用一次 bcrypt.compare，
 *     防止「有的路径跳过 bcrypt、有的路径不跳过」造成的可观测耗时差异。
 *
 * 测试层级：单元测试（mock access-control.js / credential-policy.js，真实 bcrypt，
 * bcryptSaltRounds=4 只为测试提速；不需要 DuckDB）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcrypt';
import type { AccessUser } from '../access-control.js';

vi.mock('../../config/auth.js', () => ({
  authConfig: {
    jwtSecret: 'test-secret',
    jwtExpiresIn: '4h',
    jwtRefreshExpiresIn: '7d',
    bcryptSaltRounds: 4,
  },
}));

vi.mock('../../config/env.js', () => ({
  authEnv: {
    USER_PASSWORDS: undefined,
    USER_ALLOWED_IPS: undefined,
    DEV_SKIP_AUTH: undefined, // 禁止绕过密码验证，本文件专测真实 bcrypt 调用路径
  },
}));

const mockGetUserByUsername = vi.fn(async (_username: string): Promise<AccessUser | null> => null);
const mockEnsurePresetUser = vi.fn(async (_username: string): Promise<AccessUser | null> => null);

vi.mock('../access-control.js', () => ({
  // 纯函数，用真实实现（auth.ts normalizeUsername 委托给它）
  canonicalizeUsername: (u: string) => u.normalize('NFKC').trim().toLowerCase(),
  getUserByUsername: (u: string) => mockGetUserByUsername(u),
  ensurePresetUser: (u: string) => mockEnsurePresetUser(u),
}));

vi.mock('../credential-policy.js', () => ({
  // 凭据语义字段一律用一眼可辨的假值（unit-test-fake-* 前缀），避免通用短词字面量触发
  // GitGuardian Generic Password 扫描器误报（参 pr-evolution.md 2026-07-15 PR #1115）。
  assertPasswordAllowed: async () => ({ userId: 'test', passwordHash: 'unit-test-fake-hash', state: 'active' }),
  credentialSetupRequired: async () => false,
}));

import { authService } from '../auth.js';

// 明确标记为单测假明文（unit-test-fake-*），避免像真实口令的字面量触发 GitGuardian
// Generic Password 扫描器误报（参 pr-evolution.md 2026-07-15 PR #1115）；登录只做 bcrypt.compare
// 不校验口令策略，任意字符串即可，唯一要求是与 REAL_HASH 对应。
const CORRECT_PASSWORD = 'unit-test-fake-correct-pw';
const REAL_HASH = bcrypt.hashSync(CORRECT_PASSWORD, 4);

function makeUser(overrides: Partial<AccessUser> = {}): AccessUser {
  return {
    id: 'test-id',
    username: 'testuser',
    displayName: '测试用户',
    passwordHash: REAL_HASH,
    role: 'org_user',
    branchCode: 'SC',
    active: true,
    ...overrides,
  };
}

describe('登录用户枚举 + 计时侧信道防护（M6）', () => {
  // bcrypt.compare 是重载函数（回调式 / Promise 式），vi.spyOn 的精确类型推导在此没有增益，
  // 显式 any 规避与项目其余 bcrypt 测试同一取舍（见 auth-password-change.test.ts 同类用法）。
  let compareSpy: any;

  beforeEach(() => {
    mockGetUserByUsername.mockReset();
    mockEnsurePresetUser.mockReset();
    compareSpy = vi.spyOn(bcrypt, 'compare');
  });

  afterEach(() => {
    compareSpy.mockRestore();
  });

  it('未知用户名：不再提前早退，跑一次哑 bcrypt 比对（非该用户/任何真实哈希）后统一 401', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(null);

    await expect(authService.login('ghost-user', 'whatever')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid username or password',
    });

    expect(compareSpy).toHaveBeenCalledTimes(1);
    const [, hashArg] = compareSpy.mock.calls[0];
    expect(typeof hashArg).toBe('string');
    expect(hashArg.startsWith('$2')).toBe(true); // 运行时生成的哑 bcrypt 哈希，真实 bcrypt 格式
    expect(hashArg).not.toBe(REAL_HASH);
  });

  it('未知用户名：多次调用哑哈希保持稳定（同一固定常量，非每次随机生成）', async () => {
    mockGetUserByUsername.mockResolvedValue(null);

    await authService.login('ghost-1', 'x').catch(() => {});
    const firstHash = compareSpy.mock.calls[0][1];
    compareSpy.mockClear();

    await authService.login('ghost-2', 'y').catch(() => {});
    const secondHash = compareSpy.mock.calls[0][1];

    expect(firstHash).toBe(secondHash);
  });

  it('禁用账号：先跑真实 bcrypt 比对（针对该账号哈希）再判定 403 Account disabled', async () => {
    const user = makeUser({ active: false });
    mockGetUserByUsername.mockResolvedValueOnce(user);

    await expect(authService.login('testuser', 'any-password')).rejects.toMatchObject({
      statusCode: 403,
      message: 'Account disabled',
    });

    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy).toHaveBeenCalledWith('any-password', REAL_HASH);
  });

  it('IP 不允许：先跑真实 bcrypt 比对再判定 403 IP not allowed', async () => {
    const user = makeUser({ allowedIps: ['10.0.0.1'] });
    mockGetUserByUsername.mockResolvedValueOnce(user);

    await expect(
      authService.login('testuser', 'any-password', '203.0.113.5')
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'IP not allowed',
    });

    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy).toHaveBeenCalledWith('any-password', REAL_HASH);
  });

  it('密码错误（账号存在、启用、IP 允许）：跑一次真实 bcrypt 比对后 401', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser());

    await expect(authService.login('testuser', 'wrong-password')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid username or password',
    });

    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy).toHaveBeenCalledWith('wrong-password', REAL_HASH);
  });

  it('四种失败路径（未知用户/密码错误/账号禁用/IP不允许）均恰好各跑一次 bcrypt 比对', async () => {
    const counts: Record<string, number> = {};

    mockGetUserByUsername.mockResolvedValueOnce(null);
    await authService.login('ghost', 'x').catch(() => {});
    counts.unknownUser = compareSpy.mock.calls.length;
    compareSpy.mockClear();

    mockGetUserByUsername.mockResolvedValueOnce(makeUser());
    await authService.login('testuser', 'wrong').catch(() => {});
    counts.wrongPassword = compareSpy.mock.calls.length;
    compareSpy.mockClear();

    mockGetUserByUsername.mockResolvedValueOnce(makeUser({ active: false }));
    await authService.login('testuser', 'any').catch(() => {});
    counts.disabledAccount = compareSpy.mock.calls.length;
    compareSpy.mockClear();

    mockGetUserByUsername.mockResolvedValueOnce(makeUser({ allowedIps: ['10.0.0.1'] }));
    await authService.login('testuser', 'any', '203.0.113.9').catch(() => {});
    counts.ipDenied = compareSpy.mock.calls.length;

    expect(counts).toEqual({
      unknownUser: 1,
      wrongPassword: 1,
      disabledAccount: 1,
      ipDenied: 1,
    });
  });

  it('正确密码 + 启用账号 + IP 允许：登录成功（回归——修复未破坏正常登录路径）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser());

    const result = await authService.login('testuser', CORRECT_PASSWORD);
    expect(result.user.username).toBe('testuser');
    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy).toHaveBeenCalledWith(CORRECT_PASSWORD, REAL_HASH);
  });
});
