# CLAUDE.md

> **chexian-api** — 车险数据分析平台（API 版）。React + TypeScript + Vite + ECharts，后端 Express + DuckDB。生产环境 `https://chexian.cretvalu.com`。

> **共享记忆**：项目记忆存储在 `.claude/shared-memory/`（git 跟踪）+ `~/.claude/shared-memory/chexian/`（本地运行时）。clone 后执行 `bash .claude/shared-memory/sync-memory.sh --pull` 拉取记忆到本地。多项目共享（私董会/作战地图/chexian-api），详见 `reference_shared_memory.md`。

---

## 0. 红线规则

**写代码前三问**：1) 已有实现？→ `grep -r` 搜索 2) 改多少行？→ <30% 用 Edit，≥50% 用 Write 3) 怎么验证？→ 执行验证命令并贴出结果

| 红线 | 做法 |
|------|------|
| 先搜再写 | `grep/glob` 搜索整个项目，禁止假设"不存在" |
| 验证不声称 | 必须通过真实 API 请求验证并贴出结果 |
| 修补不拆除 | 安全加固禁止删除整个模块，只能修补 |
| 并行不串行 | 3+ 独立任务必须并行 sub-agents |
| Edit > Write | 改动少用 Edit，新建/大改用 Write |
| 执行不规划 | `commit/push/PR` 直接执行，零分析 |
| 源数据验证 | 修改 SQL 生成器后，必须用 Parquet 直查与 API 返回对比验证 |
| 文档同步 | 涉及 3+ 文件变更的重构完成后，扫描并更新受影响的索引和知识库（CODE_INDEX / scripts/INDEX / PARQUET_SCHEMA_KNOWLEDGE / DATA_FLOW_KNOWLEDGE / CLAUDE.md 注册表章节） |

**Pre-flight（每次任务前）**：1) `grep -r` 搜索已有实现 2) 涉及数据时 `find 数据管理/` 3) 声称完成前 `curl` 验证 4) 删除前列影响清单等用户确认 5) push 前检查大文件 6) push 前 `grep -rn '<<<<<<'` 扫描冲突标记 7) push 前 `bun run governance`

**方法确认协议**：遇到"下钻/层级"→问用户交互模型；"已完成"→curl 验证；"不存在"→先搜索；"安全加固/重构"→列清单等确认；"commit/push"→直接执行；"全部检查"→并行 sub-agents

---

## 1. 索引与文档

| 索引 | 路径 |
|------|------|
| 文档索引 | `开发文档/00_index/DOC_INDEX.md` |
| 代码索引 | `开发文档/00_index/CODE_INDEX.md` |
| 数据索引 | `开发文档/00_index/DATA_INDEX.md` |
| 进展索引 | `开发文档/00_index/PROGRESS_INDEX.md` |

**必读文档**：`ARCHITECTURE.md`（模块层级）· `开发文档/TECH_STACK.md`（技术栈）· `开发文档/DEVELOPER_CONVENTIONS.md`（DC-001 三要素）· `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md`（38 字段定义）· `开发文档/缺口清单.md`（信息缺口追踪）

**两本账**：[BACKLOG.md](./BACKLOG.md)（需求）· [PROGRESS.md](./PROGRESS.md)（进展）

**数据知识协议**：数据处理任务必读 [.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)。唯一事实源：`数据管理/knowledge/rules/车险数据业务规则字典.md`

---

## 2. 指标注册表（RED LINE）

**唯一事实源**：`server/src/config/metric-registry/`（L1-L3 原子指标）· 指标字典：`开发文档/指标字典.md`（自动生成，禁止手动编辑）

**新增/修改指标流程**（必须按顺序）：
1. `grep -r "id: '${NEW_ID}'" server/src/config/metric-registry/` — 确认不存在
2. 判断复杂度：L1-L3（单行 SQL 表达式）→ 添加到 `categories/*.ts`；L4（CTE/窗口函数/多表 JOIN）→ SQL 生成器中实现，引用注册表原子指标
3. 必须包含：id + name + formula + sql.expression + display + 至少 1 个 testCase + changelog
4. `npx tsx scripts/metric-registry/validate.ts` 校验通过
5. `npx tsx scripts/metric-registry/generate-frontend-map.ts` 更新前端映射

**禁止**：
- ❌ 在 SQL 生成器中硬编码新指标公式而不在注册表注册
- ❌ 在前端硬编码指标标签/阈值而不从注册表派生
- ❌ 新增与已有指标公式重复的指标（先 `grep` 注册表确认不存在）
- ❌ 修改已发布指标公式而不更新 version 和 changelog

**跨项目对齐**：作战地图 `00_规范与协议/指标字典_v2.0.md` 是业务层权威定义，本注册表是代码层实现。两者公式必须一致。

### 字段注册表（RED LINE）

**唯一事实源**：`server/src/config/field-registry/fields.json`（42 个字段）

**新增/修改字段流程**（必须按顺序）：
1. 修改 `fields.json` 中的字段定义
2. 运行 `node scripts/field-registry/generate.mjs` → 自动更新 mapping.ts + validator.ts + etl_fields.json
3. `bun run governance` 验证一致性（#17 检查）

**禁止**：
- ❌ 手动编辑 `mapping.ts` / `validator.ts`（由 codegen 生成，标注 `DO NOT EDIT MANUALLY`）
- ❌ 在 `transform.py` 中硬编码字段列表（从 `etl_fields.json` 读取）
- ❌ 新增 ETL 源字段不在 `shard-config.json:explicitly_ignored_fields` 或 `fields.json` 中声明（Schema 契约会 `sys.exit(1)` 阻断）

### 注册表体系总览

| 注册表 | 路径 | 覆盖范围 | codegen |
|--------|------|---------|---------|
| 指标注册表 | `server/src/config/metric-registry/` | 25 个指标 | `generate-frontend-map.ts` |
| 字段注册表 | `server/src/config/field-registry/fields.json` | 42 个字段 | `field-registry/generate.mjs` |
| 客户类别 | `src/shared/config/customer-categories.ts` + `server/src/config/` | 11 类枚举 | — |
| 环境变量 | `server/src/config/env.ts` | 20+ 变量（6 分组） | — |
| API 路由 | `server/src/config/api-routes.ts` + `src/shared/api/routes.ts` | 50+ 路由 | — |
| ETL 配置 | `数据管理/shard-config.json` | 分片边界 + 显式忽略字段 | — |
| 数据域注册表 | `数据管理/data-sources.json` | 9 域元数据 | ETL 自动更新 |

---

## 3. 护栏（RED LINE）

**架构协议**：Bun 包管理器（禁止 npm/yarn）· 智谱 API `glm-4.7-flash` · 三级限流（禁止降低）· `security.ts` 危险字符黑名单支持中文

**报价数据口径**（待修正）：当前 `是否报价` 字段不可靠，正确逻辑应以「续保单号非空」判定已报价。用户待办，AI 不得擅自修改。

> 分片架构、VPS 分层查询、数据同步等详细规则见 `.claude/rules/data-pipeline.md`。业务口径护栏见 `.claude/rules/sql-generators.md`。

---

## 4. API 架构

```
前端 Hook → apiClient → GET /api/query/*
  → [Phase 2] Service Worker (stale-while-revalidate, 0ms 二次访问)
  → server/src/routes/query.ts（聚合器）
    → authMiddleware → permissionMiddleware
    → [Phase 1] snapshotServe（检查 JSON 快照, <5ms）
      ├→ 命中: fs.readFile → X-Snapshot:hit → respond
      └→ 未命中: next() → query/*.ts → sql/*.ts → duckdb.ts → JSON
```

**快照层**（Phase 1）：`server/src/middleware/snapshot-serve.ts` · 响应头 `X-Snapshot: hit|miss|stale|error` · 快照目录 `数据管理/warehouse/snapshots/{bundle}/{scope}/{paramHash}.json`

**Service Worker**（Phase 2）：`public/sw.js` · 仅生产环境 + 仅 `/api/query/*` GET · 每日轮询 `/api/data/version` 检测 ETL 更新 · SW 活跃时 React Query staleTime=Infinity

**启动**：`bun run dev:full`（禁止只运行 `bun run dev`）

**关键文件**：`src/shared/contexts/DataContext.tsx`（isDataLoaded）· `src/shared/api/client.ts`（API 入口）· `server/src/services/duckdb.ts`（查询执行 + `loadMultipleParquet()`）· `server/src/config/paths.ts`（路径配置）· `server/src/routes/query.ts`（路由聚合器，65 行）+ `query/*.ts`（19 子路由）· `server/src/sql/`（30 个 SQL 模块：27 生成器 + 3 共享）· `server/src/config/preset-users.ts`（用户）· `server/src/services/access-control.ts`（权限）

**API 前缀**：`/api/query/*`（KPI/趋势/排名/成本/系数/续保/交叉销售）· `/api/data/*`（文件）· `/api/ai/*`（NL2SQL/需求识别）· `/api/auth/*`（登录）· `/api/filters/*`（筛选器）

---

## 5. 交付与技术栈

**DONE 判定**：关联文档 + 关联代码 + 验收证据（至少一项）。核心层改动须更新 INDEX.md。提交前：`bun run governance`

**技术栈**：React + TypeScript + Vite + DuckDB + ECharts · Bun 包管理器

```bash
bun install && bun run dev:full    # 安装+启动
bun run build                      # 类型检查+构建
bun run test                       # 单元测试（⚠️ 不是 bun test）
bun run test:integration           # 集成测试（需 DuckDB 原生二进制，仅本地）
bun run test:e2e                   # E2E（需先 dev:full，凭据 admin/CxAdmin@2026!）
bun run governance                 # 治理校验
bun run snapshot:build             # 快照构建（需先 dev:full）
bun run snapshot:verify            # 快照 dry-run + 健康检查
```

**CI 测试分层协议**（RED LINE）：
- **单元测试** (`bun run test`): 72 文件 / 892 测试 — CI + 本地
- **集成测试** (`bun run test:integration`): 4 文件 — 仅本地（需 DuckDB 原生二进制）
- CI 环境无法解析 `.node` 原生模块（vitest/jsdm 限制），相关测试必须在 `vite.config.ts` exclude 中排除
- 新增原生模块依赖时，必须检查是否有对应测试需排除

---

## 6. 验证协议

| 场景 | 验证命令 |
|------|----------|
| 修改 SQL | `curl -s localhost:3000/api/query/kpi \| jq '.data \| length'` |
| 修改交叉销售 SQL | `python3 scripts/verify-cross-sell.py --date <YYYY-MM-DD>` |
| 源数据口径验证 | DuckDB 直查 Parquet → 与 API 返回对比 |
| 修改路由 | `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/[路由]` |
| 修改前端 | `bun run build` 零 TS 报错 |
| 声称完成 | 至少一个 API 200 + 非空 JSON |
| 修改快照 | `bun run snapshot:build --bundle <name>` 重建 + `curl -I` 检查 `X-Snapshot: hit` |
| Git 推送 | `bun run governance && git diff --check` |

验证结果必须出现在输出中。SQL 报错查 [DuckDB 文档](https://duckdb.org/docs/)，禁止猜测。

---

## 7. 异常处理

| 情况 | 处理 |
|------|------|
| 信息缺口 | 登记缺口清单 → BLOCKED |
| 业务口径错误 | 禁止直接改 → BACKLOG 登记 |
| API 失败 | 检查 apiClient 与路由对应，前端新增方法须确认后端路由存在 |

---

## 8. 协作与部署

**任务 ID**：@user B001-B099 / @claude B100-B199 / @codex B200-B299

**并行规则**：3+ 独立模块/任务必须并行 sub-agents。PR 前：`git fetch origin main && git rebase origin/main && bun run governance`

**生产环境**：腾讯云 2核4G `162.14.113.44` · `https://chexian.cretvalu.com` · PM2 `chexian-api` 端口 3000 · Nginx 前端 `/var/www/chexian/frontend/dist` · **PM2 重启**：deployer 无法直接调 pm2，须 `sudo /usr/local/bin/deploy-chexian-api reload`（或 `restart`/`install`）

**数据 ETL**：`node 数据管理/daily.mjs`（智能检测）· `node 数据管理/daily.mjs premium|claims|quotes|all`（强制）· 维度表：`python3 数据管理/warehouse/dim/generate_dim_tables.py`

**数据同步**：`node scripts/sync-vps.mjs`（rsync `policy/current/` + `claims/` + `quotes/` + 维度表 `salesman/` + `plan/`）

**CI/CD**：`deploy.yml`（push main → 构建→部署→健康检查）· `claude-code.yml`（@claude 触发）· `governance-check.yml`（PR 治理）

**工具箱**：[.claude/commands/README.md](./.claude/commands/README.md)（30 命令）· `.claude/agents/`（14 agents）· 常用：`/commit-push-pr` `/sync-and-rebase` `/data-analysis` `/security-review` `/verify`

---

## 9. 部署清单

声称"已部署"前，按顺序逐项验证：

1. `bun run build` — 零 TS 报错
2. `bun run governance` — 治理通过
3. PM2 状态检查 — `sudo /usr/local/bin/deploy-chexian-api describe`，若 errored 则 `sudo /usr/local/bin/deploy-chexian-api reload`（禁止只 restart）
4. 环境变量 — 确认 `ecosystem.config.cjs` 中所有 env 变量在 VPS 上有值
5. CORS 配置 — 确认不会因 env 缺失抛异常
6. DuckDB/Parquet 兼容 — `union_by_name` schema 一致性
7. 健康检查 — `curl -s https://chexian.cretvalu.com/health` 返回 200
8. 快照文件 — `curl -s https://chexian.cretvalu.com/api/data/snapshot-health` 返回快照状态（首次部署无快照时全部 miss，正常）
8. 核心 API — 至少一个 `/api/query/*` 返回 200 + 非空 JSON

---

## 10. 领域知识

车险分析任务中，**禁止假设因果关系或业务定义**，不确定时必须先问用户确认。

| 规则 | 说明 |
|------|------|
| 风险等级是结构性数据 | `insurance_grade`(A-G/X) 是车辆属性字段，不是"质量泄漏"或可控因子 |
| 终端来源 ≠ 渠道 | `terminal_source`(出单终端) 和 `channel`(业务渠道) 是不同维度，禁止混用 |
| 定价系数 ≠ 赔付因果 | `商车自主定价系数` 不直接导致出险率变化，禁止假设因果链 |
| 出险率分母 | 用已赚暴露(earned exposure)，不是签单件数(written count) |
| 驾乘推介率 | = 驾意险推介件数 / 商业险出单件数（非保费比）。分母仅含主全+交三，排除纯交强/单交 |
| 驾乘渗透率 | = 驾意险承保件数 / 商业险承保件数 |
| 推介率分母 | 商业险出单件数（去重车架号），不含纯交强/单交。整体行 = 主全 + 交三 |
| 赔付率分子 | 已决赔款 + 未决赔款（满期赔付率用满期保费做分母） |
| 客户类别 | 11 类，按车辆使用性质分，详见业务规则字典 |

**唯一事实源**：`数据管理/knowledge/rules/车险数据业务规则字典.md`。公式/口径有疑问先查此文件，查不到再问用户。

---

## 11. 文件与路径规则

| 规则 | 说明 |
|------|------|
| 先确认再动手 | 用户提到文档/计划，若有多版本先问"哪个版本？" |
| Session 数据 | 读 `~/.claude/` 下 JSONL 文件，不是项目文档 |
| 禁止硬编码路径 | 使用 `server/src/config/paths.ts` 或环境变量 |
| 数据文件 | `数据管理/warehouse/` 是本地源，`server/data/` 是 VPS 运行时 |

---

## 12. 审查质量

审查计划或文档时：

1. **事实核查**：所有声明对照实际代码/数据验证，不信任表面描述
2. **逻辑一致性**：检查边界条件和矛盾，不只看表面结构
3. **诚实评分**：浅层审查浪费时间，宁可花多一轮也不输出低质量结论
4. **业务逻辑标注**：涉及保险/分析内容，所有假设的业务逻辑都标注 `⚠️ 待用户确认`

<!-- GSD:project-start source:PROJECT.md -->
## Project

Project not yet initialized. Run /gsd-new-project to set up.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## 语言
- TypeScript 5.9.3 - 前端和后端通用
- JavaScript (ESM) - 构建脚本、数据处理脚本
- Python 3 - ETL 数据管道
- SQL (DuckDB 方言) - 分析查询
- CSS - Tailwind UI 样式系统
## 运行时
- Node.js 20+ (后端 Express 服务器, `server/src/app.ts`)
- Bun - 前端包管理器和开发/构建
- Bun (前端主包管理) - 推荐方式
- npm/yarn - 可选备用（禁止混用）
- Lockfile: `package.lock` (Bun format)
## 框架与运行库
- React 19.2.4 - UI 库 (`src/`)
- React Router 7.13.1 - 路由 (`src/routes/`)
- Vite 5.4.21 - 前端构建工具 (`vite.config.ts`)
- Express 4.18.2 - HTTP 服务器 (`server/src/app.ts`)
- DuckDB (@duckdb/node-api 1.4.4-r.1) - 内存 OLAP 数据库, 原生 Node.js binding
- ECharts 5.6.0 - 图表库 (`src/features/*/components/`)
- echarts-for-react 3.0.6 - React 包装
## 关键依赖
- date-fns 4.1.0 - 日期格式化和时间逻辑
- exceljs 4.4.0 - Excel 导入/导出
- zod 4.3.6 - 运行时数据验证 (前后端通用)
- jspdf 4.2.0 - PDF 生成
- jspdf-autotable 5.0.7 - PDF 表格
- html2canvas 1.4.1 - HTML 截图转 Canvas
- lucide-react 0.562.0 - 图标库
- react-select 5.10.2 - 下拉选择器
- react-window 1.8.11 - 虚拟列表（大数据渲染）
- @tanstack/react-query 5.90.21 - 异步状态管理和缓存 (staleTime=5min, gcTime=30min)
- react-markdown 10.1.0 - Markdown 渲染
- jsonwebtoken 9.0.2 - JWT 令牌签名和验证
- bcrypt 5.1.1 - 密码哈希
- helmet 7.1.0 - HTTP 安全头
- cors 2.8.5 - 跨域配置
- compression 1.8.1 - gzip/brotli HTTP 响应压缩
- express-rate-limit 7.1.5 - 三级限流中间件
- multer 1.4.5-lts.1 - 文件上传处理
- dotenv 16.4.5 - 环境变量加载
- @json-render/core 0.2.0 - 泛型 JSON-to-UI 引擎
- @json-render/react 0.2.0 - React 集成
## 配置文件
- `vite.config.ts` - Vite 配置，gzip/brotli 预压缩，路径别名 `@/*`，chunk 分割策略
- `tsconfig.json` - TypeScript 配置 (target: ES2020, strict mode, baseUrl: .)
- `tailwind.config.ts` - Tailwind CSS 主题和设计系统
- `.prettierrc` - 代码格式化规则
- `server/tsconfig.json` - 后端 TypeScript 配置
- `server/ecosystem.config.cjs` - PM2 进程管理配置 (生产环境)
- `vitest.config.ts` - 单元测试配置 (jsdom 环境, node 环境)
- `vitest.integration.config.ts` - 集成测试配置 (node 环境仅)
## 环境变量配置
- `PORT` - 监听端口 (默认 3000)
- `BIND_HOST` - 绑定主机 (默认 127.0.0.1)
- `NODE_ENV` - 运行环境 (development | production)
- `VPS_MODE` - 是否 VPS 生产模式
- `JWT_SECRET` - JWT 签名密钥 (生产环境必填)
- `JWT_EXPIRES_IN` - Access Token 过期时间 (默认 4h)
- `JWT_REFRESH_EXPIRES_IN` - Refresh Token 过期时间 (默认 7d)
- `USER_PASSWORDS` - 用户密码覆盖 (JSON 格式，bcrypt hashes)
- `USER_ALLOWED_IPS` - IP 白名单 (JSON 格式)
- `DEV_SKIP_AUTH` - 开发环境跳过认证 (仅 NODE_ENV=development 时生效)
- `DUCKDB_PATH` - DuckDB 文件路径 (默认 ':memory:')
- `DATA_PATH` - Parquet 数据文件目录 (默认 './data')
- `DUCKDB_MAX_MEMORY` - DuckDB 最大内存 (默认 4GB, VPS 需设置 1.5GB)
- `DUCKDB_THREADS` - DuckDB 线程数 (默认 4, VPS 需设置 2)
- `DATA_VERSION` - 数据版本标识 (默认 v1)
- `ENABLE_QUERY_BUNDLES` - 启用 Bundle 路由 (默认 true)
- `ZHIPU_API_KEY` - 智谱 GLM API Key (glm-4.7-flash 模型)
- `OPENROUTER_API_KEY` - OpenRouter API Key (多模型降级支持)
- `AI_PRIMARY_MODEL` - 首选模型 (逗号分隔，按顺序降级)
- `AI_PROVIDER_TIMEOUT_MS` - AI 请求超时 (默认 4500ms)
- `AI_TREND_CACHE_TTL_MS` - 趋势分析缓存时长 (默认 180s)
- `UNMATCHED_NOTIFY_WEBHOOK` - 意图匹配失败的飞书 Webhook
- `CORS_ORIGIN` - 允许跨域来源 (生产环境必填)
- `WECOM_CORP_ID` - 企业 ID
- `WECOM_AGENT_ID` - 应用 AgentId
- `WECOM_SECRET` - 应用 Secret
- `WECOM_ADMIN_USERIDS` - 管理员企微 UserId (逗号分隔)
- `AUDIT_LOG_PATH` - 审计日志文件路径
## 开发命令
# 前端仅（禁止单独使用 bun run dev）
# 后端仅（禁止用于开发，需 tsx watch）
# 完整开发环境（推荐）
# 构建
# 测试
# 生产构建和验证
# 快照和性能
## 构建优化
- 分块策略（manualChunks）：vendor-react, vendor-echarts, vendor-data, vendor-export, vendor-ui
- 预压缩：gzip 和 Brotli (threshold: 1024 bytes)
- 源图 disabled (生产环境)
- Target: ES2020, Minify: esbuild
- TypeScript 编译 (strict mode)
- 内存限制：`NODE_OPTIONS='--max-old-space-size=4096'` (构建时)
## 平台需求
- macOS / Linux
- Node.js 20+ or 22+
- Bun 1.0+
- Python 3.9+ (数据 ETL)
- Linux (腾讯云 Ubuntu)
- 部署目标: 2核4G VPS (`162.14.113.44`)
- PM2 进程管理 (`chexian-api` 应用)
- Nginx 反向代理
- DuckDB 原生二进制（.node addon）在 Node.js 20 运行
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- TypeScript: `camelCase` for filenames (e.g., `alertChecker.ts`, `duckdb.ts`, `formatters.ts`)
- Test files: `*.test.ts` or `*.test.tsx` co-located with source or in `__tests__` directories
- Routes: `kebab-case` subdirectories under `server/src/routes/query/` (e.g., `query/kpi.ts`, `query/cross-sell.ts`)
- Component files: `PascalCase.tsx` (e.g., `Card.tsx`, `Button.tsx`)
- Utilities/services: `camelCase.ts` with clear purpose in name (e.g., `duckdb-infra.ts`, `snapshot-serve.ts`)
- `camelCase` for all functions: `checkGrowthDecline()`, `formatPremiumWan()`, `asyncHandler()`
- Async functions clearly named with responsibility: `waitForBackendReady()`, `ensureDataLoaded()`
- Handler functions: `{verb}Handler()` pattern (e.g., `errorHandler()`, `notFoundHandler()`, `asyncHandler()`)
- `camelCase` for local variables and parameters
- `UPPER_SNAKE_CASE` for constants (e.g., `MAX_FILE_SIZE`, `SECURITY_LIMITS`, `SLOW_QUERY_THRESHOLD_MS`)
- Private class properties prefixed with underscore: `private instance: DuckDBInstance | null = null`
- Maps and collections: descriptive names reflecting contents (e.g., `parquetFingerprintCache`, `inflightControllers`, `fileMtimes`)
- PascalCase for interfaces, types, and classes
- Prefixed descriptively: `DuckDBServiceConfig`, `AlertCheckData`, `ParquetCacheEntry`
- Generic types: `T`, `K`, `V` for standard patterns; more descriptive when needed (e.g., `DuckDBQueryable`)
## Code Style
- No explicit linting config found (`.eslintrc*`, `.prettierrc*` absent from root)
- **De facto standard observed**: 2-space indentation, semicolons required
- Line length: ~80-100 characters (observed in conditionals and function signatures)
- JSDoc comments on public functions and classes with `@param`, `@returns`, `@example` tags
- TypeScript strict mode enabled (implied by `tsconfig.json: "strict": true`)
- Type annotations required on function parameters and return types: `function formatCount(value: number | bigint | null | undefined): string`
- No implicit `any` allowed (strict TypeScript enforcement)
## Import Organization
- `@` → `src/` (frontend)
- `@server` → `server/src/` (backend, in test config)
- API routes centralized in `src/shared/api/routes.ts` and `src/shared/api/client.ts`
- All relative imports must include `.js` extension: `import { something } from './file.js'`
- No `__dirname` — use `fileURLToPath(import.meta.url)` instead
- Use `import.meta.env` for environment variables (Vite): `import.meta.env.MODE`, `import.meta.env.VITE_API_BASE`
## Error Handling
- Custom `AppError` class in `server/src/middleware/error.ts` with `statusCode`, `message`, `isOperational` properties
- Throw with descriptive messages: `throw new AppError(400, 'Invalid input')`
- Async route wrapper `asyncHandler()` catches Promise rejections and passes to error middleware
- Frontend: throw `Error` with user-friendly message, caught by error boundaries
- Production: generic "Internal Server Error" (no stack trace leak)
- Development: full error message from caught exception
- Backend logging: only error name and message via `console.error()` (no raw stack traces)
## Logging
- Instantiate with context: `new Logger('ComponentName')`
- Level-based filtering: `debug`, `info`, `warn`, `error`, `none`
- Production default: `warn` level; development default: `debug` level
- Methods: `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`
- Test setup (`tests/setup.ts`) sets logger to `warn` to reduce noise
## Comments
- Complex business logic or algorithm: explain the "why", not the "what"
- Type hints for non-obvious data structures: `// { days: N } from DuckDB DATE serialization`
- Security-related code: explicitly document threat being mitigated
- Workarounds or hacks: mark with `// HACK:` or `// TODO:` with explanation
- Public API: JSDoc with `@param`, `@returns`, `@example` required
- Used extensively on exported functions and classes
- Format: `@param name - description`, `@returns description`, `@example code snippet`
- Example from codebase: `formatPremiumWan(value: number | bigint | null | undefined): string` includes example usage
## Function Design
- Preferred: <50 lines per function
- Observed: Small utility functions (10-30 lines) and handler functions (20-40 lines)
- Large files broken into smaller focused modules (e.g., `duckdb.ts` delegates to `duckdb-infra.ts`, `duckdb-materialization.ts`, `duckdb-domain-loaders.ts`)
- Explicit over variadic: named parameters preferred
- Use object destructuring for multiple parameters: `function createService({ path, maxConnections }: DuckDBServiceConfig)`
- Type all parameters strictly
- Explicit return types required in all function signatures
- Nullable returns annotated: `Promise<T | null>`, `Result | undefined`
- Never return bare `undefined` without type annotation
## Module Design
- Named exports preferred: `export function checkGrowthDecline()` allows tree-shaking
- Default exports used only for classes: `export default new ApiClient()`
- Re-export types explicitly: `export type { AlertRule, TargetProgress }`
- Used at layer boundaries: `src/shared/types/index.ts` exports all type definitions
- Simplifies consumer imports: `import { KpiData } from '@/shared/types'`
- One-level barrel recommended; avoid deep nesting
- Spread operator for object updates: `{ ...user, name: newName }` not `user.name = newName`
- Array immutability: `[...array, newItem]` instead of `.push()`
- Observed in Redux-style state patterns and React hooks
## API Response Format
- All responses wrapped in `ApiResponse<T>`
- `data` field contains payload (nullable on error)
- `error` field contains error message (nullable on success)
- `meta` included for paginated endpoints
## Frontend-Specific
- Functional components: `PascalCase.tsx`
- Props interfaces: `{ComponentName}Props`
- Custom hooks: `use{Capability}` (e.g., `useRenewalV2`)
- All hardcoded colors/styles forbidden; use design system from `src/shared/styles/index.ts`
- Available: `colorClasses`, `tableStyles`, `textStyles`, `fontStyles`, `cardStyles`
- No inline `className="text-red-500 dark:text-red-700"` — use `colorClasses.text.danger` instead
- Numeric columns in tables: `className={fontStyles.numeric}` for right-alignment
- Use shared formatters from `src/shared/utils/formatters.ts`:
- Never hardcode `.toFixed(2).toLocaleString()`
## Backend-Specific
- All queries go through `DuckDBService` singleton: `server/src/services/duckdb.ts`
- Query execution: `await duckdbService.query(sql, params)`
- DATE type returns as `{ days: N }` object — must deserialize to ISO string in `convertBigIntToNumber()`
- TIMESTAMP type returns as `{ micros: N }` — must deserialize to ISO string
- All DuckDB operations behind `DuckDBQueryable` interface for testability
- Dynamic SQL: use parameterization where possible
- Table/column names: sanitize with `sanitizeTableName()` from `server/src/utils/security.ts`
- SQL strings: use template literals with explicit variable injection (not user input directly)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- **API-driven**: Frontend communicates exclusively via REST API endpoints (`/api/*`)
- **Static snapshots**: High-frequency queries cached as pre-computed JSON files (Phase 1 optimization)
- **Service Worker integration**: Client-side caching layer for stale-while-revalidate strategy (Phase 2 optimization)
- **Domain-driven SQL generation**: 30+ SQL generators bundled into 19 query routes
- **Materialized views**: PolicyFact, ClaimsDetail, CrossSellFact pre-materialized at startup for sub-second queries
## Layers
- Purpose: React components, page routing, user interactions, visualization (ECharts)
- Location: `src/app/App.tsx` (entry point), `src/features/pages/*` (page components)
- Contains: React components, hooks, feature modules (dashboard, growth, cost, renewal, etc.)
- Depends on: `src/shared/api/client.ts` (API calls), React Query (caching), contexts (auth/filters/permissions)
- Used by: Browser
- Purpose: State management (authentication, filters, permissions), data fetching coordination
- Location: `src/shared/contexts/` (DataContext, FilterContext, PermissionContext)
- Contains: Context providers, React Query integration, API token management
- Depends on: apiClient, hooks (useQuery, useMutation)
- Used by: All page components via context consumption
- Purpose: Reusable UI components, utilities, styles, types
- Location: `src/shared/` (ui, components, utils, hooks, styles, types, api, config)
- Contains: design system tokens, formatters, color classes, API routes registry, user configuration
- Depends on: Tailwind CSS, date-fns, lodash-es
- Used by: All frontend code
- Purpose: Request validation, authentication, authorization, rate limiting, snapshot serving, audit logging
- Location: `server/src/middleware/` (auth, permission, snapshot-serve, rateLimiter, audit, error)
- Contains: Express middleware chain (security headers, compression, auth, permission checks, snapshot interception)
- Depends on: Express, JWT, access control service
- Processes all `/api/*` requests before routing to business logic
- Purpose: REST endpoint aggregation and subrouting
- Location: `server/src/routes/query.ts` (main aggregator), `server/src/routes/query/*.ts` (19 subroutes)
- Contains: KPI, Trend, Growth, Cost, Cross-Sell, Claims-Detail, Renewal, Quote-Conversion, Performance, etc.
- Depends on: SQL generators, DuckDB service, snapshot serving middleware
- Processing: Each subroute calls SQL generator, executes via DuckDB, optionally serves cached snapshot
- Purpose: Dynamic SQL construction for different business domains and filter combinations
- Location: `server/src/sql/` (30 SQL modules: 27 generators + 3 shared utilities)
- Contains: KPI, Coefficient, Cross-Sell, Performance, Claims-Detail, Renewal-Universe, Premium-Plan, Quote-Conversion, Trend, etc.
- Pattern: Each module exports `generate*Sql(filters: Filters): string` functions
- Depends on: Database schema, business rule constants, perspective adapter
- Used by: Query routes to construct SQL dynamically
- Purpose: DuckDB connection management, query execution, result serialization, caching
- Location: `server/src/services/duckdb.ts` (main service), `duckdb-infra.ts` (connection pool & query cache), `duckdb-materialization.ts` (VIEW/TABLE creation)
- Contains: Query execution with slow query monitoring, connection pooling (max 10 connections), result caching (optional TTL), Parquet fingerprinting
- Depends on: `@duckdb/node-api` (Neo API), DuckDB configuration
- Materializations: Creates PolicyFact, ClaimsDetail, CrossSellFact, RenewalUniverse, CustomerFlow tables at startup
- Used by: Route handlers
- Purpose: Application startup sequence - DuckDB initialization, Parquet discovery, materialization, dimension loading
- Location: `server/src/services/data-bootstrapper.ts`, `duckdb-domain-loaders.ts`
- Phases:
- Used by: Server startup
- Purpose: JWT token validation, user identity recovery, role-based permission filtering
- Location: `server/src/services/auth.ts` (JWT), `access-control.ts` (RBAC), `server/src/config/preset-users.ts` (user credentials)
- Pattern: Login endpoint returns JWT → middleware validates JWT on each request → permission middleware constructs SQL WHERE filters based on user role
- Access levels: branch_admin (no filter), regional_manager (org_level_3 filter), salesman (personal + team filter)
- Used by: Auth middleware, permission middleware
- Purpose: Pre-computed JSON response caching for <5ms latency on cache hit
- Location: `server/src/middleware/snapshot-serve.ts`, `数据管理/warehouse/snapshots/` (directory structure: `{bundle}/{scope}/{paramHash}.json`)
- Logic: Intercepts `/api/query/*` requests after auth/permission middleware, checks if `(bundle, scope, paramHash)` snapshot exists
- Response header `X-Snapshot: hit|miss|stale|error` indicates cache status
- Built by: `node scripts/build-snapshots.mjs` during deployment or on-demand
- Used by: All `/api/query/*` routes (9 bundle routes: dashboard-bundle, performance-bundle, cross-sell-bundle, customer-flow-*, filters-options)
- Purpose: Client-side stale-while-revalidate caching for `/api/query/*` GET requests
- Location: `public/sw.js`
- Logic: On daily basis, checks `/api/data/version` for ETL updates; if data unchanged, serves cached responses with Infinity staleTime
- Enabled only in production and when active (navigator.serviceWorker.controller !== null)
- Triggers React Query cache invalidation on data update via `sw-etl-updated` event
## Data Flow
- **Frontend auth state**: JWT stored in memory (apiClient.token), recovered from sessionStorage on page load
- **Frontend UI state**: React Query cache (staleTime=5min in dev/HTTP, Infinity with Service Worker)
- **Frontend filters**: FilterContext (global mutable state, causes re-renders on change)
- **Frontend permissions**: PermissionContext (user role, cached org/salesman/team hierarchy)
- **Server-side caching**: Query cache (per-SQL with optional TTL), Parquet fingerprint cache (5min TTL), snapshot path cache (5min TTL)
## Key Abstractions
- Purpose: Unified policy/premium fact table with all business dimensions and metrics
- Location: `server/src/services/duckdb-materialization.ts` (creation), views as `PolicyFact` or `PolicyFactRealtime` (fallback)
- Scope: All in-force commercial insurance policies (excludes motorcycle, trailer)
- Columns: 42 normalized fields (policy_no, insurance_start_date, premium, claims, org_level_3, salesman_name, customer_category, etc.)
- Computed: earned_exposure, earned_premium, earned_loss_ratio, is_cross_sell, insurance_grade
- Used by: 15+ query routes
- Purpose: Encapsulate common WHERE clause patterns
- Location: `server/src/sql/sql-builder.ts`
- Functions: `buildOrgFilter()`, `buildDateRangeFilter()`, `buildCustomerCategoryFilter()`, etc.
- Pattern: All generator functions construct SQL string with parameterized values (no direct string interpolation)
- Security: SQL injection prevented via `sanitizeTableName()`, `escapeSqlValue()` utilities
- Purpose: Handle different data slicing perspectives (org level 1/2/3, salesman, team, combined, etc.)
- Location: `server/src/sql/perspective-adapter.ts`
- Pattern: Given `perspective` parameter, transforms GROUP BY clause to use appropriate dimension
- Used by: Performance, coefficient, growth, KPI queries
- Purpose: Generate deterministic cache keys for snapshot/query cache based on route + filters
- Location: `server/src/routes/query/shared.ts` → `buildRouteCacheKey()`
- Determinism: Sorted query params → SHA256 → first 12 chars
- Used by: Snapshot middleware, optional route-level caching
- Purpose: Abstract DuckDB operations for testability and dependency injection
- Location: `server/src/services/duckdb-types.ts`
- Methods: `query<T>()`, `exec()`, `dropRelationIfExists()`, `getRelationInfo()`
- Implementations: Real `DuckDBService`, mock implementations for testing
## Entry Points
- Location: `src/app/App.tsx`
- Triggers: Browser loads HTML, Vite resolves dependencies, React mounts to `#root` DOM element
- Responsibilities: Set up routing, providers (QueryClient, DataProvider, PermissionProvider, ThemeProvider), define page lazy-loading routes
- Initial load: Auth recovery from sessionStorage, permission check, conditional redirect to LoginPage
- Location: `server/src/app.ts`
- Triggers: `bun run dev:full` or Node.js process startup
- Responsibilities:
- Location: `数据管理/daily.mjs` (CLI) or `server/src/services/data-bootstrapper.ts` (programmatic)
- Triggers: Manual `node 数据管理/daily.mjs` or daily scheduled job (ETL)
- Responsibilities: Discover Parquet files, deduplicate, validate, load to DuckDB, materialize derived tables, sync to VPS
## Error Handling
## Cross-Cutting Concerns
- Frontend: `Logger` class with module namespace (e.g., `new Logger('DataContext')`)
- Backend: `console.log` with structured prefixes (`[Server]`, `[DuckDB]`, `[Auth]`)
- Audit: Dedicated middleware (`server/src/middleware/audit.ts`) logs all authenticated queries with user + endpoint
- Frontend: Zod schemas for user input (filters, file uploads)
- Backend: Schema validation at route entry, DuckDB type conversion
- Parquet loading: Schema contract pattern - unknown fields cause `sys.exit(1)` in ETL
- JWT tokens signed with `process.env.JWT_SECRET`
- Token expiry: 1 day (configurable)
- Session recovery: JWT read from sessionStorage on frontend init
- Role-based access control: 3 levels (branch_admin > regional_manager > salesman)
- SQL injection: Parameterized queries, table name sanitization
- XSS: No hardcoded HTML, CSP headers configured
- CSRF: SameSite=Strict cookies (not explicitly set, relies on JWT)
- Rate limiting: 3-tier (general 100/min, login 5/min, query 30/min, AI 10/min)
- Secrets: All API keys in environment variables, never committed
- **Static snapshots**: 9 high-frequency bundles pre-computed daily
- **Service Worker**: Stale-while-revalidate strategy, 0ms cached responses
- **DuckDB**: Materialized PolicyFact (pre-indexed), connection pooling (max 10), Parquet fingerprinting for change detection
- **Query caching**: Optional result cache with configurable TTL
- **HTTP compression**: gzip enabled for >1KB responses
- **Lazy loading**: Page components loaded on-demand (React.lazy + Suspense)
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| autoplan | \| Auto-review pipeline — reads the full CEO, design, eng, and DX review skills from disk and runs them sequentially with auto-decisions using 6 decision principles. Surfaces taste decisions (close approaches, borderline scope, codex disagreements) at a final approval gate. One command, fully reviewed plan out. Use when asked to "auto review", "autoplan", "run all reviews", "review this plan automatically", or "make the decisions for me". Proactively suggest when the user has a plan file and wants to run the full review gauntlet without answering 15-30 intermediate questions. (gstack) Voice triggers (speech-to-text aliases): "auto plan", "automatic review". | `.claude/skills/autoplan/SKILL.md` |
| benchmark | \| Performance regression detection using the browse daemon. Establishes baselines for page load times, Core Web Vitals, and resource sizes. Compares before/after on every PR. Tracks performance trends over time. Use when: "performance", "benchmark", "page speed", "lighthouse", "web vitals", "bundle size", "load time". | `.claude/skills/benchmark/SKILL.md` |
| boris-workflow | > Boris Cherny 工作流元技能 - AI 协作的顶级实践框架。 基于 Claude Code 创建者 Boris Cherny 的方法论，提供心法检查、挑衅式 Prompt 模板、项目配置诊断。 Use when 开始新任务需要检查是否遵循最佳实践，需要挑衅式审查代码/方案， 需要诊断项目 Claude 配置是否完整，或想要学习/应用 Boris 工作流。 适用于: (1) 任务开始前的心法检查 (2) 代码/方案完成后的挑衅审查 (3) 新项目的配置诊断 (4) 工作流优化建议 (5) 卡住时的重规划引导 | `.claude/skills/boris-workflow-skill/SKILL.md` |
| canary | \| Post-deploy canary monitoring. Watches the live app for console errors, performance regressions, and page failures using the browse daemon. Takes periodic screenshots, compares against pre-deploy baselines, and alerts on anomalies. Use when: "monitor deploy", "canary", "post-deploy check", "watch production", "verify deploy". | `.claude/skills/canary/SKILL.md` |
| checkpoint | \| Save and resume working state checkpoints. Captures git state, decisions made, and remaining work so you can pick up exactly where you left off — even across Conductor workspace handoffs between branches. Use when asked to "checkpoint", "save progress", "where was I", "resume", "what was I working on", or "pick up where I left off". Proactively suggest when a session is ending, the user is switching context, or before a long break. (gstack) | `.claude/skills/checkpoint/SKILL.md` |
| open-gstack-browser | \| Launch GStack Browser — AI-controlled Chromium with the sidebar extension baked in. Opens a visible browser window where you can watch every action in real time. The sidebar shows a live activity feed and chat. Anti-bot stealth built in. Use when asked to "open gstack browser", "launch browser", "connect chrome", "open chrome", "real browser", "launch chrome", "side panel", or "control my browser". Voice triggers (speech-to-text aliases): "show me the browser". | `.claude/skills/connect-chrome/SKILL.md` |
| continuous-learning-v2 | Instinct-based learning system that observes sessions via hooks, creates atomic instincts with confidence scoring, and evolves them into skills/commands/agents. | `.claude/skills/continuous-learning-v2/SKILL.md` |
| cso | \| Chief Security Officer mode. Infrastructure-first security audit: secrets archaeology, dependency supply chain, CI/CD pipeline security, LLM/AI security, skill supply chain scanning, plus OWASP Top 10, STRIDE threat modeling, and active verification. Two modes: daily (zero-noise, 8/10 confidence gate) and comprehensive (monthly deep scan, 2/10 bar). Trend tracking across audit runs. Use when: "security audit", "threat model", "pentest review", "OWASP", "CSO review". (gstack) Voice triggers (speech-to-text aliases): "see-so", "see so", "security review", "security check", "vulnerability scan", "run security". | `.claude/skills/cso/SKILL.md` |
| design-html | \| Design finalization: generates production-quality Pretext-native HTML/CSS. Works with approved mockups from /design-shotgun, CEO plans from /plan-ceo-review, design review context from /plan-design-review, or from scratch with a user description. Text actually reflows, heights are computed, layouts are dynamic. 30KB overhead, zero deps. Smart API routing: picks the right Pretext patterns for each design type. Use when: "finalize this design", "turn this into HTML", "build me a page", "implement this design", or after any planning skill. Proactively suggest when user has approved a design or has a plan ready. (gstack) Voice triggers (speech-to-text aliases): "build the design", "code the mockup", "make it real". | `.claude/skills/design-html/SKILL.md` |
| design-shotgun | \| Design shotgun: generate multiple AI design variants, open a comparison board, collect structured feedback, and iterate. Standalone design exploration you can run anytime. Use when: "explore designs", "show me options", "design variants", "visual brainstorm", or "I don't like how this looks". Proactively suggest when the user describes a UI feature but hasn't seen what it could look like. (gstack) | `.claude/skills/design-shotgun/SKILL.md` |
| devex-review | \| Live developer experience audit. Uses the browse tool to actually TEST the developer experience: navigates docs, tries the getting started flow, times TTHW, screenshots error messages, evaluates CLI help text. Produces a DX scorecard with evidence. Compares against /plan-devex-review scores if they exist (the boomerang: plan said 3 minutes, reality says 8). Use when asked to "test the DX", "DX audit", "developer experience test", or "try the onboarding". Proactively suggest after shipping a developer-facing feature. (gstack) Voice triggers (speech-to-text aliases): "dx audit", "test the developer experience", "try the onboarding", "developer experience test". | `.claude/skills/devex-review/SKILL.md` |
| github-to-skills | Automated factory for converting GitHub repositories into specialized AI skills. Use this skill when the user provides a GitHub URL and wants to "package", "wrap", or "create a skill" from it. It automatically fetches repository details, latest commit hashes, and generates a standardized skill structure with enhanced metadata suitable for lifecycle management. | `.claude/skills/github-to-skills/SKILL.md` |
| gstack | \| Fast headless browser for QA testing and site dogfooding. Navigate any URL, interact with elements, verify page state, diff before/after actions, take annotated screenshots, check responsive layouts, test forms and uploads, handle dialogs, and assert element states. ~100ms per command. Use when you need to test a feature, verify a deployment, dogfood a user flow, or file a bug with evidence. | `.claude/skills/gstack/SKILL.md` |
| health | \| Code quality dashboard. Wraps existing project tools (type checker, linter, test runner, dead code detector, shell linter), computes a weighted composite 0-10 score, and tracks trends over time. Use when: "health check", "code quality", "how healthy is the codebase", "run all checks", "quality score". (gstack) | `.claude/skills/health/SKILL.md` |
| json-canvas | Create and edit JSON Canvas files (.canvas) with nodes, edges, groups, and connections. Use when working with .canvas files, creating visual canvases, mind maps, flowcharts, or when the user mentions Canvas files in Obsidian. | `.claude/skills/json-canvas/SKILL.md` |
| land-and-deploy | \| Land and deploy workflow. Merges the PR, waits for CI and deploy, verifies production health via canary checks. Takes over after /ship creates the PR. Use when: "merge", "land", "deploy", "merge and verify", "land it", "ship it to production". | `.claude/skills/land-and-deploy/SKILL.md` |
| learn | \| Manage project learnings. Review, search, prune, and export what gstack has learned across sessions. Use when asked to "what have we learned", "show learnings", "prune stale learnings", or "export learnings". Proactively suggest when the user asks about past patterns or wonders "didn't we fix this before?" | `.claude/skills/learn/SKILL.md` |
| obsidian-bases | Create and edit Obsidian Bases (.base files) with views, filters, formulas, and summaries. Use when working with .base files, creating database-like views of notes, or when the user mentions Bases, table views, card views, filters, or formulas in Obsidian. | `.claude/skills/obsidian-bases/SKILL.md` |
| obsidian-markdown | Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and other Obsidian-specific syntax. Use when working with .md files in Obsidian, or when the user mentions wikilinks, callouts, frontmatter, tags, embeds, or Obsidian notes. | `.claude/skills/obsidian-markdown/SKILL.md` |
| pair-agent | \| Pair a remote AI agent with your browser. One command generates a setup key and prints instructions the other agent can follow to connect. Works with OpenClaw, Hermes, Codex, Cursor, or any agent that can make HTTP requests. The remote agent gets its own tab with scoped access (read+write by default, admin on request). Use when asked to "pair agent", "connect agent", "share browser", "remote browser", "let another agent use my browser", or "give browser access". (gstack) Voice triggers (speech-to-text aliases): "pair agent", "connect agent", "share my browser", "remote browser access". | `.claude/skills/pair-agent/SKILL.md` |
| plan-devex-review | \| Interactive developer experience plan review. Explores developer personas, benchmarks against competitors, designs magical moments, and traces friction points before scoring. Three modes: DX EXPANSION (competitive advantage), DX POLISH (bulletproof every touchpoint), DX TRIAGE (critical gaps only). Use when asked to "DX review", "developer experience audit", "devex review", or "API design review". Proactively suggest when the user has a plan for developer-facing products (APIs, CLIs, SDKs, libraries, platforms, docs). (gstack) Voice triggers (speech-to-text aliases): "dx review", "developer experience review", "devex review", "devex audit", "API design review", "onboarding review". | `.claude/skills/plan-devex-review/SKILL.md` |
| plans-manager | 扫描、判定、归档 .claude/plans 计划文件，并生成轻量状态快照（STATUS_SNAPSHOT.md/json），以减少全文搜索与 token 消耗。 | `.claude/skills/plans-manager/SKILL.md` |
| security-review | Use this skill when adding authentication, handling user input, working with secrets, creating API endpoints, or implementing payment/sensitive features. Provides comprehensive security checklist and patterns. | `.claude/skills/security-review/SKILL.md` |
| setup-deploy | \| Configure deployment settings for /land-and-deploy. Detects your deploy platform (Fly.io, Render, Vercel, Netlify, Heroku, GitHub Actions, custom), production URL, health check endpoints, and deploy status commands. Writes the configuration to CLAUDE.md so all future deploys are automatic. Use when: "setup deploy", "configure deployment", "set up land-and-deploy", "how do I deploy with gstack", "add deploy config". | `.claude/skills/setup-deploy/SKILL.md` |
| Skill Evolution Manager | 专门用于在对话结束时，根据用户反馈和对话内容总结优化并迭代现有 Skills 的核心工具。它通过吸取对话中的“精华”（如成功的解决方案、失败的教训、特定的代码规范）来持续演进 Skills 库。 | `.claude/skills/skill-evolution-manager/SKILL.md` |
| skill-manager | Lifecycle manager for GitHub-based skills. Use this to batch scan your skills directory, check for updates on GitHub, and perform guided upgrades of your skill wrappers. | `.claude/skills/skill-manager/SKILL.md` |
| tdd-workflow | Use this skill when writing new features, fixing bugs, or refactoring code. Enforces test-driven development with 80%+ coverage including unit, integration, and E2E tests. | `.claude/skills/tdd-workflow/SKILL.md` |
| verification-loop |  | `.claude/skills/verification-loop/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
