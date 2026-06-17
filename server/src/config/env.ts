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

// 生产环境未配置 USER_PASSWORDS → 默认 fail-fast（拒绝带预置弱口令哈希启动）。
// 与 JWT_SECRET 的 requireInProduction 一致：默认弱口令是真实可登录凭据，
// 生产暴露 = 直接被接管。提供显式逃生阀 ALLOW_DEFAULT_CREDENTIALS=true 供
// 受控环境（内网演示 / 首次引导）临时放行，但会打印醒目告警。
if (isProd && !authEnv.USER_PASSWORDS) {
  if (process.env.ALLOW_DEFAULT_CREDENTIALS === 'true') {
    console.warn(
      '[env] ⚠️ ALLOW_DEFAULT_CREDENTIALS=true：生产环境正在使用 preset-users 默认密码哈希。' +
      '这些是已知弱口令，仅供受控临时场景。请尽快配置 USER_PASSWORDS 并移除此逃生阀。'
    );
  } else {
    throw new Error(
      '[env] 生产环境必需变量 USER_PASSWORDS 未配置：' +
      'preset-users.ts 内置的是已知默认弱口令哈希，禁止用于生产。' +
      '请将 USER_PASSWORDS 配置为 {"username":"$2b$10$..."} JSON 映射表；' +
      '若确需临时使用默认口令，显式设置 ALLOW_DEFAULT_CREDENTIALS=true。'
    );
  }
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
   * DuckDB 临时目录（larger-than-memory 聚合 / JOIN spill 到磁盘的物理路径）。
   *
   * DuckDB 行为说明（实测 1.x，CLI `SELECT current_setting('temp_directory')`）：
   *   - 缺省 / 空串：保持 DuckDB 默认——在进程 cwd 下自动创建 `.tmp/` 并 spill（默认值 `'.tmp'`）。
   *     本项目 server 启动时 cwd = `server/`，所以默认 spill 落到 `server/.tmp/`（已 .gitignore）。
   *   - 非空：显式 `SET temp_directory='${此值}'`，便于运维指向 SSD / 大盘
   *     （生产 VPS 2 核 4G 默认根盘空间紧张，可指 `/var/www/chexian/server/.tmp` 或 `/mnt/data/duckdb-spill`）。
   *
   * 范围说明：本变量只控制 **spill 物理路径**，不改 `memory_limit`，不解决 cost 立方体物化阶段的
   * 工作集（working set）超 `memory_limit` 触发 OOM 的根因。cost 立方体 OOM 的根治
   * （SQL 列裁剪 / 探针口径放宽 / 物化分块）属于另一 PR 范围。
   */
  DUCKDB_TEMP_DIR: process.env.DUCKDB_TEMP_DIR ?? '',
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
  /**
   * 应用状态持久层后端（v5 状态持久层迁移）
   * - 'json'   ：保留旧路径（user_store.json / api_tokens.json），默认值，零行为变更
   * - 'sqlite' ：启用 better-sqlite3 state.db（Phase 2/3 落地后才进入读写路径）
   * Phase 1（仅基础层）：值为 'sqlite' 时 state-db 模块会被 init，但 store 仍走 JSON
   */
  STATE_STORE_BACKEND: process.env.STATE_STORE_BACKEND ?? 'json',
  /** state.db 文件路径（仅 STATE_STORE_BACKEND=sqlite 时使用） */
  STATE_DB_PATH: process.env.STATE_DB_PATH ?? '',
  /**
   * 多分公司行级安全（plan v2 0F feature flag）。
   * - 'true' 启用：permissionMiddleware 在 baseFilter 上 AND `branch_code='${req.user.branchCode}'`
   *   （req.user.branchCode 缺省的系统级超管不加，看全国）。
   *   启用前提：所有 Parquet 已通过 backfill_derived_fields.py --recursive 补上 branch_code 列。
   * - 缺省 / 'false' 兼容期：不注入 branch_code 过滤，保留 0C 之前 SC 单租户行为。
   * 回滚：scripts/rollback-multi-branch.mjs 一键关闭 + PM2 reload；.claude/rules/multi-branch-rollback-sop.md。
   */
  BRANCH_RLS_ENABLED: process.env.BRANCH_RLS_ENABLED ?? 'false',
  /**
   * 通用可加性立方体路由（设计文档：开发文档/架构设计/通用立方体查询加速方案.md，
   * BACKLOG uid=2026-06-11-claude-90a92c）。
   * - CUBE_ROUTING_ENABLED='true'：可服务的查询（第一阶段：/api/query/trend）改走
   *   预聚合立方体（CubeTrendDay），不可服务的筛选组合自动回退原路径。
   * - 缺省 / 'false'：完全走原路径，零行为变更。回滚 = 关闭本开关 + reload。
   */
  CUBE_ROUTING_ENABLED: process.env.CUBE_ROUTING_ENABLED ?? 'false',
  /**
   * 立方体影子对账（灰度安全网，与 CUBE_ROUTING_ENABLED 互斥使用）。
   * 'true'：对外仍返回原路径结果，后台双跑立方体查询并逐行比对，差异进日志
   * 与计数器（services/cube-shadow.ts）。连续观察零差异后才切 CUBE_ROUTING_ENABLED。
   */
  CUBE_SHADOW_COMPARE: process.env.CUBE_SHADOW_COMPARE ?? 'false',
  /**
   * 立方体路由按路由白名单（部分切流闸，与 CUBE_ROUTING_ENABLED 配合）。
   * 取值：逗号分隔的 cube 路由 shadowKey（trend / growth / cost / kpi / salesman-ranking），
   * 与 scripts/shared/cube-routes.mjs SSOT 对齐；解析时去空格、忽略大小写。
   *
   * 语义：
   *   - 缺省 / 空串：不限制——CUBE_ROUTING_ENABLED='true' 时全部 5 路由切流（向后兼容，
   *     等价于本变量未引入前的行为）。
   *   - 非空：仅白名单内路由切流，其余路由（含 cost cube OOM 物化失败 / 跨格保单探针降级
   *     等"cube 暂不可服务"路由）继续走原路径，直至诊断修复后再扩列表。
   *
   * #7 部分切流推荐配置（trend / growth / salesman-ranking 三路由实测 0 mismatch）：
   *   CUBE_ROUTING_ENABLED=true
   *   CUBE_ROUTING_ROUTES=trend,growth,salesman-ranking
   * cost / kpi 因 cost cube 在当前数据版本探针降级，暂留原路径。
   */
  CUBE_ROUTING_ROUTES: process.env.CUBE_ROUTING_ROUTES ?? '',
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

// ─── HTML 报告托管 ────────────────────────────────────────────────────────────

export const reportsEnv = {
  /** 公网 base URL，用于拼接报告链接写入企微智能表格
   *  本地：http://localhost:3000
   *  VPS：https://chexian.cretvalu.com
   */
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
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
