/**
 * CORS 跨域配置
 * Cross-Origin Resource Sharing Configuration
 */

import { CorsOptions } from 'cors';

/**
 * 开发环境允许的本地端口列表
 * Vite 可能使用 5173-5180 范围内的端口
 */
const devOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:5176',
];

/**
 * 环境变量配置的 Origin 列表（逗号分隔）
 */
const envOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

/**
 * 最终允许列表
 * - 生产环境：严格使用环境变量（如有）
 * - 开发环境：在环境变量基础上补充本地常用端口，避免 Vite 端口漂移导致请求被拦截
 */
const allowedOrigins = (() => {
  if (process.env.NODE_ENV === 'development') {
    return Array.from(new Set([...envOrigins, ...devOrigins]));
  }
  return envOrigins.length > 0 ? envOrigins : devOrigins;
})();

export const corsConfig: CorsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400, // 24小时
};
