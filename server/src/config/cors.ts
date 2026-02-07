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

export const corsConfig: CorsOptions = {
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : devOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400, // 24小时
};
