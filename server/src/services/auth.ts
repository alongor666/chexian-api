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
 * 预设用户（开发/测试用）
 * 生产环境应从数据库读取
 */
const PRESET_USERS: Record<string, UserCredential> = {
  admin: {
    username: 'admin',
    // 密码: admin123
    passwordHash: '$2b$10$.CXzhMzuka22ctqHFH/NKujm47a.po0mkwnEtvDKjNwlhk2.GPFFG',
    displayName: '系统管理员',
    role: 'branch_admin',
  },
  leshan: {
    username: 'leshan',
    // 密码: leshan123
    passwordHash: '$2b$10$nVy5XUAxWGlzmhM3uNqxNuaYEE6oMp/za3ZaAtu1pZIpQ7498mINS',
    displayName: '乐山中支',
    role: 'org_user',
    organization: '乐山',
  },
  tianfu: {
    username: 'tianfu',
    // 密码: tianfu123
    passwordHash: '$2b$10$OvjvsuVRf2uNOyny2Pemf.6qMIkMGoo/2RDYSYYg/YOgxtmFYeJNO',
    displayName: '天府新区',
    role: 'org_user',
    organization: '天府',
  },
  // ... 其他10个机构用户省略，实际开发时补全
};

/**
 * 认证服务类
 */
class AuthService {
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
    // 1. 查找用户
    const user = PRESET_USERS[username];
    if (!user) {
      throw new AppError(401, 'Invalid username or password');
    }

    // 2. 验证密码
    const isPasswordValid = await this.verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError(401, 'Invalid username or password');
    }

    // 3. 生成JWT Token
    const payload: JwtPayload = {
      userId: username, // 简化处理，使用username作为userId
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
}

// 导出单例实例
export const authService = new AuthService();
