/**
 * 全员密码闭环 — 机制单测（2026-07-11 · 取代 #1067 统一初始密码方案）
 *
 * 锁定核心语义：
 *   1. 三级生效哈希优先级：自设密码（password_changed_at 非空）> USER_PASSWORDS > preset/store 哈希
 *   2. 「仅限自助设密」账号（SELF_SERVICE_PASSWORD_ONLY_USERS）永不吃 USER_PASSWORDS 覆盖
 *   3. pns 判定：password_changed_at 为空 且 不在豁免清单（仅 admin）→ 登录返回
 *      mustChangePassword 且 token 带 pns；admin 豁免；自设后消失
 *   4. changePassword 双模式：有可用旧凭据必须验旧密（401 计爆破）；tombstone 账号免验旧密；
 *      策略校验（400）→ 写库（新哈希可验证）
 *   5. 存量账号全链路：旧密码登录 → pns → 设密 → 旧密失效、新密生效、pns 消失
 *
 * 测试层级：单元测试（mock access-control.js，不需要 DuckDB）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { AccessUser } from '../access-control.js';

// 旧密码（模拟 USER_PASSWORDS 注入的存量凭据）与用户自设新密码。cost=4 只为测试提速。
const LEGACY_PASSWORD = 'Legacy2026pw';
const LEGACY_HASH = bcrypt.hashSync(LEGACY_PASSWORD, 4);
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
    // leshan = 存量机构账号（pns 覆盖对象）；admin = 豁免账号；
    // liangchunfan = 自助设密账号 —— 即便被误注入也必须被运行时忽略（永不进 USER_PASSWORDS 兜底）
    USER_PASSWORDS: JSON.stringify({
      leshan: bcrypt.hashSync('Legacy2026pw', 4),
      admin: bcrypt.hashSync('Legacy2026pw', 4),
      liangchunfan: bcrypt.hashSync('Legacy2026pw', 4),
    }),
    USER_ALLOWED_IPS: undefined,
    DEV_SKIP_AUTH: undefined,
  },
}));

const mockGetUserByUsername = vi.fn(async (_username: string): Promise<AccessUser | null> => null);
const mockEnsurePresetUser = vi.fn(async (_username: string): Promise<AccessUser | null> => null);
const mockSetUserPasswordByUsername = vi.fn(
  async (_username: string, _hash: string): Promise<AccessUser | null> => null
);
const credentialStateByUserId = new Map<string, 'bootstrap_required' | 'active'>();

vi.mock('../access-control.js', () => ({
  getUserByUsername: (u: string) => mockGetUserByUsername(u),
  ensurePresetUser: (u: string) => mockEnsurePresetUser(u),
  setUserPasswordByUsername: async (u: string, h: string) => {
    const result = await mockSetUserPasswordByUsername(u, h);
    if (result) credentialStateByUserId.set(result.id, 'active');
    return result;
  },
}));

vi.mock('../credential-policy.js', () => ({
  assertPasswordAllowed: async (userId: string) => {
    if (!credentialStateByUserId.has(userId)) {
      throw Object.assign(new Error('AUTH_METHOD_NOT_ALLOWED'), { statusCode: 403 });
    }
    return { userId, passwordHash: 'hash', state: credentialStateByUserId.get(userId) };
  },
  credentialSetupRequired: async (userId: string) => (
    credentialStateByUserId.get(userId) === 'bootstrap_required'
  ),
}));

import { authService } from '../auth.js';
import { AppError } from '../../middleware/error.js';
import { PRESET_USERS, SELF_SERVICE_PASSWORD_ONLY_USERS } from '../../config/preset-users.js';

/** 构造 store 镜像用户 */
function makeUser(username: string, overrides: Partial<AccessUser> = {}): AccessUser {
  const preset = PRESET_USERS[username];
  const user = {
    id: `test-id-${username}`,
    username,
    displayName: preset?.displayName ?? username,
    passwordHash: preset?.passwordHash ?? LEGACY_HASH,
    role: preset?.role ?? 'org_user',
    branchCode: preset?.branchCode,
    organization: preset?.organization,
    allowedRoutes: undefined,
    defaultRoute: undefined,
    allowedIps: undefined,
    specialFeatures: undefined,
    active: true,
    passwordChangedAt: undefined,
    ...overrides,
  };
  credentialStateByUserId.set(
    user.id,
    user.passwordChangedAt ? 'active' : 'bootstrap_required'
  );
  return user;
}

beforeEach(() => {
  mockGetUserByUsername.mockReset();
  mockEnsurePresetUser.mockReset();
  mockSetUserPasswordByUsername.mockReset();
  credentialStateByUserId.clear();
});

describe('前置：preset 配置（6 个自助设密账号 + test_org_user 停用）', () => {
  it('自助设密名单 = 6 个车险部账号，均 branch_admin / SX / active:true / tombstone 占位', () => {
    expect([...SELF_SERVICE_PASSWORD_ONLY_USERS].sort()).toEqual(
      ['changlixia', 'gonghuixin', 'houyabing', 'liangchunfan', 'lvzhenran', 'yaoqian'].sort()
    );
    for (const username of SELF_SERVICE_PASSWORD_ONLY_USERS) {
      const preset = PRESET_USERS[username];
      expect(preset, username).toBeDefined();
      expect(preset.role).toBe('branch_admin');
      expect(preset.branchCode).toBe('SX');
      expect(preset.active).toBe(true);
      expect(preset.passwordHash).toMatch(/Tombstone/i);
      expect(preset.passwordHash).toHaveLength(60);
    }
  });

  it('test_org_user 已停用（active:false，不参与密码迁移）', () => {
    expect(PRESET_USERS['test_org_user'].active).toBe(false);
  });
});

describe('三级生效哈希优先级链（单测锁死）', () => {
  it('第 1 级：自设密码（password_changed_at 非空）优先于 USER_PASSWORDS —— 新密可登录', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeUser('leshan', { passwordHash: SELF_SET_HASH, passwordChangedAt: '2026-07-11T00:00:00.000Z' })
    );
    const result = await authService.login('leshan', SELF_SET_PASSWORD);
    expect(result.user.username).toBe('leshan');
  });

  it('第 1 级压过第 2 级：自设密码后 USER_PASSWORDS 旧密码立即失效（401）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeUser('leshan', { passwordHash: SELF_SET_HASH, passwordChangedAt: '2026-07-11T00:00:00.000Z' })
    );
    const error = await authService.login('leshan', LEGACY_PASSWORD).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
  });

  it('第 2 级：未自设时 USER_PASSWORDS 覆盖生效（store 哈希被 env 压过）', async () => {
    // store 哈希是另一个密码，但 env 注入 LEGACY_PASSWORD → env 生效
    mockGetUserByUsername.mockResolvedValueOnce(
      makeUser('leshan', { passwordHash: SELF_SET_HASH, passwordChangedAt: undefined })
    );
    const result = await authService.login('leshan', LEGACY_PASSWORD);
    expect(result.user.username).toBe('leshan');
  });

  it('第 3 级：无自设、无 env 覆盖 → 回落 store 哈希', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeUser('tianfu', { passwordHash: LEGACY_HASH })
    );
    const result = await authService.login('tianfu', LEGACY_PASSWORD);
    expect(result.user.username).toBe('tianfu');
  });

  it('自助设密账号永不吃 USER_PASSWORDS：即便 env 被误注入，凭 env 密码登录仍 401（tombstone 兜底）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser('liangchunfan'));
    const error = await authService.login('liangchunfan', LEGACY_PASSWORD).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
  });

  it('自助设密账号自设密码后可正常密码登录（store 自设哈希生效）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeUser('liangchunfan', { passwordHash: SELF_SET_HASH, passwordChangedAt: '2026-07-11T00:00:00.000Z' })
    );
    const result = await authService.login('liangchunfan', SELF_SET_PASSWORD);
    expect(result.user.username).toBe('liangchunfan');
    expect(result.user.mustChangePassword).toBeUndefined();
  });
});

describe('pns 判定与会话声明', () => {
  it('存量账号旧密码登录成功 → mustChangePassword=true 且 token 带 pns（旧密码降级为一次性激活凭据）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser('leshan'));
    const result = await authService.login('leshan', LEGACY_PASSWORD);
    expect(result.user.mustChangePassword).toBe(true);
    const decoded = jwt.verify(result.token, 'test-secret') as Record<string, unknown>;
    expect(decoded.pns).toBe(true);
  });

  it('admin 豁免：password_changed_at 为空也不带 pns（USER_PASSWORDS 强密码 + PAT 应急通道保留）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser('admin', { passwordHash: LEGACY_HASH }));
    const result = await authService.login('admin', LEGACY_PASSWORD);
    expect(result.user.mustChangePassword).toBeUndefined();
    const decoded = jwt.verify(result.token, 'test-secret') as Record<string, unknown>;
    expect(decoded.pns).toBeUndefined();
  });

  it('自设密码后：pns 与 mustChangePassword 消失', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(
      makeUser('leshan', { passwordHash: SELF_SET_HASH, passwordChangedAt: '2026-07-11T00:00:00.000Z' })
    );
    const result = await authService.login('leshan', SELF_SET_PASSWORD);
    expect(result.user.mustChangePassword).toBeUndefined();
    const decoded = jwt.verify(result.token, 'test-secret') as Record<string, unknown>;
    expect(decoded.pns).toBeUndefined();
  });

  it('issueCookieSession：mustChangePassword → cookie access token 带 pns（飞书链路共用出口）', () => {
    const session = authService.issueCookieSession({
      username: 'liangchunfan',
      displayName: '山西管理员（梁春帆）',
      role: 'branch_admin',
      branchCode: 'SX',
      mustChangePassword: true,
    });
    const decoded = jwt.verify(session.accessToken, 'test-secret') as Record<string, unknown>;
    expect(decoded.pns).toBe(true);
  });

  it('refresh 透传 pns：刷新一次 token 不能洗白强制设密', () => {
    const session = authService.issueCookieSession({
      username: 'leshan',
      displayName: '乐山机构',
      role: 'org_user',
      mustChangePassword: true,
    });
    const next = authService.refreshCookieSession(session.refreshToken);
    const decoded = jwt.verify(next.accessToken, 'test-secret') as Record<string, unknown>;
    expect(decoded.pns).toBe(true);
  });

  it('飞书会话及 refresh 保留稳定 sub、amr 与 identityId，且不带 pns', () => {
    const session = authService.issueCookieSession({
      username: 'zhangwei_abc123', displayName: '张伟', role: 'org_user', organization: '运城', branchCode: 'SX',
      subjectUserId: 'user-uuid', authMethod: 'feishu', identityId: 'identity-uuid',
    });
    const first = jwt.verify(session.accessToken, 'test-secret') as Record<string, unknown>;
    expect(first).toMatchObject({ sub: 'user-uuid', userId: 'user-uuid', amr: ['feishu'], identityId: 'identity-uuid' });
    expect(first.pns).toBeUndefined();
    const next = authService.refreshCookieSession(session.refreshToken);
    const refreshed = jwt.verify(next.accessToken, 'test-secret') as Record<string, unknown>;
    expect(refreshed).toMatchObject({ sub: 'user-uuid', userId: 'user-uuid', amr: ['feishu'], identityId: 'identity-uuid' });
    expect(refreshed.pns).toBeUndefined();
  });

  it('isPasswordNotSetForUsername：store 命中未设密账号 → true；store/preset 双缺 → false', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser('leshan'));
    await expect(authService.isPasswordNotSetForUsername('leshan')).resolves.toBe(true);

    mockGetUserByUsername.mockResolvedValueOnce(null);
    // 纯飞书裸 ID 身份（非 preset）→ 无账号实体，不强制设密
    await expect(authService.isPasswordNotSetForUsername('ou_feishu_raw_id')).resolves.toBe(false);
  });
});

/**
 * 设密页死锁回归锁（2026-07-14 · 杨杰飞书扫码首登事故）
 *
 * 事故：/me 用 PasswordCredential.state === 'active' 算 hasPassword，changePassword 用
 * hasUsablePassword 决定是否验旧密。两者对「USER_PASSWORDS 覆盖但未自设」的账号判定相反
 * （前者 false、后者 true）→ 前端藏掉「当前密码」框、不发 oldPassword → 后端 401
 * 「当前密码不正确」→ 账号被永久锁死在设密页，无法自救。
 *
 * 不变量：/me 回传的 hasPassword 必须恒等于 changePassword 的验旧密闸口径。
 */
describe('设密页 hasPassword 与验旧密闸同源（死锁回归锁）', () => {
  it('存量账号（USER_PASSWORDS 覆盖 + 未自设）：pns=true 且 hasPassword=true —— 必须给用户「当前密码」输入框', async () => {
    mockGetUserByUsername.mockResolvedValue(makeUser('leshan'));
    // 被强制设密
    await expect(authService.isPasswordNotSetForUsername('leshan')).resolves.toBe(true);
    // 且 /me 必须承认「有旧密可验」，否则前端不发 oldPassword → 死锁
    await expect(authService.hasUsablePasswordForUsername('leshan')).resolves.toBe(true);
  });

  it('自助设密账号（tombstone、无 env 覆盖）：pns=true 且 hasPassword=false —— 首次设密免验旧密', async () => {
    mockGetUserByUsername.mockResolvedValue(makeUser('liangchunfan'));
    await expect(authService.isPasswordNotSetForUsername('liangchunfan')).resolves.toBe(true);
    await expect(authService.hasUsablePasswordForUsername('liangchunfan')).resolves.toBe(false);
  });

  it('口径同源：hasUsablePasswordForUsername ≡ changePassword 是否验旧密（逐账号对拍）', async () => {
    for (const username of ['leshan', 'liangchunfan', 'tianfu']) {
      const user = makeUser(username);
      mockGetUserByUsername.mockResolvedValue(user);
      mockSetUserPasswordByUsername.mockResolvedValue(user);

      const hasPassword = await authService.hasUsablePasswordForUsername(username);
      // 前端严格按 hasPassword 决定发不发 oldPassword
      const error = await authService
        .changePassword(username, hasPassword ? LEGACY_PASSWORD : undefined, 'BrandNew#2026')
        .catch((e) => e);
      // 同源 ⇒ 按 hasPassword 提交必然不会撞「当前密码不正确」
      expect(error, `${username} 设密被拒`).not.toBeInstanceOf(AppError);
    }
  });

  it('store 无该账号（纯飞书裸 ID 身份）→ hasPassword=false，不索要旧密', async () => {
    mockGetUserByUsername.mockResolvedValue(null);
    await expect(authService.hasUsablePasswordForUsername('ou_feishu_raw_id')).resolves.toBe(false);
  });
});

describe('changePassword 双模式', () => {
  it('飞书-only 账号拒绝密码登录与改密', async () => {
    const user = makeUser('feishu-only');
    credentialStateByUserId.delete(user.id);
    mockGetUserByUsername.mockResolvedValue(user);
    await expect(authService.login(user.username, 'anything')).rejects.toMatchObject({ statusCode: 403 });
    await expect(authService.changePassword(user.username, undefined, 'BrandNew#2026'))
      .rejects.toMatchObject({ statusCode: 403 });
  });
  it('存量账号：旧密码错误 → 401（供路由计入爆破锁定），不写库', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser('leshan'));
    const error = await authService
      .changePassword('leshan', 'wrong-password', 'NewPass#2026')
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
    expect(mockSetUserPasswordByUsername).not.toHaveBeenCalled();
  });

  it('存量账号：缺 oldPassword → 401（有可用旧凭据必须验旧密，不给绕过口）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser('leshan'));
    const error = await authService
      .changePassword('leshan', undefined, 'NewPass#2026')
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
  });

  it('tombstone 账号（无任何可用凭据）：免验旧密可直接设密（飞书首登自设链路）', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser('liangchunfan'));
    mockSetUserPasswordByUsername.mockResolvedValueOnce(
      makeUser('liangchunfan', { passwordChangedAt: new Date().toISOString() })
    );
    await authService.changePassword('liangchunfan', undefined, 'NewPass#2026');
    expect(mockSetUserPasswordByUsername).toHaveBeenCalledTimes(1);
    const [username, newHash] = mockSetUserPasswordByUsername.mock.calls[0];
    expect(username).toBe('liangchunfan');
    expect(bcrypt.compareSync('NewPass#2026', newHash)).toBe(true);
  });

  it('弱密码拒绝矩阵 → 400 且不写库', async () => {
    mockGetUserByUsername.mockResolvedValue(makeUser('leshan'));
    const weakCases = [
      'a1b2c3',          // 长度不足
      '12345678',        // 单类字符（纯数字）+ 常见弱密
      'abcdefgh',        // 单类字符（纯小写）
      'Chexian@2026',    // 历史统一初始密码（chexian 字样黑名单）
      'chexian123',      // chexian 变体
      'CHEXIAN2026',     // chexian 大写变体
      'leshan2026',      // 含用户名
      'LeShan#999',      // 含用户名大小写变体
      'password1',       // 常见弱密 top 表
    ];
    for (const weak of weakCases) {
      const error = await authService
        .changePassword('leshan', LEGACY_PASSWORD, weak)
        .catch((e) => e);
      expect(error, `weak=${weak}`).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode, `weak=${weak}`).toBe(400);
    }
    expect(mockSetUserPasswordByUsername).not.toHaveBeenCalled();
  });

  it('新密码与旧密码相同 → 400', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser('leshan'));
    const error = await authService
      .changePassword('leshan', LEGACY_PASSWORD, LEGACY_PASSWORD)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(400);
  });

  it('改密成功：写入的新哈希可验证新密码、否定旧密码', async () => {
    mockGetUserByUsername.mockResolvedValueOnce(makeUser('leshan'));
    mockSetUserPasswordByUsername.mockResolvedValueOnce(
      makeUser('leshan', { passwordChangedAt: new Date().toISOString() })
    );
    await authService.changePassword('leshan', LEGACY_PASSWORD, 'NewPass#2026');
    expect(mockSetUserPasswordByUsername).toHaveBeenCalledTimes(1);
    const [username, newHash] = mockSetUserPasswordByUsername.mock.calls[0];
    expect(username).toBe('leshan');
    expect(bcrypt.compareSync('NewPass#2026', newHash)).toBe(true);
    expect(bcrypt.compareSync(LEGACY_PASSWORD, newHash)).toBe(false);
  });
});

describe('存量账号全链路：旧密码登录 → pns → 设密 → 重登', () => {
  it('登录（pns）→ 设密 → 旧密失效、新密生效且不再 pns', async () => {
    // 用有状态 mock 模拟 store：设密后 passwordChangedAt/哈希都更新
    let storeUser = makeUser('leshan');
    mockGetUserByUsername.mockImplementation(async () => storeUser);
    mockSetUserPasswordByUsername.mockImplementation(async (_u: string, h: string) => {
      storeUser = { ...storeUser, passwordHash: h, passwordChangedAt: new Date().toISOString() };
      return storeUser;
    });

    // 1. 旧密码（USER_PASSWORDS）登录成功，被标记 pns
    const first = await authService.login('leshan', LEGACY_PASSWORD);
    expect(first.user.mustChangePassword).toBe(true);

    // 2. 强制设密
    await authService.changePassword('leshan', LEGACY_PASSWORD, 'BrandNew#2026');

    // 3. 旧密码失效
    const relogingOld = await authService.login('leshan', LEGACY_PASSWORD).catch((e) => e);
    expect(relogingOld).toBeInstanceOf(AppError);
    expect((relogingOld as AppError).statusCode).toBe(401);

    // 4. 新密码生效且 pns 消失
    const second = await authService.login('leshan', 'BrandNew#2026');
    expect(second.user.mustChangePassword).toBeUndefined();
    const decoded = jwt.verify(second.token, 'test-secret') as Record<string, unknown>;
    expect(decoded.pns).toBeUndefined();
  });
});
