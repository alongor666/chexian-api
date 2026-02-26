/**
 * 认证服务
 * Authentication Service
 *
 * 处理用户登录、JWT生成和密码验证
 */

import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { authConfig } from '../config/auth.js';
import { AppError } from '../middleware/error.js';
import { JwtPayload } from '../middleware/auth.js';

/**
 * 用户凭证（从前端复用）
 */
export interface UserCredential {
  username: string;
  passwordHash: string;
  displayName: string;
  role: string;
  organization?: string;
}

/**
 * 从环境变量加载用户密码覆盖
 * 环境变量 USER_PASSWORDS 格式（JSON）：
 * {"admin":"$2b$10$...","leshan":"$2b$10$..."}
 */
function loadPasswordOverrides(): Record<string, string> {
  const raw = process.env.USER_PASSWORDS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, string>;
  } catch {
    console.warn('[Auth] USER_PASSWORDS 格式无效，使用默认配置');
    return {};
  }
}

const PASSWORD_OVERRIDES = loadPasswordOverrides();

/**
 * 预设用户（开发/测试用）
 * 生产环境通过 USER_PASSWORDS 环境变量覆盖 passwordHash
 */
const PRESET_USERS: Record<string, UserCredential> = {
  admin: {
    username: 'admin',
    passwordHash: '$2b$10$APRNUh5SQwF3N7Ew0TbM/OuZJ6mnB6FgPvxni5OXiejDCDfQlJIRW',
    displayName: '系统管理员',
    role: 'branch_admin',
  },
  leshan: {
    username: 'leshan',
    passwordHash: '$2b$10$zg8QffrtojxjkuOuncgtG.SLPAbOsuS29USERwXVNlbs9suHdFihe',
    displayName: '乐山机构',
    role: 'org_user',
    organization: '乐山',
  },
  tianfu: {
    username: 'tianfu',
    passwordHash: '$2b$10$UDpOw8NOHWEokrdBlbZHRecw9cPnYFwevi.AZ5w5s0rywxH737zv.',
    displayName: '天府机构',
    role: 'org_user',
    organization: '天府',
  },
  yibin: {
    username: 'yibin',
    passwordHash: '$2b$10$bE6z5mFnpLIkH3Q/xxAV0ecRuAnQH8hls9Tk0RLxkbQc6ue0X/tCy',
    displayName: '宜宾机构',
    role: 'org_user',
    organization: '宜宾',
  },
  deyang: {
    username: 'deyang',
    passwordHash: '$2b$10$Ibn1z1Z3mlpCzV2Uxa7IzO6eDvvmd4zan65yrVaLtqLGhqj04XN92',
    displayName: '德阳机构',
    role: 'org_user',
    organization: '德阳',
  },
  xindu: {
    username: 'xindu',
    passwordHash: '$2b$10$MN/5HppLscWDiXbqgmxJH.f3pO3x3/JU38xkKtTr.ERFDXiKU7nPe',
    displayName: '新都机构',
    role: 'org_user',
    organization: '新都',
  },
  wuhou: {
    username: 'wuhou',
    passwordHash: '$2b$10$AC8yYRbjP9sep/CP3O7KPey/FgqpxY55ChPUzsyp.DGoYsveSW/Zy',
    displayName: '武侯机构',
    role: 'org_user',
    organization: '武侯',
  },
  luzhou: {
    username: 'luzhou',
    passwordHash: '$2b$10$Ca0AjfYyulOjBb3II5qkg.KrbZ6ZvPSS64tHLya7gfHNt5YmZuoCK',
    displayName: '泸州机构',
    role: 'org_user',
    organization: '泸州',
  },
  zigong: {
    username: 'zigong',
    passwordHash: '$2b$10$RjJSNiUzFUDQzsgSQyxoP.mQgzZiQTOZmiTCbt7./Uw2LDe0KwOy2',
    displayName: '自贡机构',
    role: 'org_user',
    organization: '自贡',
  },
  ziyang: {
    username: 'ziyang',
    passwordHash: '$2b$10$ilZd3i9kJuxq8AreozLABuqycttUPyzzDg4J3PI3pgohJFMMd40b.',
    displayName: '资阳机构',
    role: 'org_user',
    organization: '资阳',
  },
  dazhou: {
    username: 'dazhou',
    passwordHash: '$2b$10$DJdJxQxlnHDKuARwaMFZkuGlzP7PUgcy9HrfZRz/kGDv2qa/lZDIe',
    displayName: '达州机构',
    role: 'org_user',
    organization: '达州',
  },
  qingyang: {
    username: 'qingyang',
    passwordHash: '$2b$10$UaIDl3P3r5LsT9m.K23JXeg3MnUq7U40UPNjqFeuCKQhCVLFufiAW',
    displayName: '青羊机构',
    role: 'org_user',
    organization: '青羊',
  },
  gaoxin: {
    username: 'gaoxin',
    passwordHash: '$2b$10$uOtJ/1ctlLBNEzmQnhYXIuq.vYsn8VR3kcskjEY3vCUUsI/xQ.Sty',
    displayName: '高新机构',
    role: 'org_user',
    organization: '高新',
  },
  jiachengxian: {
    username: 'jiachengxian',
    passwordHash: '$2b$10$gy9XfxPHgbFrdSJfFrTtW.tu3kRzGYsPxGRrtvMyleCGNTpdTDhL6',
    displayName: 'jiachengxian',
    role: 'branch_admin',
  },
  xuechenglong: {
    username: 'xuechenglong',
    passwordHash: '$2b$10$NHIOCyjuqXWLXyq5UaP8Y.5p/NNsDMXBrsnk/eHsmq.tVSd0swcwu',
    displayName: '薛成龙',
    role: 'branch_admin',
  },
  linxia: {
    username: 'linxia',
    passwordHash: '$2b$10$IPuFIhlNl6NFLXSC8A4o4.tuqMsK9J7B6D5DbeKzpOnJtE9uLA/BO',
    displayName: '林霞',
    role: 'branch_admin',
  },
  chexianbu: {
    username: 'chexianbu',
    passwordHash: '$2b$10$MNXiN2ASW4I1h.uqWRKySuQH80CmVCn1wjnXbXWzV5ersVLcoE4wu',
    displayName: '车险部',
    role: 'branch_admin',
  },
};

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
    password: string
  ): Promise<{ token: string; user: Omit<UserCredential, 'passwordHash'> }> {
    // 对输入做最小标准化，减少浏览器自动填充/输入法导致的误判
    const normalizedUsername = this.normalizeUsername(username);
    const normalizedPassword = this.normalizePassword(password);

    // 1. 查找用户，并应用环境变量密码覆盖
    const baseUser = PRESET_USERS[normalizedUsername];
    if (!baseUser) {
      throw new AppError(401, 'Invalid username or password');
    }
    const user: UserCredential = PASSWORD_OVERRIDES[normalizedUsername]
      ? { ...baseUser, passwordHash: PASSWORD_OVERRIDES[normalizedUsername] }
      : baseUser;

    // 2. 验证密码
    const isPasswordValid = await this.verifyPassword(normalizedPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError(401, 'Invalid username or password');
    }

    // 3. 生成JWT Token
    const payload: JwtPayload = {
      userId: normalizedUsername, // 简化处理，使用username作为userId
      username: user.username,
      role: user.role,
      organization: user.organization,
    };

    const token = jwt.sign(
      payload as object,
      authConfig.jwtSecret,
      { expiresIn: authConfig.jwtExpiresIn } as SignOptions
    );

    // 4. 返回Token和用户信息（不包含密码）
    const { passwordHash, ...userInfo } = user;
    return {
      token,
      user: userInfo,
    };
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
    try {
      return await bcrypt.compare(plainPassword, hashedPassword);
    } catch (error) {
      console.error('[Auth] Password verification error:', error);
      return false;
    }
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
    };
    const next = this.issueCookieSession({
      username: payload.username,
      displayName: payload.username,
      role: payload.role,
      organization: payload.organization,
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

// 导出单例实例
export const authService = new AuthService();
