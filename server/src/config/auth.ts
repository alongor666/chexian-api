/**
 * JWT 认证配置
 * Authentication Configuration
 */

import { authEnv } from './env.js';

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
  jwtSecret: authEnv.JWT_SECRET,
  jwtExpiresIn: authEnv.JWT_EXPIRES_IN,
  jwtRefreshExpiresIn: authEnv.JWT_REFRESH_EXPIRES_IN,
  bcryptSaltRounds: 10,
};

// 注：JWT_SECRET 生产环境校验已移至 config/env.ts（启动时 fail-fast）
// 注：USER_PASSWORDS 生产环境警告已移至 config/env.ts
