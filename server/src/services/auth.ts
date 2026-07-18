/**
 * 认证服务
 * Authentication Service
 *
 * 处理用户登录、JWT生成和密码验证
 */

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { authConfig } from '../config/auth.js';
import { authEnv } from '../config/env.js';
import { PRESET_USERS, getPresetVisibleBranches, getDeniedModules, SELF_SERVICE_PASSWORD_ONLY_USERS, resolveAllowedRoutes } from '../config/preset-users.js';
import { validatePasswordPolicy } from '../config/password-policy.js';
import { AppError } from '../middleware/error.js';
import { JwtPayload } from '../middleware/auth.js';
import { canonicalizeUsername, ensurePresetUser, getUserByUsername, setUserPasswordByUsername } from './access-control.js';
import type { AccessUser } from './access-control.js';
import { assertPasswordAllowed, credentialSetupRequired } from './credential-policy.js';
import { isIpAllowed as isIpAllowedShared } from '../utils/ip.js';

/**
 * 用户凭证（从前端复用）
 */
export interface UserCredential {
  username: string;
  passwordHash: string;
  displayName: string;
  role: string;
  organization?: string;
  /** 分公司编码（'SC' / 'SX'）。undefined → 系统级超管 */
  branchCode?: string;
  /** 全国超管可见省集合（按 username 从 PRESET_USERS 派生，供前端显示切省下拉）。普通用户 undefined */
  visibleBranches?: string[];
  /** 模块负面清单（按 username 从 RESTRICTED_MODULES 派生）：该用户不可访问的前端页面路径 */
  deniedModules?: string[];
  allowedIps?: string[];
  allowedRoutes?: string[];
  defaultRoute?: string;
  specialFeatures?: string[];
  active?: boolean;
  /**
   * pns（password-not-set）：该账号尚未自设专属密码（password_changed_at 为空且不在豁免清单），
   * 本次会话须先设密才能访问业务路由。密码登录与飞书扫码两条链路都会置位；
   * authMiddleware 按 JWT/Cookie 会话的 pns 声明拦截，设密成功后重发无 pns 会话解锁。
   */
  mustChangePassword?: boolean;
  /** 飞书部门个人账号需要按稳定身份自动开户。 */
  authProvisioning?: 'personal_feishu';
  subjectUserId?: string;
  authMethod?: 'password' | 'feishu';
  identityId?: string;
}

/**
 * pns 豁免清单：password_changed_at 恒空但不强制设密的账号。
 * 仅 admin —— 保留 USER_PASSWORDS 强密码 + PAT 作应急破窗通道（用户拍板，2026-07-11）。
 */
const PNS_EXEMPT_USERNAMES: ReadonlySet<string> = new Set(['admin']);

/** 「仅限自助设密」账号（永不吃 USER_PASSWORDS 覆盖），名单见 preset-users.ts */
const SELF_SERVICE_ONLY_SET: ReadonlySet<string> = new Set(SELF_SERVICE_PASSWORD_ONLY_USERS);

/**
 * 构造式 tombstone 占位哈希判定（含 "Tombstone" 可辨标记，bcrypt.compare 对任意明文恒 false）。
 * 与 preset-users.ts SX 段先例同一约定；用于区分「无任何可用密码凭据」的账号（设密免验旧密）。
 */
function isTombstoneHash(hash: string): boolean {
  return /tombstone/i.test(hash);
}

/**
 * 「哑」bcrypt 哈希（安全审查 M6）：未知用户名登录时，用它跑一次真实 bcrypt.compare，
 * 拉平「用户不存在」与「用户存在但密码错误」两条路径的响应耗时——否则未知用户提前 401 早退，
 * 跳过昂贵的 bcrypt 运算，与已存在账号的响应产生可观测的计时侧信道，能被用来枚举用户名。
 *
 * 模块加载时运行时生成（而非源码固定字面量，2026-07-18 返工）：
 * ① 格式合法（真实 bcrypt 哈希），保证 compare 全程执行等耗时运算，不会因格式非法提前抛错；
 * ② 明文是进程启动时的 32 字节随机数，无人知晓，比固定字面量更不可能被撞中，
 *    对任意登录输入恒 false，不对应任何真实账号；
 * ③ 源码零哈希字面量，从根上消除 GitGuardian 等扫描器的凭据形状误报
 *    （参 pr-evolution.md 2026-07-15 PR #1115 先例的预防规则：不把凭据形状字面量写进源码）。
 * cost factor 取 authConfig.bcryptSaltRounds（与真实用户哈希同源同值），保证计时拉平不因
 * cost 不一致失效；模块级常量只在进程启动生成一次，每次登录零额外开销。
 */
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(
  randomBytes(32).toString('hex'),
  authConfig.bcryptSaltRounds,
);

/**
 * 从环境变量加载用户密码覆盖
 * 环境变量 USER_PASSWORDS 格式（JSON）：
 * {"admin":"$2b$10$...","leshan":"$2b$10$..."}
 */
function loadPasswordOverrides(): Record<string, string> {
  const raw = authEnv.USER_PASSWORDS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const overrides = parsed as Record<string, string>;
    const usernames = Object.keys(overrides);
    if (usernames.length > 0) {
      console.log(`[Auth] USER_PASSWORDS loaded: ${usernames.length} users overridden (${usernames.join(',')})`);
    }
    return overrides;
  } catch {
    console.warn('[Auth] USER_PASSWORDS 格式无效，使用默认配置');
    return {};
  }
}

const PASSWORD_OVERRIDES = loadPasswordOverrides();
const ALLOWED_IP_OVERRIDES = loadAllowedIpOverrides();

function loadAllowedIpOverrides(): Record<string, string[]> {
  const raw = authEnv.USER_ALLOWED_IPS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        result[key] = value.map(item => String(item));
      } else if (typeof value === 'string') {
        result[key] = [value];
      }
    }
    return result;
  } catch {
    console.warn('[Auth] USER_ALLOWED_IPS 格式无效，忽略 IP 白名单覆盖');
    return {};
  }
}

const PRESET_USER_KEYS = new Set(Object.keys(PRESET_USERS));

/**
 * 认证服务类
 */
class AuthService {
  private refreshTokenStore = new Map<string, { userId: string; expiresAt: number }>();

  private normalizeUsername(input: string): string {
    // 复用 access-control 的唯一 canonical 口径（NFKC+trim+lowercase），杜绝登录与写入/查询边界口径漂移。
    return canonicalizeUsername(input);
  }

  private normalizePassword(input: string): string {
    return input.normalize('NFKC').trim();
  }

  /**
   * 用户登录
   * @param username 用户名
   * @param password 密码（明文）
   * @returns JWT Token和用户信息
   */
  async login(
    username: string,
    password: string,
    clientIp?: string
  ): Promise<{ token: string; user: Omit<UserCredential, 'passwordHash'> }> {
    // 对输入做最小标准化，减少浏览器自动填充/输入法导致的误判
    const normalizedUsername = this.normalizeUsername(username);
    const normalizedPassword = this.normalizePassword(password);

    // 1. 查找用户，并应用环境变量密码覆盖
    let user = await getUserByUsername(normalizedUsername);
    if (!user && PRESET_USER_KEYS.has(normalizedUsername)) {
      user = await ensurePresetUser(normalizedUsername);
    }
    if (!user) {
      // 未知用户名：跑一次哑 bcrypt 比对拉平时序（安全审查 M6，防用户名枚举计时侧信道），
      // 再抛出与「密码错误」完全相同的 401，不因提前早退产生可观测的响应耗时差异。
      await this.verifyPassword(normalizedPassword, DUMMY_BCRYPT_HASH);
      throw new AppError(401, 'Invalid username or password');
    }
    const allowedIpsOverride = ALLOWED_IP_OVERRIDES[normalizedUsername];
    const userCredential: UserCredential = {
      ...user,
      passwordHash: this.resolveEffectiveHash(normalizedUsername, user),
      allowedIps: allowedIpsOverride ?? user.allowedIps,
      // 全国超管可见省集合按 username 从 PRESET_USERS 派生（单一事实源），随登录响应回前端显示切省下拉。
      visibleBranches: getPresetVisibleBranches(normalizedUsername),
      // 模块负面清单按 username 派生（单一事实源 RESTRICTED_MODULES），随登录响应回前端驱动导航隐藏。
      deniedModules: getDeniedModules(normalizedUsername),
      // pns：尚未自设专属密码（且不豁免）→ 本次会话强制设密。
      // 存量账号旧密码（USER_PASSWORDS/preset 哈希）由此降级为一次性激活凭据：登录成功即被拦去设密。
      mustChangePassword: (
        !PNS_EXEMPT_USERNAMES.has(normalizedUsername)
        && await credentialSetupRequired(user.id)
      ) || undefined,
    };

    // 2. 验证密码 —— 必须先于 active / IP 检查执行（安全审查 M6 计时侧信道修复）：
    // 无论账号是否禁用、IP 是否被拒，均先跑一次针对该账号真实哈希的 bcrypt 比对，
    // 避免「禁用账号/IP 拒绝」提前早退跳过 bcrypt，与「密码错误」路径产生可探测的耗时差异
    // （否则攻击者可用响应时间反推账号是否存在/是否被禁用）。
    // 服务层内部错误契约保持不变（403 Account disabled / 403 IP not allowed），
    // 供审计日志记录真实原因；对外响应统一化在路由层完成（server/src/routes/auth.ts）。
    const isPasswordValid = await this.verifyPassword(normalizedPassword, userCredential.passwordHash);

    if (!user.active) {
      throw new AppError(403, 'Account disabled');
    }

    // 无密码凭据账号（如飞书专属个人账号）尝试密码登录 —— 检查同样必须在 bcrypt 比对之后
    // （M6 残余面收口，2026-07-18）：此前 assertPasswordAllowed 在 bcrypt 之前执行，
    // 无凭据账号提前 403 早退跳过 bcrypt，与「密码错误」路径产生可探测的耗时差异；
    // 这类账号的 store 哈希是构造式 tombstone（合法 bcrypt 格式，compare 恒 false 且全程
    // 等耗时），故先比对再检查不引入新的快速路径。服务层错误契约不变
    // （403 AUTH_METHOD_NOT_ALLOWED，credential-policy.ts 共享基础设施原样复用），
    // 对外统一化在路由层完成（routes/auth.ts loginHandler → 401 通用文案 + 独立审计事件）。
    await assertPasswordAllowed(user.id);

    if (!this.isIpAllowed(clientIp, userCredential.allowedIps)) {
      throw new AppError(403, 'IP not allowed');
    }

    if (!isPasswordValid) {
      throw new AppError(401, 'Invalid username or password');
    }

    // 3. 生成JWT Token
    const payload: JwtPayload = {
      userId: normalizedUsername, // 简化处理，使用username作为userId
      username: userCredential.username,
      role: userCredential.role,
      organization: userCredential.organization,
      branchCode: userCredential.branchCode,
      // pns（password-not-set）声明：未自设密码的会话进 token，authMiddleware 据此拦业务路由
      ...(userCredential.mustChangePassword ? { pns: true } : {}),
    };

    const token = jwt.sign(
      payload as object,
      authConfig.jwtSecret,
      { expiresIn: authConfig.jwtExpiresIn } as SignOptions
    );

    // 4. 返回Token和用户信息（不包含密码）
    const { passwordHash, ...userInfo } = userCredential;
    // allowedRoutes 为空/未定义时按角色回填，避免前端回退到本地兜底清单（前后端口径漂移根因）。
    userInfo.allowedRoutes = resolveAllowedRoutes(userCredential.role, userCredential.allowedRoutes);
    return {
      token,
      user: userInfo,
    };
  }

  /**
   * 解析账号当前生效的密码哈希（三级优先级链，单测锁死）：
   *   1. 用户运行时自设密码（password_changed_at 非空的 store 哈希）
   *   2. USER_PASSWORDS 环境变量覆盖（运维注入的旧密码/应急凭据）
   *   3. store/preset 哈希（tombstone 占位则恒不可登录）
   * 「仅限自助设密」账号（SELF_SERVICE_PASSWORD_ONLY_USERS）跳过第 2 级：
   * 即便 USER_PASSWORDS 被误注入也不生效（governance 静态闸 + 此处运行时兜底双保险）。
   */
  private resolveEffectiveHash(normalizedUsername: string, user: AccessUser): string {
    if (user.passwordChangedAt) {
      return user.passwordHash;
    }
    if (SELF_SERVICE_ONLY_SET.has(normalizedUsername)) {
      return user.passwordHash;
    }
    return PASSWORD_OVERRIDES[normalizedUsername] ?? user.passwordHash;
  }

  /**
   * 按用户名做 pns 判定（飞书扫码 callback 用）。
   * store 无该账号时尝试物化 preset；两者皆无（如纯飞书裸 ID 身份）→ 非 pns
   * （没有可设密的账号实体，强制设密无意义）。
   */
  async isPasswordNotSetForUsername(username: string): Promise<boolean> {
    const normalizedUsername = this.normalizeUsername(username);
    let user = await getUserByUsername(normalizedUsername);
    if (!user && PRESET_USER_KEYS.has(normalizedUsername)) {
      user = await ensurePresetUser(normalizedUsername);
    }
    if (!user) return false;
    if (PNS_EXEMPT_USERNAMES.has(normalizedUsername)) return false;
    return credentialSetupRequired(user.id);
  }

  /**
   * 账号当前是否存在可验证的密码凭据（决定设密时是否必须验旧密）：
   *   - 已自设（password_changed_at 非空）→ 有
   *   - USER_PASSWORDS 有效覆盖（非自助设密账号）→ 有（旧密码即一次性激活凭据）
   *   - 其余看 store 哈希是否构造式 tombstone：tombstone → 无（首次设密免验旧密）
   */
  hasUsablePassword(normalizedUsername: string, user: AccessUser): boolean {
    if (user.passwordChangedAt) return true;
    if (!SELF_SERVICE_ONLY_SET.has(normalizedUsername) && PASSWORD_OVERRIDES[normalizedUsername]) {
      return true;
    }
    return !isTombstoneHash(user.passwordHash);
  }

  /**
   * 按用户名判定账号是否存在可验证的密码凭据（/me 回传 hasPassword 用）。
   *
   * 必须与 changePassword 的验旧密闸同源（都走 hasUsablePassword）：前端按 hasPassword
   * 决定是否显示「当前密码」输入框并回传 oldPassword，后端按同一口径决定是否验旧密。
   * 两处口径一旦漂移，用户会被永久锁死在设密页——PasswordCredential.state 只反映
   * 「是否已自设」（= password_changed_at 非空），不含 USER_PASSWORDS 覆盖与非 tombstone
   * store 哈希这两种「有旧密可验」的情形，故不能拿来当 hasPassword。
   */
  async hasUsablePasswordForUsername(username: string): Promise<boolean> {
    const normalizedUsername = this.normalizeUsername(username);
    let user = await getUserByUsername(normalizedUsername);
    if (!user && PRESET_USER_KEYS.has(normalizedUsername)) {
      user = await ensurePresetUser(normalizedUsername);
    }
    if (!user) return false;
    return this.hasUsablePassword(normalizedUsername, user);
  }

  /**
   * 新密码强度校验（返回违规原因，null = 通过）。
   * 口径收口于 config/password-policy.ts（change-password 与 activate 共用）。
   */
  validateNewPassword(password: string, username?: string): string | null {
    return validatePasswordPolicy(password, { username });
  }

  /**
   * 用户本人设密/改密（全员密码闭环链路）。
   *   - 账号已有可用密码凭据 → 必须验旧密（旧密码即一次性激活凭据）；
   *   - 无任何可用凭据（tombstone 且未注入 env，如飞书首登的自助设密账号）→ 免验旧密，
   *     会话本身（飞书扫码/激活令牌）就是身份凭据；
   *   - 强度校验 → 写库置 password_changed_at（此后 store 自设哈希优先，旧密码即刻失效）。
   */
  async changePassword(
    username: string,
    oldPassword: string | undefined,
    newPassword: string
  ): Promise<void> {
    const normalizedUsername = this.normalizeUsername(username);
    const normalizedNew = this.normalizePassword(newPassword);

    const user = await getUserByUsername(normalizedUsername);
    if (!user || !user.active) {
      throw new AppError(401, 'Invalid username or password');
    }
    await assertPasswordAllowed(user.id);

    let normalizedOld: string | undefined;
    if (this.hasUsablePassword(normalizedUsername, user)) {
      normalizedOld = this.normalizePassword(oldPassword ?? '');
      if (!normalizedOld) {
        throw new AppError(401, '当前密码不正确');
      }
      const effectiveHash = this.resolveEffectiveHash(normalizedUsername, user);
      const isOldValid = await this.verifyPassword(normalizedOld, effectiveHash);
      if (!isOldValid) {
        throw new AppError(401, '当前密码不正确');
      }
    }

    const policyViolation = this.validateNewPassword(normalizedNew, normalizedUsername);
    if (policyViolation) {
      throw new AppError(400, policyViolation);
    }
    if (normalizedOld && normalizedNew === normalizedOld) {
      throw new AppError(400, '新密码不能与当前密码相同');
    }

    const newHash = await this.hashPassword(normalizedNew);
    await setUserPasswordByUsername(normalizedUsername, newHash);
  }

  private signAccessToken(payload: JwtPayload): string {
    return jwt.sign(
      payload as object,
      authConfig.jwtSecret,
      { expiresIn: authConfig.jwtExpiresIn } as SignOptions
    );
  }

  private signRefreshToken(payload: JwtPayload, sessionId: string): string {
    return jwt.sign(
      { ...payload, type: 'refresh', sid: sessionId } as object,
      authConfig.jwtSecret,
      { expiresIn: authConfig.jwtRefreshExpiresIn } as SignOptions
    );
  }

  private getExpiryTimestamp(secondsFromNow: number): number {
    return Date.now() + secondsFromNow * 1000;
  }

  private parseDurationToSeconds(duration: string | undefined, fallbackSeconds: number): number {
    if (!duration) return fallbackSeconds;
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return fallbackSeconds;
    const value = Number(match[1]);
    const unit = match[2];
    const factors: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (factors[unit] || 1);
  }

  issueCookieSession(user: Omit<UserCredential, 'passwordHash'>): {
    accessToken: string;
    refreshToken: string;
    sessionId: string;
  } {
    const payload: JwtPayload = {
      userId: user.subjectUserId ?? user.username,
      sub: user.subjectUserId ?? user.username,
      username: user.username,
      role: user.role,
      organization: user.organization,
      branchCode: user.branchCode,
      // pns 随 cookie 会话下发（密码登录与飞书扫码共用本出口）
      ...(user.mustChangePassword ? { pns: true } : {}),
      ...(user.authMethod ? { amr: [user.authMethod] } : {}),
      ...(user.identityId ? { identityId: user.identityId } : {}),
    };
    const sessionId = `sid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const refreshTtlSec = this.parseDurationToSeconds(authConfig.jwtRefreshExpiresIn, 7 * 24 * 3600);
    const refreshToken = this.signRefreshToken(payload, sessionId);
    this.refreshTokenStore.set(sessionId, {
      userId: user.username,
      expiresAt: this.getExpiryTimestamp(refreshTtlSec),
    });
    return {
      accessToken: this.signAccessToken(payload),
      refreshToken,
      sessionId,
    };
  }

  /**
   * 验证密码
   */
  private async verifyPassword(
    plainPassword: string,
    hashedPassword: string
  ): Promise<boolean> {
    // 开发环境：设置 DEV_SKIP_AUTH=1 跳过密码验证，生产环境永不生效
    if (process.env.NODE_ENV !== 'production' && authEnv.DEV_SKIP_AUTH === '1') {
      return true;
    }
    try {
      return await bcrypt.compare(plainPassword, hashedPassword);
    } catch (error) {
      console.error('[Auth] Password verification error: bcrypt compare failed');
      return false;
    }
  }

  // IP 归一化与白名单比对已抽至 utils/ip.ts（登录与 PAT 校验共用），此处仅委托
  private isIpAllowed(clientIp: string | undefined, allowedIps: string[] | undefined): boolean {
    return isIpAllowedShared(clientIp, allowedIps);
  }

  /**
   * 哈希密码（用于创建新用户）
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, authConfig.bcryptSaltRounds);
  }

  /**
   * 验证JWT Token
   */
  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, authConfig.jwtSecret) as JwtPayload;
    } catch (error) {
      throw new AppError(401, 'Invalid or expired token');
    }
  }

  /**
   * 刷新Token
   */
  refreshToken(oldToken: string): string {
    const payload = this.verifyToken(oldToken);

    // 移除过期时间字段
    const { iat, exp, ...newPayload } = payload as any;

    // 生成新Token
    return jwt.sign(
      newPayload as object,
      authConfig.jwtSecret,
      { expiresIn: authConfig.jwtExpiresIn } as SignOptions
    );
  }

  refreshCookieSession(refreshToken: string): {
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    payload: JwtPayload;
  } {
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, authConfig.jwtSecret) as any;
    } catch {
      throw new AppError(401, 'Invalid refresh token');
    }

    if (!decoded || decoded.type !== 'refresh' || !decoded.sid) {
      throw new AppError(401, 'Invalid refresh token');
    }

    const session = this.refreshTokenStore.get(decoded.sid);
    if (!session || session.userId !== decoded.username || session.expiresAt < Date.now()) {
      this.refreshTokenStore.delete(decoded.sid);
      throw new AppError(401, 'Refresh token expired or revoked');
    }

    this.refreshTokenStore.delete(decoded.sid);
    const payload: JwtPayload = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      organization: decoded.organization,
      branchCode: decoded.branchCode,
      // pns 必须随刷新透传：否则「刷新一次 token」就能绕过强制设密拦截
      ...(decoded.pns ? { pns: true } : {}),
      ...(decoded.sub ? { sub: decoded.sub } : {}),
      ...(Array.isArray(decoded.amr) ? { amr: decoded.amr } : {}),
      ...(decoded.identityId ? { identityId: decoded.identityId } : {}),
    };
    const next = this.issueCookieSession({
      username: payload.username,
      displayName: payload.username,
      role: payload.role,
      organization: payload.organization,
      branchCode: payload.branchCode,
      mustChangePassword: decoded.pns ? true : undefined,
      subjectUserId: decoded.sub ?? decoded.userId,
      authMethod: Array.isArray(decoded.amr) ? decoded.amr[0] : undefined,
      identityId: decoded.identityId,
    });
    return {
      ...next,
      payload,
    };
  }

  revokeCookieSession(refreshToken: string | null | undefined): void {
    if (!refreshToken) return;
    try {
      const decoded = jwt.verify(refreshToken, authConfig.jwtSecret) as any;
      if (decoded?.sid) {
        this.refreshTokenStore.delete(decoded.sid);
      }
    } catch {
      // token invalid/expired: nothing to revoke
    }
  }
}

// DEV_SKIP_AUTH 启动警告
if (process.env.NODE_ENV !== 'production' && authEnv.DEV_SKIP_AUTH === '1') {
  console.warn('[Auth] ⚠ DEV_SKIP_AUTH 已启用，所有用户密码验证已跳过');
}

// 导出单例实例
export const authService = new AuthService();
