/**
 * 认证服务
 * Authentication Service
 *
 * 处理用户登录、JWT生成和密码验证
 */

import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { authConfig } from '../config/auth.js';
import { authEnv } from '../config/env.js';
import { PRESET_USERS, getPresetVisibleBranches } from '../config/preset-users.js';
import { AppError } from '../middleware/error.js';
import { JwtPayload } from '../middleware/auth.js';
import { ensurePresetUser, getUserByUsername, setUserPasswordByUsername } from './access-control.js';
import type { AccessUser } from './access-control.js';
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
  allowedIps?: string[];
  allowedRoutes?: string[];
  defaultRoute?: string;
  specialFeatures?: string[];
  active?: boolean;
  /**
   * 本次密码登录使用的是统一初始密码，须改密后才能访问业务路由。
   * 仅密码登录链路产生（飞书扫码会话恒 undefined）；authMiddleware 按 JWT pwc 声明拦截。
   */
  mustChangePassword?: boolean;
}

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
    return input.normalize('NFKC').trim().toLowerCase();
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
      throw new AppError(401, 'Invalid username or password');
    }
    if (!user.active) {
      throw new AppError(403, 'Account disabled');
    }
    const allowedIpsOverride = ALLOWED_IP_OVERRIDES[normalizedUsername];
    const userCredential: UserCredential = {
      ...user,
      passwordHash: this.resolveEffectiveHash(normalizedUsername, user),
      allowedIps: allowedIpsOverride ?? user.allowedIps,
      // 全国超管可见省集合按 username 从 PRESET_USERS 派生（单一事实源），随登录响应回前端显示切省下拉。
      visibleBranches: getPresetVisibleBranches(normalizedUsername),
      // 统一初始密码账号（preset 标记）且尚未自设密码 → 本次会话强制改密
      mustChangePassword: this.isPasswordChangeRequired(normalizedUsername, user) || undefined,
    };

    if (!this.isIpAllowed(clientIp, userCredential.allowedIps)) {
      throw new AppError(403, 'IP not allowed');
    }

    // 2. 验证密码
    const isPasswordValid = await this.verifyPassword(normalizedPassword, userCredential.passwordHash);
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
      // pwc（password-change-required）声明只在密码登录且须改密时进 token
      ...(userCredential.mustChangePassword ? { pwc: true } : {}),
    };

    const token = jwt.sign(
      payload as object,
      authConfig.jwtSecret,
      { expiresIn: authConfig.jwtExpiresIn } as SignOptions
    );

    // 4. 返回Token和用户信息（不包含密码）
    const { passwordHash, ...userInfo } = userCredential;
    return {
      token,
      user: userInfo,
    };
  }

  /**
   * 解析账号当前生效的密码哈希。
   * 优先级：用户运行时自设密码（password_changed_at 非空的 store 哈希）
   *        > USER_PASSWORDS 环境变量覆盖（统一初始密码/运维注入）
   *        > store/preset 哈希（tombstone 占位则恒不可登录）。
   */
  private resolveEffectiveHash(normalizedUsername: string, user: AccessUser): string {
    if (user.passwordChangedAt) {
      return user.passwordHash;
    }
    return PASSWORD_OVERRIDES[normalizedUsername] ?? user.passwordHash;
  }

  /** 统一初始密码账号（preset mustChangePassword）且尚未自设密码 → 密码登录须强制改密 */
  private isPasswordChangeRequired(normalizedUsername: string, user: AccessUser): boolean {
    return PRESET_USERS[normalizedUsername]?.mustChangePassword === true && !user.passwordChangedAt;
  }

  /**
   * 新密码强度校验（返回违规原因，null = 通过）。
   * 口径：≥ 8 位，且同时含字母与数字。
   */
  validateNewPassword(password: string): string | null {
    if (password.length < 8) return '新密码长度至少 8 位';
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return '新密码必须同时包含字母和数字';
    }
    return null;
  }

  /**
   * 用户本人改密（统一初始密码首登强制改密链路）。
   * 验旧密（按当前生效哈希）→ 强度校验 → 写库（password_changed_at 置位，
   * 此后 USER_PASSWORDS 初始密码对该账号失效）。
   */
  async changePassword(
    username: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    const normalizedUsername = this.normalizeUsername(username);
    const normalizedOld = this.normalizePassword(oldPassword);
    const normalizedNew = this.normalizePassword(newPassword);

    const user = await getUserByUsername(normalizedUsername);
    if (!user || !user.active) {
      throw new AppError(401, 'Invalid username or password');
    }

    const effectiveHash = this.resolveEffectiveHash(normalizedUsername, user);
    const isOldValid = await this.verifyPassword(normalizedOld, effectiveHash);
    if (!isOldValid) {
      throw new AppError(401, '当前密码不正确');
    }

    const policyViolation = this.validateNewPassword(normalizedNew);
    if (policyViolation) {
      throw new AppError(400, policyViolation);
    }
    if (normalizedNew === normalizedOld) {
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
      userId: user.username,
      username: user.username,
      role: user.role,
      organization: user.organization,
      branchCode: user.branchCode,
      ...(user.mustChangePassword ? { pwc: true } : {}),
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
      // pwc 必须随刷新透传：否则「刷新一次 token」就能绕过强制改密拦截
      ...(decoded.pwc ? { pwc: true } : {}),
    };
    const next = this.issueCookieSession({
      username: payload.username,
      displayName: payload.username,
      role: payload.role,
      organization: payload.organization,
      branchCode: payload.branchCode,
      mustChangePassword: decoded.pwc ? true : undefined,
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
