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
    passwordHash: '$2b$10$dsP3p4iH3h.QTivD1NjaquSOL4NEv9Xiu9dGuqwssvfw0fHcJFaqe',
    displayName: '系统管理员',
    role: 'branch_admin',
  },
  leshan: {
    username: 'leshan',
    passwordHash: '$2b$10$HNRVUUCQttsILOPN7J5TK.TTfvaNwQhanJN/QMou1M9w0UgTtzlZe',
    displayName: '乐山机构',
    role: 'org_user',
    organization: '乐山',
  },
  tianfu: {
    username: 'tianfu',
    passwordHash: '$2b$10$35LFheexG4DqZEjvjz3DVOs8og4EOeRmBDpB8T/.7AlH1M1vNpT96',
    displayName: '天府机构',
    role: 'org_user',
    organization: '天府',
  },
  yibin: {
    username: 'yibin',
    passwordHash: '$2b$10$FAcfwUHlrpWj7kmzcVkfYuub7rj1Ssr3PXaPJJqk2KLfYDYWxwXZq',
    displayName: '宜宾机构',
    role: 'org_user',
    organization: '宜宾',
  },
  deyang: {
    username: 'deyang',
    passwordHash: '$2b$10$tjZzt4M0FV6Uba/M50pE/.534Udr/RQnd9FhuCIZ14PLV6ga.7EBm',
    displayName: '德阳机构',
    role: 'org_user',
    organization: '德阳',
  },
  xindu: {
    username: 'xindu',
    passwordHash: '$2b$10$7ha6gwE0jzfz.qhd46dkCufLd8LOoHIu/Ox/AmQNnJor.IKv3B/1.',
    displayName: '新都机构',
    role: 'org_user',
    organization: '新都',
  },
  wuhou: {
    username: 'wuhou',
    passwordHash: '$2b$10$vEHw52QRP4osJjnarxCeZOhxGNK9b1TKWFW0g8mop5xQFeyw3UdkS',
    displayName: '武侯机构',
    role: 'org_user',
    organization: '武侯',
  },
  luzhou: {
    username: 'luzhou',
    passwordHash: '$2b$10$6wwT.lxqu7WgVXv9bxlku.0x0WEBRPwq0J16uCVKfNx8TjN5j7mQm',
    displayName: '泸州机构',
    role: 'org_user',
    organization: '泸州',
  },
  zigong: {
    username: 'zigong',
    passwordHash: '$2b$10$VsI2zk8VUdbmxOxjtYj3fuWmS5YIRbI.1YZK9iBz79HFM1cZceEN6',
    displayName: '自贡机构',
    role: 'org_user',
    organization: '自贡',
  },
  ziyang: {
    username: 'ziyang',
    passwordHash: '$2b$10$3mJe5vGaC04sbZ2F94N.fOOiXq8r6dzcjRGeWFVNQKTJs/uemeV1W',
    displayName: '资阳机构',
    role: 'org_user',
    organization: '资阳',
  },
  dazhou: {
    username: 'dazhou',
    passwordHash: '$2b$10$2qHFkyoF/QOkC6oUv2FWhO9n4MAbupfamh71PDkWD72wJ9cvE035a',
    displayName: '达州机构',
    role: 'org_user',
    organization: '达州',
  },
  qingyang: {
    username: 'qingyang',
    passwordHash: '$2b$10$AsI9LsQJBbZLW.Ey3zUaX.ZboYEJbAcZqE./IxUkQe/bA7HRPtFMu',
    displayName: '青羊机构',
    role: 'org_user',
    organization: '青羊',
  },
  gaoxin: {
    username: 'gaoxin',
    passwordHash: '$2b$10$EBGCq0aEFjQHCCwvLL1UUuu8bB7RQLHtaDTJhYC9qh8AnKLi7h6yu',
    displayName: '高新机构',
    role: 'org_user',
    organization: '高新',
  },
};

/**
 * 认证服务类
 */
class AuthService {
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

    // 1. 查找用户
    const user = PRESET_USERS[normalizedUsername];
    if (!user) {
      throw new AppError(401, 'Invalid username or password');
    }

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
