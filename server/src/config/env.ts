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
// 安全审查 H1：启动期核对 active 账号的 USER_PASSWORDS 覆盖（WARN，非 fail-fast）。
// preset-users.ts 零 import，此依赖单向、无循环。
import { PRESET_USERS, SELF_SERVICE_PASSWORD_ONLY_USERS } from './preset-users.js';

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
  /**
   * 密码事件 webhook 群播通知 URL（飞书自定义机器人，全员密码闭环阶段二·旧通道）。
   * 覆盖四类事件：激活成功 / 自助改密 / 找回重设 / 管理员重置。
   * 飞书已下线自定义机器人入口，新部署请改用 PASSWORD_EVENT_NOTIFY_CHAT_ID（应用 API 通道）；
   * 本变量保留（修补不拆除），非空时优先走 webhook 旧路径。
   * 未配置则看 CHAT_ID；两者皆空静默不通知（通知失败不阻塞主流程，审计事件独立落盘兜底）。
   * 独立于 UNMATCHED_NOTIFY_WEBHOOK，禁止复用该变量（两类事件受众/群不同）。
   */
  PASSWORD_EVENT_NOTIFY_WEBHOOK: process.env.PASSWORD_EVENT_NOTIFY_WEBHOOK ?? '',
  /**
   * 密码事件飞书应用 API 群播目标群 ID（oc_ 开头，新通道）。
   * 走「以应用身份发消息」（im/v1/messages, receive_id_type=chat_id），
   * 应用凭证默认复用 FEISHU_APP_ID/SECRET（车险登录 cli_a94d08f46539dbcd，bot 已在目标群），
   * 可用 PASSWORD_NOTIFY_APP_ID/SECRET 覆盖为专用通知应用。
   * 仅当 PASSWORD_EVENT_NOTIFY_WEBHOOK 为空时生效（webhook 旧路径优先）。
   */
  PASSWORD_EVENT_NOTIFY_CHAT_ID: process.env.PASSWORD_EVENT_NOTIFY_CHAT_ID ?? '',
  /** 密码事件通知专用飞书应用 App ID（可选；缺省回落 FEISHU_APP_ID） */
  PASSWORD_NOTIFY_APP_ID: process.env.PASSWORD_NOTIFY_APP_ID ?? '',
  /** 密码事件通知专用飞书应用 App Secret（可选；缺省回落 FEISHU_APP_SECRET；禁止打进日志） */
  PASSWORD_NOTIFY_APP_SECRET: process.env.PASSWORD_NOTIFY_APP_SECRET ?? '',
} as const;

// 生产环境未配置 USER_PASSWORDS → 默认 fail-fast（拒绝带预置弱口令哈希启动）。
// 与 JWT_SECRET 的 requireInProduction 一致：默认弱口令是真实可登录凭据，
// 生产暴露 = 直接被接管。提供显式逃生阀 ALLOW_DEFAULT_CREDENTIALS=true 供
// 受控环境（内网演示 / 首次引导）临时放行，但会打印醒目告警。
if (isProd && !authEnv.USER_PASSWORDS) {
  if (process.env.ALLOW_DEFAULT_CREDENTIALS === 'true') {
    console.warn(
      '[env] ⚠️ ALLOW_DEFAULT_CREDENTIALS=true：生产环境跳过了 USER_PASSWORDS 校验。' +
      'preset-users.ts 现在全部是 fail-safe tombstone（漏注入即恒拒登录，非弱口令后门），' +
      '但缺 USER_PASSWORDS 意味着无人能用临时密码登录。请尽快配置 USER_PASSWORDS。'
    );
  } else {
    throw new Error(
      '[env] 生产环境必需变量 USER_PASSWORDS 未配置：' +
      'preset-users.ts 现在全部是 fail-safe tombstone 占位（不含真实凭据），' +
      '缺 USER_PASSWORDS 会导致所有非自设密码账号无法登录。' +
      '请将 USER_PASSWORDS 配置为 {"username":"$2b$10$..."} JSON 映射表；' +
      '若确需临时无凭据启动，显式设置 ALLOW_DEFAULT_CREDENTIALS=true。'
    );
  }
}

/**
 * 安全审查 H1（WARN，非 fail-fast）：USER_PASSWORDS 非空时，列出「active 且非自助设密、
 * 且不在 USER_PASSWORDS key」的账号——这些账号若尚未自设密码将无法登录（源码已是 tombstone）。
 * 刻意不 fail-fast：启动期读不到 store 的 password_changed_at，硬拦会误伤已自设密码的账号。
 * 安全性由 tombstone + preset-users.test.ts 全局不变量承担，本处仅作运维可见性。
 */
function warnMissingUserPasswordKeys(): void {
  const raw = authEnv.USER_PASSWORDS;
  if (!raw) return;
  let keys: Set<string>;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return;
    keys = new Set(Object.keys(parsed).map((k) => k.toLowerCase()));
  } catch {
    return; // 解析失败由 auth.ts loadPasswordOverrides 侧告警，这里不重复
  }
  const selfService = new Set(SELF_SERVICE_PASSWORD_ONLY_USERS.map((u) => u.toLowerCase()));
  const missing = Object.values(PRESET_USERS)
    .filter((u) => u.active !== false)
    .map((u) => u.username.toLowerCase())
    .filter((name) => !selfService.has(name) && !keys.has(name));
  if (missing.length > 0) {
    console.warn(
      `[env] ⚠️ 以下 ${missing.length} 个 active 账号未在 USER_PASSWORDS 提供临时密码：` +
      `${missing.join(', ')}。若其尚未自设密码将无法登录（源码为 fail-safe tombstone）。` +
      '如需其可登录，请在 USER_PASSWORDS 补 bcrypt 哈希；确认已自设密码可忽略本告警。'
    );
  }
}
warnMissingUserPasswordKeys();

// ─── 数据库配置 ────────────────────────────────────────────────────────────────

export const dbEnv = {
  /** DuckDB 文件路径（:memory: 表示内存数据库） */
  DUCKDB_PATH: process.env.DUCKDB_PATH ?? ':memory:',
  /** Parquet 数据文件目录 */
  DATA_PATH: process.env.DATA_PATH ?? './data',
  /**
   * 单文件上传大小上限（MB）。唯一事实源——四处口径必须对齐：
   *   1. multer limits.fileSize（server/src/routes/data.ts，从本变量派生字节数）
   *   2. nginx client_max_body_size（deploy/nginx-fullstack.conf，静态模板不读 Node env，
   *      须与本默认值手工对齐，由 governance「上传上限对齐」闸逐落点校验防漂移）
   *   3. 前端预校验 MAX_IMPORT_SIZE（src/features/file/utils/fileHelpers.ts，客户端 bundle
   *      无法读 Node env，须镜像本默认值；比后端紧会让合规文件被浏览器提前拦下）
   *   4. 安全清单文档（.claude/commands/chexian-security-review.md）
   * 默认 200（MB）：按实测活跃最大 Parquet ~72MB 取整加 ~2.7x 余量（覆盖未来省份 / 时间窗增长）。
   * 生产有效上限由 nginx 先于 Express 拒绝决定，故 nginx 值必须 == 本默认值。
   * 非正整数（NaN/0/负数）fallback 到默认，避免上传端点因坏 env 全面失效。
   * 诚实边界：governance 闸只校验各落点源码默认；若部署期用 MAX_UPLOAD_SIZE_MB 运行时 env 覆盖
   * 而不同步改 nginx 静态模板，闸无法察觉（静态模板无法读 env）——改上限须同时改模板。
   */
  MAX_UPLOAD_SIZE_MB: parsePositiveInt('MAX_UPLOAD_SIZE_MB', process.env.MAX_UPLOAD_SIZE_MB, 200),
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
  /**
   * 立方体切流后采样影子对账率（R3 缺口闭环，BACKLOG bf2c4e）。
   * 取值 0~1 小数（如 '0.01' = 1%）。仅对【已切流】路由生效：采样命中的请求
   * 对外仍直返 cube（不伤时延），路由层后台 fire-and-forget 跑 legacy 并与已返回
   * 的 cube 结果对账 —— 切流后 isCubeShadowEnabledFor 对该路由返回 false（影子期
   * 双跑已停），本采样是切流后唯一的 cube-vs-legacy 数值背离持续探测网，
   * 兜住改写器语义漂移/类型回归（如 issue #608）。缺省 '0' = 不采样，零行为变更。
   */
  CUBE_SHADOW_SAMPLE_RATE: process.env.CUBE_SHADOW_SAMPLE_RATE ?? '0',
  /**
   * cx sql 派生域联邦（设计：.claude/plans/cx-cli-swift-pudding.md P0）。
   * - 'true'：`cx sql` 准入白名单从单一 PolicyFact 扩展为「已实证权限列的派生视图」
   *   （RenewalTrackerFact / QuoteConversion / CrossSellFact / NewEnergyClaims）+ 参照维度表
   *   （BrandDim / PlateRegionMap，豁免 RLS；RepairDim 含机构敏感列 org_level_3，**不豁免、已排除**）。
   *   每个 direct 视图强制 fail-closed
   *   RLS 注入：过滤条件引用的列若该视图缺失 → 拒绝执行（绝不静默丢弃过滤=越权泄漏）。
   * - 缺省 / 'false'：完全退回单 PolicyFact 行为，零行为变更。回滚 = 关闭本开关 + reload。
   * 权限列清单为 ground-truth（duckdb DESCRIBE 实测），见 config/sql-federation-policy.ts。
   */
  SQL_FEDERATION_ENABLED: process.env.SQL_FEDERATION_ENABLED ?? 'false',
} as const;

// ─── 功能开关配置 ──────────────────────────────────────────────────────────────

export const featureEnv = {
  /**
   * 综合分析视图开放度，镜像前端构建期变量 VITE_ENABLE_COMPREHENSIVE_ANALYSIS
   * （.env.production='true'），两处必须同步，否则前端放行、后端 403（或反之）。
   * 三态：'true' 全员开放（cost 闸旁路）；'false' 全员关闭；未设置 → 按 specialFeatures 强制。
   * 生产 PM2 侧在 server/ecosystem.config.cjs env 块设置。
   */
  ENABLE_COMPREHENSIVE_ANALYSIS:
    process.env.ENABLE_COMPREHENSIVE_ANALYSIS ?? process.env.VITE_ENABLE_COMPREHENSIVE_ANALYSIS,
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

// ─── 飞书配置 ──────────────────────────────────────────────────────────────────

export const feishuEnv = {
  /** 飞书应用 App ID */
  FEISHU_APP_ID: process.env.FEISHU_APP_ID ?? '',
  /** 飞书应用 App Secret */
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET ?? '',
  /** 授权组织的飞书租户 key（组织门禁：未配置或不匹配一律拒绝登录，fail-closed） */
  FEISHU_TENANT_KEY: process.env.FEISHU_TENANT_KEY ?? '',
  /** 管理员飞书标识列表（逗号分隔，可填 user_id / open_id / 手机号 / 邮箱） */
  FEISHU_ADMIN_USERIDS: process.env.FEISHU_ADMIN_USERIDS ?? '',
  /** 飞书登录用户分公司编码覆盖（可选；留空时跟随部署省份 BRANCH_CODE，见 feishu.ts 消费点） */
  FEISHU_DEFAULT_BRANCH: process.env.FEISHU_DEFAULT_BRANCH ?? '',
  /**
   * 业务员映射表兜底开关（resolvePermission 第 3 层，按飞书姓名匹配自动发 org_user）。
   * 默认关闭（fail-closed：不在角色映射/管理员白名单 = 拒绝登录）——
   * 姓名匹配存在重名误授权风险（如川分财产险部梁彬 vs 业务员 110224246梁彬）。
   * 显式设 'true' 才启用。
   */
  FEISHU_SALESMAN_FALLBACK: process.env.FEISHU_SALESMAN_FALLBACK ?? '',
  /** 飞书部门个人账号灰度开关；仅显式 true 启用 */
  FEISHU_DEPARTMENT_PERSONAL_ACCOUNTS_ENABLED: process.env.FEISHU_DEPARTMENT_PERSONAL_ACCOUNTS_ENABLED ?? '',
  /**
   * 开发环境扫码回调后的前端回跳源（仅 NODE_ENV !== 'production' 生效）。
   * dev 下后端(3000)不托管 SPA，回调若相对重定向 '/#/...' 会落在后端 404 页；
   * 默认回跳 vite dev server。生产环境同源部署（nginx 托管 SPA），恒用相对路径，本值被忽略。
   */
  FEISHU_DEV_FRONTEND_ORIGIN: process.env.FEISHU_DEV_FRONTEND_ORIGIN ?? 'http://localhost:5173',
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
