/**
 * G7 P2 — SX 预置账号 active 闸运行时断言
 *
 * 验证：调用真实 authService.login() 路径，对 `active:false` 的山西账号
 * 返回 403（Account disabled），而非 401/200。
 *
 * 测试层级：单元测试（mock access-control.js，不需要 DuckDB）。
 * 可在 CI（`bun run test --run`）跑，无需原生 .node addon。
 *
 * 覆盖的安全闸：auth.ts 第 121 行
 *   if (!user.active) throw new AppError(403, 'Account disabled')
 *
 * 背景：G7（PR #775）已有静态断言（preset-users.test.ts 验证 active===false），
 * 本测试补充「运行时走真实 login() 调用链得到 403」这一 P2 缺口。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AccessUser } from '../access-control.js';

// ── auth 配置 mock（不依赖真实 JWT secret 与 bcrypt rounds）──────────────
vi.mock('../../config/auth.js', () => ({
  authConfig: {
    jwtSecret: 'test-secret',
    jwtExpiresIn: '4h',
    jwtRefreshExpiresIn: '7d',
    bcryptSaltRounds: 10,
  },
}));

// ── authEnv mock（禁止 DEV_SKIP_AUTH 干扰 active 闸测试）────────────────
vi.mock('../../config/env.js', () => ({
  authEnv: {
    USER_PASSWORDS: undefined,
    USER_ALLOWED_IPS: undefined,
    DEV_SKIP_AUTH: undefined, // 确保密码验证不被绕过（active 闸在密码验证前，此项仅防误）
  },
}));

// ── access-control mock（核心）────────────────────────────────────────────
// getUserByUsername 返回 active:false 的 SX 用户；
// ensurePresetUser 不应被调用（active=false 是直接 throw 前的检查，getUserByUsername 先命中）
const mockGetUserByUsername = vi.fn(async (_username: string): Promise<AccessUser | null> => null);
const mockEnsurePresetUser = vi.fn(async (_username: string): Promise<AccessUser | null> => null);

vi.mock('../access-control.js', () => ({
  // 纯函数，用真实实现（auth.ts normalizeUsername 委托给它）
  canonicalizeUsername: (u: string) => u.normalize('NFKC').trim().toLowerCase(),
  getUserByUsername: (_username: string) => mockGetUserByUsername(_username),
  ensurePresetUser: (_username: string) => mockEnsurePresetUser(_username),
}));

vi.mock('../credential-policy.js', () => ({
  assertPasswordAllowed: async () => ({ userId: 'test', passwordHash: 'hash', state: 'active' }),
  credentialSetupRequired: async () => false,
}));

// ── 被测模块（在 mock 注册后 import）────────────────────────────────────
import { authService } from '../auth.js';
import { AppError } from '../../middleware/error.js';
import { PRESET_USERS } from '../../config/preset-users.js';

// ── 辅助：构造一个 active:false 的 SX AccessUser（镜像 preset-users.ts 结构）
function makeSxUser(username: string, role: string, organization?: string): AccessUser {
  const preset = PRESET_USERS[username];
  return {
    id: `test-id-${username}`,
    username,
    displayName: preset?.displayName ?? username,
    passwordHash: preset?.passwordHash ?? '$2b$10$SXTombstoneInvalid000000000000000000000000000000000000u',
    role,
    branchCode: 'SX',
    organization,
    allowedRoutes: preset?.allowedRoutes,
    defaultRoute: preset?.defaultRoute,
    allowedIps: undefined,
    specialFeatures: preset?.specialFeatures,
    active: false, // 核心断言：山西账号全部 active:false
  };
}

// ── 辅助：构造一个 active:true 的 SC 账号（反向对照用，跳过 active 闸）
function makeActiveScUser(): AccessUser {
  return {
    id: 'test-id-sc-active',
    username: 'leshan',
    displayName: '乐山机构（测试夹具）',
    // tombstone hash —— DEV_SKIP_AUTH 未启用时密码会验证失败(401)，
    // 但此 hash 专为"active 闸放行后到密码验证"的流程编写，预期得 401 而非 403。
    passwordHash: '$2b$10$SomeTombstoneHashForLeshanOrg0000000000000000000000u',
    role: 'org_user',
    branchCode: 'SC',
    organization: '乐山',
    allowedRoutes: ['/home', '/performance-analysis', '/growth', '/specialty'],
    defaultRoute: '/performance-analysis',
    allowedIps: undefined,
    specialFeatures: undefined,
    active: true, // SC 账号 active:true
  };
}

beforeEach(() => {
  mockGetUserByUsername.mockReset();
  mockEnsurePresetUser.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// SX 超管 sxAdmin — login→403（active 闸）
// ─────────────────────────────────────────────────────────────────────────────
describe('SX 超管 sxAdmin — active 闸运行时', () => {
  it('login(sxAdmin) 得到 403 Account disabled，不得是 401/200', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeSxUser('sxAdmin', 'branch_admin', undefined),
    );

    await expect(authService.login('sxAdmin', 'any-password')).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).message).toBe('Account disabled');
      return true;
    });
  });

  it('403 由 active:false 触发，而非账号不存在（getUserByUsername 被调用一次）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeSxUser('sxAdmin', 'branch_admin', undefined),
    );

    try {
      await authService.login('sxAdmin', 'any-password');
    } catch {
      // 预期失败
    }

    // getUserByUsername 必须被调用（账号存在路径），ensurePresetUser 不应被调用
    expect(mockGetUserByUsername).toHaveBeenCalledOnce();
    expect(mockGetUserByUsername).toHaveBeenCalledWith('sxadmin'); // normalizeUsername → toLowerCase
    expect(mockEnsurePresetUser).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SX 山西 org_user 代表：sx_taiyuan1（太原一部）
// ─────────────────────────────────────────────────────────────────────────────
describe('SX org_user sx_taiyuan1 — active 闸运行时', () => {
  it('login(sx_taiyuan1) 得到 403 Account disabled', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeSxUser('sx_taiyuan1', 'org_user', '太原一部'),
    );

    await expect(authService.login('sx_taiyuan1', 'wrong-password')).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).message).toBe('Account disabled');
      return true;
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 反向对照：SC 活跃账号 leshan 通过 active 闸（403 由 active:false 触发，不是普遍拒绝）
// ─────────────────────────────────────────────────────────────────────────────
describe('反向对照 — SC 活跃账号 active 闸放行', () => {
  it('login(leshan) 不得是 403，active 闸放行后遇密码不匹配得 401', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeActiveScUser());

    let caughtError: unknown;
    try {
      await authService.login('leshan', 'wrong-password');
    } catch (err) {
      caughtError = err;
    }

    // 断言：不是 403（active 闸没有触发）
    if (caughtError instanceof AppError) {
      expect(caughtError.statusCode).not.toBe(403);
      // 应该是 401（密码错误）
      expect(caughtError.statusCode).toBe(401);
    } else {
      // 如果没有抛出，说明登录成功（不可能，tombstone 密码），也不是 403
      expect(caughtError).toBeUndefined();
    }
  });

  it('证明 403 确由 active:false 触发：active:true 账号 active 闸状态码 !== 403', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeActiveScUser());

    const error = await authService.login('leshan', 'wrong-password').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).not.toBe(403); // active 闸未触发
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 批量验证：PRESET_USERS 中全部 SX 账号（active:false）都在模拟路径中得到 403
// ─────────────────────────────────────────────────────────────────────────────
describe('批量 SX 账号 — active 闸全覆盖', () => {
  // 从 PRESET_USERS 动态取所有 SX 账号（branchCode=SX）
  const sxUsernames = Object.values(PRESET_USERS)
    .filter((u) => u.branchCode === 'SX')
    .map((u) => u.username);

  it('SX 账号数量应为 22（sxAdmin + yangjie0621 + 6 车险部个人 + 13 活跃 org_user + 1 退役墓碑）', () => {
    // 2026-07-15 经代/车商/重客 拆分（BACKLOG e04971）：+3 新 org_user，sx_jdcszk 转 active:false 墓碑保留
    expect(sxUsernames).toHaveLength(22);
  });

  for (const username of sxUsernames) {
    it(`login(${username}) → 403 Account disabled`, async () => {
      const preset = PRESET_USERS[username];
      const user: AccessUser = {
        id: `test-id-${username}`,
        username,
        displayName: preset.displayName,
        passwordHash: preset.passwordHash,
        role: preset.role,
        branchCode: 'SX',
        organization: preset.organization,
        allowedRoutes: preset.allowedRoutes,
        defaultRoute: preset.defaultRoute,
        allowedIps: undefined,
        specialFeatures: preset.specialFeatures,
        active: false,
      };
      mockGetUserByUsername.mockResolvedValueOnce(user);

      await expect(authService.login(username, 'any-password')).rejects.toSatisfy((err) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(403);
        expect((err as AppError).message).toBe('Account disabled');
        return true;
      });
    });
  }
});
