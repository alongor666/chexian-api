# 外部集成

**分析日期:** 2026-04-12

## API 和外部服务

**AI 分析引擎（两层次）：**
- **智谱 GLM (Primary)** - SQL 生成和文本分析
  - SDK/Client: 原生 Node.js fetch (无官方 npm 包)
  - 模型: `glm-4.7-flash`
  - 认证: JWT 签名 (使用 Node.js crypto)
  - 端点: `https://open.bigmodel.cn/api/paas/v4/chat/completions`
  - 实现: `server/src/services/zhipu.ts`
  - 使用场景: NL2SQL 需求识别，趋势解读 (primary fallback)

- **OpenRouter (Multi-Model Fallback)** - 趋势分析和降级支持
  - SDK/Client: 原生 Node.js fetch
  - 模型支持: 逗号分隔列表，按顺序降级 (env: `AI_PRIMARY_MODEL`)
  - 认证: Bearer Token (`OPENROUTER_API_KEY`)
  - 端点: `https://openrouter.ai/api/v1/chat/completions`
  - 实现: `server/src/services/openrouter.ts`
  - 使用场景: 组织趋势分析，主模型超时时降级

**环境变量：**
- `ZHIPU_API_KEY` - 智谱认证 (必需)
- `OPENROUTER_API_KEY` - OpenRouter 认证 (可选，fallback 用)
- `AI_PRIMARY_MODEL` - 优先模型列表 (逗号分隔)
- `AI_PROVIDER_TIMEOUT_MS` - 请求超时 (默认 4500ms)
- `UNMATCHED_NOTIFY_WEBHOOK` - 飞书 Webhook (意图识别失败通知)

## 数据存储

**数据库：**
- **DuckDB (@duckdb/node-api 1.4.4-r.1)** - 内存 OLAP，原生 Node.js binding
  - 连接: `server/src/config/database.ts` → `DUCKDB_PATH` env
  - 模式: 仅读模式 (readOnly: true)
  - 最大连接数: 10 (可配置)
  - 最大内存: `DUCKDB_MAX_MEMORY` (默认 4GB, VPS 1.5GB)
  - 线程数: `DUCKDB_THREADS` (默认 4, VPS 2)
  - 特性: Parquet 直接查询，多表 JOIN，窗口函数，CTE
  - 基础设施: 连接池 + LRU 查询缓存 (查询结果缓存)
  - 初始化: `server/src/services/duckdb.ts:init()`

**Parquet 数据源：**
- 本地目录: `数据管理/warehouse/` (开发环境)
- VPS 路径: `server/data/` (生产环境)
- 数据域:
  - **policy** - 车险保单数据 (current/ 目录，4 分片)
  - **claims** - 赔案明细数据
  - **quotes** - 报价清单数据
  - **renewal** - 续保清单数据 (含状态标记)
  - **dim/salesman** - 业务员维度表 (latest.parquet)
  - **dim/plan** - 保费计划数据 (latest.parquet)
  - **dim/brand** - 品牌维度表 (latest.parquet)
- 加载逻辑: `server/src/services/duckdb-domain-loaders.ts`
- 版本检测: `/api/data/version` 端点返回 ETL 日期

**内存缓存层（Phase 1）：**
- **静态快照** - 预生成的 JSON 文件 (快照目录: `数据管理/warehouse/snapshots/`)
  - 结构: `snapshots/{bundleName}/{scope}/{paramHash}.json`
  - 命中延迟: <5ms (文件读取)
  - 支持的 bundle: dashboard-bundle, performance-bundle, cross-sell-bundle, filters-options, customer-flow-* (9 个)
  - 服务中间件: `server/src/middleware/snapshot-serve.ts`
  - 响应头: `X-Snapshot: hit | miss | stale | error`
  - 构建脚本: `bun run snapshot:build`
  - 验证: `bun run snapshot:verify` (dry-run + health check)

**实时查询缓存：**
- QueryCache (LRU): 内存中缓存查询结果，可配 TTL
- 清理触发: 数据版本变化时 (`invalidateSnapshotPathCache()`)
- 缓存键: query hash + params hash

## Service Worker (Phase 2)

**离线优先缓存（仅生产环境）：**
- 实现: `public/sw.js`
- 策略: stale-while-revalidate (缓存命中 → 立即返回 + 后台更新)
- 拦截范围: `/api/query/*` 路由仅 (不缓存 auth/data/ai/filters)
- 缓存 TTL: 24 小时
- 预取热点: 仪表盘 bundle 和性能 bundle
- 版本检测: 每日轮询 `/api/data/version` → 版本变化 → 清空缓存

## 认证和身份

**认证提供者：**
- **本地数据库（内置）** - 用户名/密码认证
  - 实现: `server/src/services/auth.ts` + `server/src/config/preset-users.ts`
  - 存储: bcrypt 密码哈希 (可覆盖: `USER_PASSWORDS` env)
  - 预设用户: admin, leshan, tianfu, 等 (见 preset-users.ts)

- **企业微信（可选）** - OAuth 2.0 工作台集成
  - 实现: `server/src/routes/wecom-auth.ts`
  - 配置: `WECOM_CORP_ID`, `WECOM_AGENT_ID`, `WECOM_SECRET`
  - 端点: `POST /api/auth/wecom`
  - 工作流: 获取企微 code → 交换 access_token → 获取用户信息

**授权：**
- 角色系统: branch_admin, analyst, viewer (见 `server/src/services/access-control.ts`)
- 权限控制: 基于角色的行为权限 + 数据权限 (机构隔离)
- 权限中间件: `server/src/middleware/permission.ts`

**令牌管理：**
- JWT 方案: Access Token (4h) + Refresh Token (7d)
- 签名密钥: `JWT_SECRET` env (生产环境必填)
- 载体: Authorization 头 (Bearer Token) 或 HttpOnly Cookie
- Cookie 配置: `cx_access_token`, `cx_refresh_token`, httpOnly, Secure (生产环境), SameSite=Lax
- 刷新端点: `POST /api/auth/refresh`

## 监控和可观测性

**错误追踪：**
- 无外部 SDK (Sentry/DataDog)
- 本地实现: `server/src/middleware/error.ts` (全局错误处理)
- 错误日志: 生产环境输出到 stdout/stderr (PM2 聚合)

**日志：**
- 方法: `console.log` / `console.error` (开发) + 审计日志 (生产)
- 审计日志: 所有已认证用户的查询 API 操作记录
  - 实现: `server/src/middleware/audit.ts`
  - 路径: `AUDIT_LOG_PATH` env
  - 格式: JSONL (每行一个事件)
  - 字段: timestamp, user, method, path, status, duration, params

**性能监控：**
- 慢查询告警: >3 秒记录警告 (threshold 可配)
- 请求指标: 执行时间、缓存命中率
- 快照健康检查: `/api/data/snapshot-health` 返回 hit/miss/stale/error 统计

## CI/CD 和部署

**部署平台：**
- **GitHub Actions** - CI 管道
  - 工作流: `.github/workflows/deploy.yml`
  - 触发: push main → 构建 → 部署 → 健康检查
  - CI 测试: 单元测试仅 (集成测试需原生 .node，CI 环境无法运行)

**生产托管：**
- **腾讯云 VPS** - `162.14.113.44` (2核4G)
- **PM2** - 进程管理 (应用名: `chexian-api`)
  - 配置: `server/ecosystem.config.cjs`
  - 启动: `pm2 start ecosystem.config.cjs`
  - 重启: `sudo /usr/local/bin/deploy-chexian-api reload`
  - 内存限制: 2048MB, 启动超时: 120s
  - 监听: false (生产环境不自动重启)

- **Nginx** - 反向代理 + 静态文件服务
  - 前端: `/var/www/chexian/frontend/dist`
  - 后端: `http://localhost:3000` (本地回环)
  - 配置: gzip_static on (预压缩 .gz/.br 文件)

**数据 ETL：**
- 脚本: `node 数据管理/daily.mjs`
- 触发: 每日自动 (智能检测) 或手动指定域
- 输入源: 原始数据文件 (xlsx/csv/parquet)
- 输出: Parquet 分片文件 (`warehouse/fact/policy/current/`)
- 自动同步: ETL 末尾调用 `node scripts/sync-vps.mjs` (rsync 到生产)

**数据同步：**
- 脚本: `node scripts/sync-vps.mjs`
- 方式: rsync (保留权限/时间戳)
- 同步目录:
  - `policy/current/` - 当前保单数据 (4 分片)
  - `claims/` - 赔案数据
  - `quotes/` - 报价数据
  - `renewal/` - 续保数据
  - `dim/salesman/latest.parquet`
  - `dim/plan/latest.parquet`
  - `dim/brand/latest.parquet`
- 目标: VPS `/var/www/chexian/server/data/`

## 环境配置

**必需的环境变量（生产环境）：**
- `JWT_SECRET` - JWT 签名密钥 (不允许默认值)
- `CORS_ORIGIN` - 跨域来源 (生产环境必填)
- `ZHIPU_API_KEY` - AI 服务认证
- `NODE_ENV=production` - 生产环境标识

**可选的环境变量：**
- `OPENROUTER_API_KEY` - 多模型降级支持
- `USER_PASSWORDS` - bcrypt 密码哈希覆盖
- `WECOM_*` - 企业微信集成
- `AUDIT_LOG_PATH` - 审计日志输出

**配置管理：**
- 来源: `server/ecosystem.config.cjs` 的 `env` 块 (PM2 启动时注入)
- 验证: `server/src/config/env.ts` (启动时 fail-fast 检查)
- 秘密存储: 环境变量 (非源码)

## Webhooks 和回调

**入站 Webhooks：**
- 飞书通知: 意图识别失败时推送消息
  - 配置: `UNMATCHED_NOTIFY_WEBHOOK` env
  - 调用: `server/src/services/requirement-detector.ts`
  - 消息格式: JSON (发送者, 意图, 原始输入)

**出站 Webhooks：**
- 无定义的出站 webhooks
- 外部集成: 智谱/OpenRouter API 调用仅

---

*集成审计：2026-04-12*
