/**
 * JWT 认证配置
 * Authentication Configuration
 */

export interface AuthConfig {
  /** JWT密钥 */
  jwtSecret: string;
  /** Token过期时间 */
  jwtExpiresIn: string;
  /** Token刷新时间（可选） */
  jwtRefreshExpiresIn?: string;
  /** 密码哈希盐轮数 */
  bcryptSaltRounds: number;
}

export const authConfig: AuthConfig = {
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '4h',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  bcryptSaltRounds: 10,
};

// 验证JWT配置
if (
  process.env.NODE_ENV === 'production' &&
  authConfig.jwtSecret === 'change-me-in-production'
) {
  throw new Error('JWT_SECRET must be set in production environment');
}

// 生产环境下，若未配置 USER_PASSWORDS 则警告（不强制退出，允许使用默认哈希）
if (process.env.NODE_ENV === 'production' && !process.env.USER_PASSWORDS) {
  console.warn(
    '[Auth] WARNING: USER_PASSWORDS environment variable is not set. ' +
    'Default password hashes are in use. ' +
    'Set USER_PASSWORDS to a JSON map of username -> bcrypt hash for production security.'
  );
}
