/**
 * 环境变量集中管理
 * Centralized Environment Configuration
 *
 * 唯一事实源：所有 process.env 读取必须经过此文件
 * 分组：server / auth / db / ai / cors / app
 *
 * 约束：
 * - 使用 ?? 运算符提供默认值（避免空字符串覆盖）
 * - 生产环境缺失必需变量时抛出错误（fail-fast）
 * - development 允许使用默认值继续运行
 */

import { parsePositiveInt } from '../utils/parse-env.js';

const isProd = process.env.NODE_ENV === 'production';

// ─── 启动时校验工具 ────────────────────────────────────────────────────────────

function requireInProduction(name: string, value: string | undefined, placeholder?: string): string {
  if (isProd && (!value || value === placeholder)) {
    throw new Error(`[env] 生产环境必需变量 ${name} 未配置${placeholder ? `（不允许使用默认占位符 "${placeholder}"）` : ''}`);
  }
  return value ?? '';
}

// ─── 服务器配置 ────────────────────────────────────────────────────────────────

export const serverEnv = {
  /** 监听端口，默认 3000 */
  PORT: Number(process.env.PORT ?? 3000),
  /** 绑定主机，默认仅本地回环 */
  BIND_HOST: process.env.BIND_HOST ?? '127.0.0.1',
} as const;

// ─── 认证配置 ──────────────────────────────────────────────────────────────────

const _jwtSecret = process.env.JWT_SECRET ?? 'change-me-in-production';
// 生产环境禁止使用默认占位符密钥
requireInProduction('JWT_SECRET', _jwtSecret, 'change-me-in-production');

export const authEnv = {
  /** JWT 签名密钥 */
  JWT_SECRET: _jwtSecret,
  /** Access Token 过期时间 */
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '4h',
  /** Refresh Token 过期时间 */
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  /**
   * 用户密码覆盖（JSON 格式：{"username":"$2b$10$..."}）
   * 未配置时使用 preset-users.ts 中的默认哈希
   */
  USER_PASSWORDS: process.env.USER_PASSWORDS ?? '',
  /** 用户 IP 白名单覆盖（JSON 格式：{"username":["1.2.3.4"]}） */
  USER_ALLOWED_IPS: process.env.USER_ALLOWED_IPS ?? '',
  /** 开发环境跳过认证（仅 NODE_ENV=development 且值为 '1' 时生效） */
  DEV_SKIP_AUTH: process.env.DEV_SKIP_AUTH ?? '',
} as const;

// 生产环境未配置 USER_PASSWORDS 时给出警告（不阻断启动）
if (isProd && !authEnv.USER_PASSWORDS) {
  console.warn(
    '[env] WARNING: USER_PASSWORDS 未设置，生产环境使用默认密码哈希。' +
    '请配置 USER_PASSWORDS 为 JSON 映射表以保证安全。'
  );
}

// ─── 数据库配置 ────────────────────────────────────────────────────────────────

export const dbEnv = {
  /** DuckDB 文件路径（:memory: 表示内存数据库） */
  DUCKDB_PATH: process.env.DUCKDB_PATH ?? ':memory:',
  /** Parquet 数据文件目录 */
  DATA_PATH: process.env.DATA_PATH ?? './data',
  /** DuckDB 最大内存用量 */
  DUCKDB_MAX_MEMORY: process.env.DUCKDB_MAX_MEMORY ?? '4GB',
  /** DuckDB 线程数 */
  DUCKDB_THREADS: process.env.DUCKDB_THREADS ? parseInt(process.env.DUCKDB_THREADS, 10) : 4,
  /**
   * 连接池最大连接数（默认 8）
   * 双重对齐：CPU 物理上限 ∩ 应用 fanout 下限。
   * - 8 槽配合 queue=32，覆盖 bundles 路由单请求 10 query 并发 + cache-warmer
   * - 仍比原 10 紧 20%，保留治理意图
   * - 非正整数（NaN/0/负数）会 fallback 到默认值，避免启动后 DB 不可用
   */
  DUCKDB_MAX_CONNECTIONS: parsePositiveInt('DUCKDB_MAX_CONNECTIONS', process.env.DUCKDB_MAX_CONNECTIONS, 8),
  /** 数据版本标识，用于 API 响应 meta */
  DATA_VERSION: process.env.DATA_VERSION ?? 'v1',
  /** 是否启用 Bundle 路由（false 字符串禁用） */
  ENABLE_QUERY_BUNDLES: process.env.ENABLE_QUERY_BUNDLES ?? 'true',
} as const;

// ─── AI 提供商配置 ─────────────────────────────────────────────────────────────

export const aiEnv = {
  /** OpenRouter API Key */
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
  /**
   * OpenRouter 首选模型（逗号分隔，按顺序降级）
   * 兼容旧字段名 OPENROUTER_MODELS
   */
  AI_PRIMARY_MODEL: process.env.AI_PRIMARY_MODEL ?? process.env.OPENROUTER_MODELS ?? '',
  /** AI 提供商单次请求超时（毫秒） */
  AI_PROVIDER_TIMEOUT_MS: process.env.AI_PROVIDER_TIMEOUT_MS ? parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) : 4500,
  /** 机构趋势分析缓存时长（毫秒） */
  AI_TREND_CACHE_TTL_MS: process.env.AI_TREND_CACHE_TTL_MS ? parseInt(process.env.AI_TREND_CACHE_TTL_MS, 10) : 180_000,
  /** 智谱 API Key（兼容 VITE_ 前缀配置） */
  ZHIPU_API_KEY: process.env.ZHIPU_API_KEY ?? process.env.VITE_ZHIPU_API_KEY ?? '',
  /** 未匹配意图飞书 Webhook 通知 URL */
  UNMATCHED_NOTIFY_WEBHOOK: process.env.UNMATCHED_NOTIFY_WEBHOOK ?? '',
} as const;

// ─── CORS 配置 ─────────────────────────────────────────────────────────────────

export const corsEnv = {
  /** 允许的跨域来源（逗号分隔，生产环境必填） */
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '',
} as const;

// ─── 企业微信配置 ──────────────────────────────────────────────────────────────

export const wecomEnv = {
  /** 企业 ID */
  WECOM_CORP_ID: process.env.WECOM_CORP_ID ?? '',
  /** 应用 AgentId */
  WECOM_AGENT_ID: process.env.WECOM_AGENT_ID ?? '',
  /** 应用 Secret */
  WECOM_SECRET: process.env.WECOM_SECRET ?? '',
  /** 管理员企微 UserId 列表（逗号分隔） */
  WECOM_ADMIN_USERIDS: process.env.WECOM_ADMIN_USERIDS ?? '',
} as const;

// ─── 运维配置 ──────────────────────────────────────────────────────────────────

export const opsEnv = {
  /** 审计日志文件路径 */
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH ?? '',
  /** Workflow audit JSONL 保留天数 */
  AUDIT_LOG_RETENTION_DAYS: process.env.AUDIT_LOG_RETENTION_DAYS
    ? parseInt(process.env.AUDIT_LOG_RETENTION_DAYS, 10)
    : 90,
} as const;

// ─── 测试配置 ──────────────────────────────────────────────────────────────────

const _e2eTestMode = process.env.E2E_TEST_MODE ?? '';
// 生产环境硬拦截：E2E_TEST_MODE=1 会削弱登录限流（rateLimiter loginLimiter skip）
if (isProd && _e2eTestMode === '1') {
  throw new Error('[env] E2E_TEST_MODE=1 禁止在生产环境启用（会削弱登录限流防护）');
}

export const testEnv = {
  /** E2E 测试模式：仅非生产环境 + 值为 '1' 时生效，用于绕过登录限流 */
  E2E_TEST_MODE: _e2eTestMode,
} as const;
