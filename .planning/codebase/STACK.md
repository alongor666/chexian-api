# 技术栈

**分析日期:** 2026-04-12

## 语言

**主要：**
- TypeScript 5.9.3 - 前端和后端通用
- JavaScript (ESM) - 构建脚本、数据处理脚本
- Python 3 - ETL 数据管道

**次要：**
- SQL (DuckDB 方言) - 分析查询
- CSS - Tailwind UI 样式系统

## 运行时

**环境：**
- Node.js 20+ (后端 Express 服务器, `server/src/app.ts`)
- Bun - 前端包管理器和开发/构建

**包管理器：**
- Bun (前端主包管理) - 推荐方式
- npm/yarn - 可选备用（禁止混用）
- Lockfile: `package.lock` (Bun format)

## 框架与运行库

**核心前端框架：**
- React 19.2.4 - UI 库 (`src/`)
- React Router 7.13.1 - 路由 (`src/routes/`)
- Vite 5.4.21 - 前端构建工具 (`vite.config.ts`)

**后端框架：**
- Express 4.18.2 - HTTP 服务器 (`server/src/app.ts`)

**数据库：**
- DuckDB (@duckdb/node-api 1.4.4-r.1) - 内存 OLAP 数据库, 原生 Node.js binding
  - Parquet 支持（直接查询 `.parquet` 文件）
  - 多域数据加载：`server/src/services/duckdb-domain-loaders.ts`
  - 连接池和查询缓存基础设施：`server/src/services/duckdb-infra.ts`

**可视化：**
- ECharts 5.6.0 - 图表库 (`src/features/*/components/`)
- echarts-for-react 3.0.6 - React 包装

## 关键依赖

**数据和日期处理：**
- date-fns 4.1.0 - 日期格式化和时间逻辑
- exceljs 4.4.0 - Excel 导入/导出
- zod 4.3.6 - 运行时数据验证 (前后端通用)

**导出和报告：**
- jspdf 4.2.0 - PDF 生成
- jspdf-autotable 5.0.7 - PDF 表格
- html2canvas 1.4.1 - HTML 截图转 Canvas

**UI 组件和状态：**
- lucide-react 0.562.0 - 图标库
- react-select 5.10.2 - 下拉选择器
- react-window 1.8.11 - 虚拟列表（大数据渲染）
- @tanstack/react-query 5.90.21 - 异步状态管理和缓存 (staleTime=5min, gcTime=30min)
- react-markdown 10.1.0 - Markdown 渲染

**后端工具：**
- jsonwebtoken 9.0.2 - JWT 令牌签名和验证
- bcrypt 5.1.1 - 密码哈希
- helmet 7.1.0 - HTTP 安全头
- cors 2.8.5 - 跨域配置
- compression 1.8.1 - gzip/brotli HTTP 响应压缩
- express-rate-limit 7.1.5 - 三级限流中间件
- multer 1.4.5-lts.1 - 文件上传处理
- dotenv 16.4.5 - 环境变量加载

**JSON 渲染（实验）：**
- @json-render/core 0.2.0 - 泛型 JSON-to-UI 引擎
- @json-render/react 0.2.0 - React 集成

## 配置文件

**前端构建：**
- `vite.config.ts` - Vite 配置，gzip/brotli 预压缩，路径别名 `@/*`，chunk 分割策略
- `tsconfig.json` - TypeScript 配置 (target: ES2020, strict mode, baseUrl: .)
- `tailwind.config.ts` - Tailwind CSS 主题和设计系统
- `.prettierrc` - 代码格式化规则

**后端构建：**
- `server/tsconfig.json` - 后端 TypeScript 配置
- `server/ecosystem.config.cjs` - PM2 进程管理配置 (生产环境)
  - 单实例模式（DuckDB 不支持多进程共享）
  - 内存限制 2GB，启动超时 120 秒

**开发工具：**
- `vitest.config.ts` - 单元测试配置 (jsdom 环境, node 环境)
- `vitest.integration.config.ts` - 集成测试配置 (node 环境仅)

## 环境变量配置

**唯一事实源:** `server/src/config/env.ts` (所有 process.env 读取必须经此文件)

**服务器配置：**
- `PORT` - 监听端口 (默认 3000)
- `BIND_HOST` - 绑定主机 (默认 127.0.0.1)
- `NODE_ENV` - 运行环境 (development | production)
- `VPS_MODE` - 是否 VPS 生产模式

**认证：**
- `JWT_SECRET` - JWT 签名密钥 (生产环境必填)
- `JWT_EXPIRES_IN` - Access Token 过期时间 (默认 4h)
- `JWT_REFRESH_EXPIRES_IN` - Refresh Token 过期时间 (默认 7d)
- `USER_PASSWORDS` - 用户密码覆盖 (JSON 格式，bcrypt hashes)
- `USER_ALLOWED_IPS` - IP 白名单 (JSON 格式)
- `DEV_SKIP_AUTH` - 开发环境跳过认证 (仅 NODE_ENV=development 时生效)

**数据库：**
- `DUCKDB_PATH` - DuckDB 文件路径 (默认 ':memory:')
- `DATA_PATH` - Parquet 数据文件目录 (默认 './data')
- `DUCKDB_MAX_MEMORY` - DuckDB 最大内存 (默认 4GB, VPS 需设置 1.5GB)
- `DUCKDB_THREADS` - DuckDB 线程数 (默认 4, VPS 需设置 2)
- `DATA_VERSION` - 数据版本标识 (默认 v1)
- `ENABLE_QUERY_BUNDLES` - 启用 Bundle 路由 (默认 true)

**AI 服务：**
- `ZHIPU_API_KEY` - 智谱 GLM API Key (glm-4.7-flash 模型)
- `OPENROUTER_API_KEY` - OpenRouter API Key (多模型降级支持)
- `AI_PRIMARY_MODEL` - 首选模型 (逗号分隔，按顺序降级)
- `AI_PROVIDER_TIMEOUT_MS` - AI 请求超时 (默认 4500ms)
- `AI_TREND_CACHE_TTL_MS` - 趋势分析缓存时长 (默认 180s)
- `UNMATCHED_NOTIFY_WEBHOOK` - 意图匹配失败的飞书 Webhook

**跨域：**
- `CORS_ORIGIN` - 允许跨域来源 (生产环境必填)

**企业微信集成：**
- `WECOM_CORP_ID` - 企业 ID
- `WECOM_AGENT_ID` - 应用 AgentId
- `WECOM_SECRET` - 应用 Secret
- `WECOM_ADMIN_USERIDS` - 管理员企微 UserId (逗号分隔)

**运维：**
- `AUDIT_LOG_PATH` - 审计日志文件路径

## 开发命令

```bash
# 前端仅（禁止单独使用 bun run dev）
bun run dev

# 后端仅（禁止用于开发，需 tsx watch）
bun run start:server

# 完整开发环境（推荐）
bun run dev:full     # 同时启动 Vite 前端 + Express 后端 + 文件监听

# 构建
bun run build        # 前端 vite build + 后端类型检查
bun run typecheck    # TypeScript 类型检查仅

# 测试
bun run test         # 单元测试（jsdom/node 环境）
bun run test:integration  # 集成测试（需 DuckDB .node addon，仅本地）
bun run test:e2e     # Playwright E2E 测试
bun run test:coverage  # 覆盖率报告

# 生产构建和验证
bun run build        # 构建（NODE_OPTIONS='--max-old-space-size=4096'）
bun run governance   # 治理和一致性检查（41 项）
bun run verify:full  # typecheck + build + governance + test

# 快照和性能
bun run snapshot:build   # 生成快照（需先 bun run dev:full）
bun run snapshot:verify  # 快照 dry-run + 健康检查
bun run benchmark:key-routes  # 基准测试关键路由
```

## 构建优化

**前端：**
- 分块策略（manualChunks）：vendor-react, vendor-echarts, vendor-data, vendor-export, vendor-ui
- 预压缩：gzip 和 Brotli (threshold: 1024 bytes)
- 源图 disabled (生产环境)
- Target: ES2020, Minify: esbuild

**后端：**
- TypeScript 编译 (strict mode)
- 内存限制：`NODE_OPTIONS='--max-old-space-size=4096'` (构建时)

## 平台需求

**开发：**
- macOS / Linux
- Node.js 20+ or 22+
- Bun 1.0+
- Python 3.9+ (数据 ETL)

**生产：**
- Linux (腾讯云 Ubuntu)
- 部署目标: 2核4G VPS (`162.14.113.44`)
- PM2 进程管理 (`chexian-api` 应用)
- Nginx 反向代理
- DuckDB 原生二进制（.node addon）在 Node.js 20 运行

---

*技术栈分析：2026-04-12*
