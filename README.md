# 车险数据分析平台（chexian-api）

> 面向车险经营分析的 API-only 数据平台：React 客户端 + Express REST API + DuckDB native 后端。
> 当前系统不包含浏览器 DuckDB-WASM / Local 模式，前端所有数据访问都通过 `/api/*`。
> 519+ commits | 97 API 端点 | 15 数据域 | 35 SQL 生成器 | 77 测试文件

## 1) 项目概述

项目聚焦车险业务数据的经营分析、管理与决策支持，核心能力包括：

- **经营看板**：KPI 总览、保费趋势、结构分析、机构排名
- **专题分析**：增长分析、成本分析、续保漏斗、交叉销售、报价转化、费用发展趋势、赔案明细、客户流向、维修资源
- **保费管理**：保费计划达成、保费报表、营销战报
- **数据治理**：15 域 ETL 管道、分片架构、字段/指标注册表、21 项治理检查
- **权限与安全**：RBAC + 行级数据过滤、企业微信 SSO、三级限流
- **AI 能力**：趋势解读（OpenRouter 主路由 + 智谱兜底）

### 前端页面

| 页面 | 路由 | 说明 |
|------|------|------|
| 经营仪表盘 | `/dashboard` | KPI + 趋势 + 排名 + 结构 |
| 业绩分析 | `/performance-analysis` | 业务员/机构绩效 + 热力图 |
| 增长分析 | `/growth` | 同比/环比 + 机构对比 |
| 成本分析 | `/cost` | 综合成本率 + 赔付 + 费用（含综合分析视图） |
| 系数分析 | `/coefficient` | 自主定价系数分布 + 趋势 |
| 保费达成 | `/reports` | 保费计划达成 + 保费报表 + 营销战报 |
| 专项分析 | `/specialty` | 驾意险交叉销售 + 续保 + 货车（Tab 合并） |
| 赔案明细 | `/claims-detail` | 赔案下钻 + 品牌车型 |
| 数据导入 | `/data-import` | Parquet 文件上传与管理 |
| 权限管理 | `/admin/access-control` | 用户/角色/权限配置 |

## 2) 技术栈

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19 | UI 框架 |
| TypeScript | 5.9 | 类型安全 |
| Vite | 5.4 | 构建工具 |
| ECharts | 5.6 | 图表可视化 |
| TanStack Query | 5 | 数据请求与缓存 |
| Tailwind CSS | 3.4 | 样式系统（配合语义设计令牌） |
| Zod | 4.3 | 类型与参数校验 |
| React Router | 7 | 路由管理 |

### 后端

| 技术 | 用途 |
|------|------|
| Express 4 + TypeScript | API 服务框架 |
| DuckDB native (`@duckdb/node-api`) | 后端 Node.js 进程内列式分析引擎 |
| jsonwebtoken + bcrypt | JWT 认证 |
| helmet + express-rate-limit + cors | 安全中间件 |
| multer | 文件上传 |

### 工程化

| 工具 | 用途 |
|------|------|
| Bun | 包管理与运行时 |
| Vitest | 单元/集成测试 |
| Playwright 1.58 | E2E 测试 |
| GitHub Actions | CI/CD（6 条 pipeline） |
| 治理检查 | 21 项自动校验 |

## 3) 目录结构

```text
chexian-api/
├── src/                             # 前端应用
│   ├── app/                         #   应用入口、路由、布局
│   ├── features/                    #   22 个业务功能模块
│   │   ├── dashboard/               #     经营仪表盘
│   │   ├── cost/                    #     成本分析 + 综合分析
│   │   ├── growth/                  #     增长分析 + 机构对比
│   │   ├── claims-detail/           #     赔案明细
│   │   ├── quote-conversion/        #     报价转化
│   │   └── ...                      #     （共 22 个模块）
│   ├── widgets/                     #   图表/表格/KPI 复用组件
│   ├── shared/                      #   API 客户端、上下文、样式、工具、类型
│   │   ├── api/                     #     API 路由定义 + HTTP 客户端
│   │   ├── styles/                  #     设计令牌系统（颜色/字体/间距/组件预设）
│   │   └── config/                  #     客户类别等前端配置
│   └── services/                    #   前端服务（导出等）
│
├── server/                          # 后端 API 服务
│   ├── src/
│   │   ├── app.ts                   #   启动入口（198 行，已拆分）
│   │   ├── routes/                  #   路由层
│   │   │   ├── query.ts             #     查询路由注册器
│   │   │   ├── query/               #     17 个查询子路由模块
│   │   │   ├── auth.ts              #     认证路由
│   │   │   ├── data.ts              #     数据管理路由
│   │   │   ├── ai.ts                #     AI 路由
│   │   │   ├── filters.ts           #     筛选器路由
│   │   │   └── wecom-auth.ts        #     企业微信路由
│   │   ├── services/                #   服务层（模块化拆分）
│   │   │   ├── duckdb.ts            #     查询执行（498 行）
│   │   │   ├── duckdb-infra.ts      #     连接与基础设施
│   │   │   ├── duckdb-domain-loaders.ts  # 分域数据加载
│   │   │   ├── duckdb-materialization.ts # 预聚合物化
│   │   │   ├── data-bootstrapper.ts #     数据启动流水线
│   │   │   ├── access-control.ts    #     权限控制
│   │   │   ├── route-cache.ts       #     路由级缓存
│   │   │   └── ...                  #     auth/wecom/openrouter/zhipu
│   │   ├── sql/                     #   35 个 SQL 生成器
│   │   ├── middleware/              #   认证、权限、限流、审计、异常
│   │   ├── config/                  #   配置中心
│   │   │   ├── metric-registry/     #     指标注册表（数量见 validate.ts）
│   │   │   ├── field-registry/      #     字段注册表（56 个字段）
│   │   │   ├── env.ts               #     环境变量（20+ 变量）
│   │   │   └── api-routes.ts        #     路由常量
│   │   └── normalize/               #   列映射与字段标准化（codegen 生成）
│   └── data/                        #   运行时数据目录
│
├── 数据管理/                         # 数据 ETL 管道
│   ├── daily.mjs                    #   智能增量 ETL 入口
│   ├── data-sources.json            #   15 域元数据注册表
│   ├── shard-config.json            #   分片配置
│   ├── pipelines/                   #   ETL 转换脚本（Python）
│   ├── warehouse/                   #   本地数据仓库
│   │   ├── fact/                    #     8 个事实域（policy/claims/quotes/...）
│   │   └── dim/                     #     7 个维度表（salesman/plan/brand/...）
│   └── knowledge/                   #   数据知识库
│
├── tests/                           # 测试（77 个文件）
│   ├── api/                         #   API 测试
│   ├── components/                  #   组件测试
│   ├── comprehensive/               #   综合分析测试
│   ├── e2e/                         #   E2E 测试（Playwright）
│   ├── integration/                 #   集成测试（需 DuckDB 原生）
│   └── shared/                      #   共享工具测试
│
├── scripts/                         # 37 个工程脚本
├── deploy/                          # VPS 部署（Nginx + PM2 + Docker）
├── .github/workflows/               # 6 条 CI/CD pipeline
├── 开发文档/                         # 架构、规范、索引
└── 数据管理/knowledge/               # 数据知识库
```

## 4) 主要 API 端点

后端默认端口 `3000`，统一前缀 `/api/*`。查询/数据/筛选/AI 端点默认需要认证与权限中间件。

### 健康检查

- `GET /health` — 服务健康状态

### 认证与账号（`/api/auth`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/refresh` | 刷新 Token |
| POST | `/api/auth/logout` | 登出 |
| GET/POST/PUT/DELETE | `/api/auth/users[/:id]` | 用户 CRUD |
| GET/POST/PUT/DELETE | `/api/auth/roles[/:role]` | 角色 CRUD |
| GET | `/api/auth/me` | 当前用户信息 |

### 企业微信（`/api/auth/wecom`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/wecom/config` | OAuth 配置 |
| GET | `/api/auth/wecom/callback` | OAuth 回调 |

### 数据管理（`/api/data`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/data/upload` | 上传 Parquet |
| GET | `/api/data/metadata` | 数据元信息 |
| GET | `/api/data/files` | 文件列表 |
| POST | `/api/data/load/:filename` | 加载文件 |
| GET | `/api/data/download/:filename` | 下载文件 |
| DELETE | `/api/data/clear` | 清空数据 |
| GET/PUT | `/api/data/kpi-plan-config` | 计划值配置 |

### 业务查询（`/api/query`）— 17 个子路由模块

| 模块 | 主要端点 | 路由文件 |
|------|----------|----------|
| KPI | `kpi`, `kpi-detail` | `query/kpi.ts` |
| 趋势 | `trend`, `quality-business-trend` | `query/trend.ts` |
| 增长 | `growth` | `query/growth.ts` |
| 系数 | `coefficient` | `query/coefficient.ts` |
| 成本 | `cost` | `query/cost.ts` |
| 综合分析 | `comprehensive-bundle`, `comprehensive-analysis-bundle` | `query/comprehensive.ts` |
| 续保 | `renewal`, `renewal-drilldown` | `query/renewal.ts` |
| 续保漏斗 | `renewal-funnel-*` | `query/renewal-funnel.ts` |
| 交叉销售 | `cross-sell`, `cross-sell-trend/summary/bundle/...` | `query/cross-sell.ts` |
| 业绩 | `performance-summary/trend/drilldown/bundle/...` | `query/performance.ts` |
| 报价转化 | `quote-conversion-*` | `query/quote-conversion.ts` |
| 赔案明细 | `claims-detail-*` | `query/claims-detail.ts` |
| 客户流向 | `customer-flow-*` | `query/customer-flow.ts` |
| 费用发展 | `expense-development` | `query/expense-development.ts` |
| 维修资源 | `repair-*` | `query/repair.ts` |
| 货车 | `truck` | `query/truck.ts` |
| 报表 | `marketing-report`, `premium-report/plan`, `dashboard-bundle` 等 | `query/report.ts` |

### 筛选器（`/api/filters`）

- `GET /api/filters/options` — 筛选器选项

### AI（`/api/ai`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/trend-analysis` | 趋势解读 |
| POST | `/api/ai/validate-key` | API Key 校验 |
| POST | `/api/ai/nl2sql` | NL2SQL（当前 410 关闭） |

## 5) 数据架构

当前运行时数据链路：

```text
React 页面/Hook
  → src/shared/api/client.ts
  → Express REST API (/api/*)
  → server/src/routes/* + server/src/sql/*
  → server/src/services/duckdb.ts
  → @duckdb/node-api（DuckDB native）
```

前端不直接执行 SQL，不加载 DuckDB-WASM，不再维护浏览器 Local 模式。

### 数据域注册表（11 个活跃域）

| 域 ID | 名称 | 类型 | 状态 |
|--------|------|------|------|
| premium | 保费 | fact | 活跃 — 350 万+ 行 |
| claims_detail | 赔案明细 | fact | 活跃 |
| cross_sell | 交叉销售 | fact | 活跃 |
| quotes_conversion | 报价转化 | fact | 活跃 |
| renewal_tracker | 续保追踪（派生域） | fact | 活跃 |
| customer_flow | 客户来源去向 | fact | 活跃 |
| salesman | 业务员 | dim | 活跃 |
| plan | 保费计划 | dim | 活跃 |
| brand | 品牌车型 | dim | 活跃 |
| plate_region | 车牌归属地 | dim | 活跃 |
| repair_resource | 维修资源 | dim | 活跃 |

### DuckDB 数据模型（4 层）

| 层级 | 表/视图 | 说明 |
|------|---------|------|
| **L1 原始层** | `raw_parquet` | 由上传文件或启动扫描加载 |
| **L2 事实视图** | `PolicyFact`, `RenewalTrackerFact`, `ClaimsDetail`, `QuoteConversion` | 统一字段口径，列映射由 `mapping.ts` 生成 |
| **L3 预聚合** | `DailyAggregated`, `PeriodAggregated`, `CrossSellDailyAgg`, `KpiDailySummary` | 性能核心，VPS 优先加载 |
| **L4 维度/权限** | `UserAccount`, `RoleConfig`, `KpiPlanConfig`, `SalesmanTeamMapping`, `achievement_cache` | 配置与权限 |

### VPS 模式

`VPS_MODE=true` 时，服务优先加载预聚合文件（`aggregated.parquet`、`cross_sell_agg.parquet`、`renewal_agg.parquet`），避免在 2C4G VPS 上全量扫描导致 OOM。

## 6) 配置与环境变量

### 环境文件

- 前端：`.env.example` → `.env.local`
- 后端：`server/.env.example` → `server/.env`

### 核心变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 后端端口 | `3000` |
| `NODE_ENV` | 运行环境 | `development` |
| `JWT_SECRET` | JWT 密钥 | `change-me-in-production` |
| `CORS_ORIGIN` | 允许的前端域名 | 开发环境 localhost 白名单 |
| `DUCKDB_PATH` | DuckDB 数据库路径 | `:memory:` |
| `DATA_PATH` | 数据目录 | `./data` |
| `DUCKDB_MAX_MEMORY` | DuckDB 内存上限 | `4GB` |
| `VPS_MODE` | VPS 预聚合模式 | `false` |
| `OPENROUTER_API_KEY` | AI 主路由 Key | — |
| `ZHIPU_API_KEY` | 智谱兜底 Key | — |
| `WECOM_CORP_ID` | 企业微信 ID（可选） | — |

完整变量列表见 `server/src/config/env.ts`（20+ 变量，6 个分组）。

## 7) 运行与部署

### 本地开发

```bash
# 安装依赖
bun install
cd server && bun install && cd ..

# 复制环境变量模板
cp .env.example .env.local
cp server/.env.example server/.env

# 同时启动前后端（推荐）
bun run dev:full
```

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://127.0.0.1:3000`
- 健康检查：`http://127.0.0.1:3000/health`

### 常用命令

```bash
bun run dev:full          # 前后端联调
bun run build             # 生产构建
bun run test              # 单元测试（Vitest）
bun run test:integration  # 集成测试（需本地 DuckDB 原生二进制）
bun run test:e2e          # E2E 测试（Playwright，需先 dev:full）
bun run test:coverage     # 覆盖率报告
bun run governance        # 21 项治理检查
bun run typecheck         # TypeScript 类型检查
bun run verify:quick      # 快速验证（preflight + governance + typecheck）
bun run verify:full       # 完整验证（quick + test）
```

### 数据处理与同步

```bash
# 智能增量 ETL
node 数据管理/daily.mjs

# 指定域强制处理
node 数据管理/daily.mjs premium|claims|quotes|all

# 维度表生成
python3 数据管理/warehouse/dim/generate_dim_tables.py

# 数据同步到 VPS
node scripts/sync-vps.mjs

# 预聚合导出并同步
node scripts/sync-vps.mjs --export
```

### 生产部署

- **VPS**：腾讯云 2C4G，PM2 进程管理 + Nginx 反向代理
- **部署脚本**：`deploy/vps-deploy.mjs`
- **PM2 操作**：`sudo /usr/local/bin/deploy-chexian-api reload|restart|install`
- **详细指南**：`deploy/DEPLOY_FULLSTACK.md`

### CI/CD Pipeline

| Workflow | 触发条件 | 说明 |
|----------|----------|------|
| `deploy.yml` | push main | 构建 → 部署 → 健康检查 |
| `governance-check.yml` | PR | 治理校验 |
| `production-gate.yml` | PR to main | 生产准入门禁 |
| `claude-code.yml` | @claude 评论 | Claude Code 自动处理（`@claude review` 显式触发 review） |
| `claude.yml` | @claude 评论/review | Claude 辅助 workflow（按需触发） |

> **注**：PR 后的自动 Claude code review 已下线（2026-05-17）——拖慢 CI 且产出价值低。改为**提交前由 Claude 自审 diff**，流程见 `.claude/commands/chexian-commit-push-pr.md` §3.4。需要二次审查时仍可在 PR 评论 `@claude review` 显式触发。

## 参考文档

| 文档 | 路径 |
|------|------|
| 架构规范 | `ARCHITECTURE.md` |
| 技术栈详情 | `开发文档/TECH_STACK.md` |
| Agent 化升级总览 | `docs/AGENTIC_UPGRADE.md` |
| 开发约定 | `开发文档/DEVELOPER_CONVENTIONS.md` |
| 数据知识库 | `数据管理/knowledge/` |
| 业务规则字典 | `数据管理/knowledge/rules/车险数据业务规则字典.md` |
| 指标字典 | `开发文档/指标字典.md` |
| 部署指南 | `deploy/DEPLOY_FULLSTACK.md` |
| 工程脚本索引 | `scripts/INDEX.md` |
