/**
 * 统一初始密码首登强制改密 — 机制单测（2026-07-11）
 *
 * 锁定三条核心语义：
 *   1. 生效哈希优先级：自设密码（password_changed_at 非空）> USER_PASSWORDS 初始密码 > store 占位
 *   2. pwc 声明：preset mustChangePassword && 未自设密码 → login 返回 mustChangePassword
 *      且 token 带 pwc；自设密码后二者消失
 *   3. changePassword：验旧密（401 计爆破）→ 强度校验（400）→ 写库（新哈希可验证）
 *
 * 测试层级：单元测试（mock access-control.js，不需要 DuckDB）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { AccessUser } from '../access-control.js';

// 初始密码（模拟 USER_PASSWORDS 注入）与用户自设新密码。cost=4 只为测试提速，语义与生产 cost=10 一致。
const INITIAL_PASSWORD = 'Init2026pw';
const INITIAL_HASH = bcrypt.hashSync(INITIAL_PASSWORD, 4);
const SELF_SET_PASSWORD = 'MyOwn2026pw';
const SELF_SET_HASH = bcrypt.hashSync(SELF_SET_PASSWORD, 4);

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
    // liangchunfan 是 preset mustChangePassword 账号；统一初始密码经 env 注入
    USER_PASSWORDS: JSON.stringify({ liangchunfan: bcrypt.hashSync('Init2026pw', 4) }),
    USER_ALLOWED_IPS: undefined,
    DEV_SKIP_AUTH: undefined,
  },
}));

const mockGetUserByUsername = vi.fn(async (_username: string): Promise<AccessUser | null> => null);
const mockEnsurePresetUser = vi.fn(async (_username: string): Promise<AccessUser | null> => null);
const mockSetUserPasswordByUsername = vi.fn(
  async (_username: string, _hash: string): Promise<AccessUser | null> => null
);

vi.mock('../access-control.js', () => ({
  getUserByUsername: (u: string) => mockGetUserByUsername(u),
  ensurePresetUser: (u: string) => mockEnsurePresetUser(u),
  setUserPasswordByUsername: (u: string, h: string) => mockSetUserPasswordByUsername(u, h),
}));

import { authService } from '../auth.js';
import { AppError } from '../../middleware/error.js';
import { PRESET_USERS } from '../../config/preset-users.js';

/** 构造 liangchunfan 的 store 镜像：默认未自设密码（tombstone 占位 + password_changed_at 空） */
function makeLiangchunfan(overrides: Partial<AccessUser> = {}): AccessUser {
  const preset = PRESET_USERS['liangchunfan'];
  return {
    id: 'test-id-liangchunfan',
    username: 'liangchunfan',
    displayName: preset.displayName,
    passwordHash: preset.passwordHash, // tombstone 占位
    role: preset.role,
    branchCode: 'SX',
    organization: undefined,
    allowedRoutes: undefined,
    defaultRoute: undefined,
    allowedIps: undefined,
    specialFeatures: undefined,
    active: true,
    passwordChangedAt: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  mockGetUserByUsername.mockReset();
  mockEnsurePresetUser.mockReset();
  mockSetUserPasswordByUsername.mockReset();
});

describe('前置：6 个车险部账号的 preset 配置', () => {
  it('6 人均 mustChangePassword:true / branch_admin / SX / active:true / tombstone 占位', () => {
    const six = ['liangchunfan', 'changlixia', 'yaoqian', 'lvzhenran', 'gonghuixin', 'houyabing'];
    for (const username of six) {
      const preset = PRESET_USERS[username];
      expect(preset, username).toBeDefined();
      expect(preset.mustChangePassword).toBe(true);
      expect(preset.role).toBe('branch_admin');
      expect(preset.branchCode).toBe('SX');
      expect(preset.active).toBe(true);
      expect(preset.passwordHash).toMatch(/Tombstone/i);
      expect(preset.passwordHash).toHaveLength(60);
    }
  });

  it('存量账号（如 yangjie0621）不带 mustChangePassword 标记 — 行为零变化', () => {
    expect(PRESET_USERS['yangjie0621'].mustChangePassword).toBeUndefined();
    expect(PRESET_USERS['sxAdmin'].mustChangePassword).toBeUndefined();
  });
});

describe('初始密码登录 → 强制改密标记与 pwc 声明', () => {
  it('用统一初始密码登录成功，user.mustChangePassword=true 且 token 携带 pwc', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeLiangchunfan());

    const result = await authService.login('liangchunfan', INITIAL_PASSWORD);
    expect(result.user.mustChangePassword).toBe(true);

    const decoded = jwt.verify(result.token, 'test-secret') as Record<string, unknown>;
    expect(decoded.pwc).toBe(true);
  });

  it('自设密码后：store 哈希优先于初始密码 — 新密码可登录、标记与 pwc 消失', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeLiangchunfan({ passwordHash: SELF_SET_HASH, passwordChangedAt: '2026-07-11T00:00:00.000Z' })
    );

    const result = await authService.login('liangchunfan', SELF_SET_PASSWORD);
    expect(result.user.mustChangePassword).toBeUndefined();

    const decoded = jwt.verify(result.token, 'test-secret') as Record<string, unknown>;
    expect(decoded.pwc).toBeUndefined();
  });

  it('自设密码后：统一初始密码立即失效（401）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeLiangchunfan({ passwordHash: SELF_SET_HASH, passwordChangedAt: '2026-07-11T00:00:00.000Z' })
    );

    const error = await authService.login('liangchunfan', INITIAL_PASSWORD).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
  });

  it('无 mustChangePassword 标记的账号即使经 env 覆盖登录也不产生 pwc（对照）', async () => {
    // yangjie0621 无 preset 标记；store 同样未自设密码
    const preset = PRESET_USERS['yangjie0621'];
    mockGetUserByUsername.mockResolvedValueOnce({
      id: 'test-id-yangjie',
      username: 'yangjie0621',
      displayName: preset.displayName,
      passwordHash: INITIAL_HASH, // 模拟 store 内有可登录哈希（等价 env 覆盖场景）
      role: preset.role,
      branchCode: 'SX',
      active: true,
    } as AccessUser);

    const result = await authService.login('yangjie0621', INITIAL_PASSWORD);
    expect(result.user.mustChangePassword).toBeUndefined();
    const decoded = jwt.verify(result.token, 'test-secret') as Record<string, unknown>;
    expect(decoded.pwc).toBeUndefined();
  });
});

describe('changePassword 流程', () => {
  it('旧密码错误 → 401（供路由计入爆破锁定）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeLiangchunfan());

    const error = await authService
      .changePassword('liangchunfan', 'wrong-password', 'NewPass2026')
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
    expect(mockSetUserPasswordByUsername).not.toHaveBeenCalled();
  });

  it('新密码太弱（<8 位 / 纯数字）→ 400', async () => {
    mockGetUserByUsername.mockResolvedValue(makeLiangchunfan());

    for (const weak of ['a1b2c3', '12345678', 'abcdefgh']) {
      const error = await authService
        .changePassword('liangchunfan', INITIAL_PASSWORD, weak)
        .catch((e) => e);
      expect(error, `weak=${weak}`).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
    }
    expect(mockSetUserPasswordByUsername).not.toHaveBeenCalled();
  });

  it('新密码与旧密码相同 → 400', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeLiangchunfan());

    const error = await authService
      .changePassword('liangchunfan', INITIAL_PASSWORD, INITIAL_PASSWORD)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(400);
  });

  it('改密成功：写入的新哈希可验证新密码', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeLiangchunfan());
    mockSetUserPasswordByUsername.mockResolvedValueOnce(
      makeLiangchunfan({ passwordChangedAt: new Date().toISOString() })
    );

    await authService.changePassword('liangchunfan', INITIAL_PASSWORD, 'NewPass2026');

    expect(mockSetUserPasswordByUsername).toHaveBeenCalledTimes(1);
    const [username, newHash] = mockSetUserPasswordByUsername.mock.calls[0];
    expect(username).toBe('liangchunfan');
    expect(bcrypt.compareSync('NewPass2026', newHash)).toBe(true);
    expect(bcrypt.compareSync(INITIAL_PASSWORD, newHash)).toBe(false);
  });
});
