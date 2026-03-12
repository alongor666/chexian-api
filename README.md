# 车险数据分析平台（chexian-api）

`chexian-api` 是一个面向车险经营分析的前后端分离平台，采用 **纯 API 架构**：前端只通过 REST API 调用后端 DuckDB，不再使用 DuckDB-WASM 本地查询模式。

## 1) 项目概述和用途

项目聚焦车险业务数据的经营分析、管理与决策支持，核心用途包括：

- 统一接入 Parquet 数据并构建标准分析视图
- 提供经营看板（KPI、趋势、结构、排名）
- 提供专题分析（增长、成本、续保、交叉销售、营销战报、保费计划等）
- 提供认证、权限与行级数据过滤能力
- 支持 AI 趋势解读能力（OpenRouter 主路由 + 智谱兜底）

核心代码入口：

- 前端入口：`src/app/main.tsx`、`src/app/App.tsx`
- API 客户端：`src/shared/api/client.ts`
- 后端入口：`server/src/app.ts`
- 查询路由：`server/src/routes/query.ts`
- 数据引擎：`server/src/services/duckdb.ts`

## 2) 技术栈

### 前端

- React 19 + TypeScript 5
- Vite 5
- Tailwind CSS 3（配合 `src/shared/styles` 语义样式层）
- ECharts / Recharts
- Zod（类型与参数校验）

### 后端

- Express 4 + TypeScript
- DuckDB（`@duckdb/node-api`，服务端执行 SQL）
- 认证与安全：`jsonwebtoken`、`bcrypt`、`helmet`、`express-rate-limit`、`cors`
- 文件上传：`multer`

### 测试与工程化

- Vitest（单元/集成）
- Playwright（E2E）
- 治理检查：`scripts/check-governance.mjs`
- 默认包管理与执行器：**Bun**

## 3) 目录结构说明

```text
chexian-api/
├── src/                            # 前端应用
│   ├── app/                        # 应用入口与路由挂载
│   ├── features/                   # 业务功能模块
│   ├── widgets/                    # 图表/表格/KPI 等复用组件
│   ├── shared/                     # API、上下文、样式、工具、类型
│   └── services/                   # 前端服务（导出等）
├── server/                         # 后端 API 服务
│   ├── src/app.ts                  # 后端启动入口
│   ├── src/routes/                 # auth/data/query/filters/ai/wecom-auth
│   ├── src/services/               # duckdb/auth/permission/wecom 等
│   ├── src/sql/                    # SQL 生成器
│   ├── src/middleware/             # 认证、权限、限流、审计、异常
│   ├── src/config/                 # 配置与环境变量映射
│   ├── src/normalize/              # 列映射与字段标准化
│   └── data/                       # 本地数据目录（含 current）
├── tests/                          # API/组件/集成/E2E 测试
├── scripts/                        # 启动、治理、导出、压测等脚本
├── deploy/                         # VPS 部署与数据同步脚本
├── 数据管理/                        # 数据处理链路与知识库
├── 开发文档/                        # 架构、规范、索引、进展
└── README.md
```

## 4) 主要 API 端点

后端默认端口 `3000`，统一前缀为 `/api/*`。`/api/query`、`/api/data`、`/api/filters`、`/api/ai` 默认需要认证与权限中间件。

### 健康检查

- `GET /health`：服务健康状态

### 认证与账号管理（`/api/auth`）

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/users`
- `POST /api/auth/users`
- `PUT /api/auth/users/:id`
- `DELETE /api/auth/users/:id`
- `GET /api/auth/roles`
- `POST /api/auth/roles`
- `PUT /api/auth/roles/:role`
- `DELETE /api/auth/roles/:role`
- `GET /api/auth/me`

### 企业微信登录（`/api/auth/wecom`）

- `GET /api/auth/wecom/config`
- `GET /api/auth/wecom/callback`

### 数据管理（`/api/data`）

- `POST /api/data/upload`
- `GET /api/data/metadata`
- `DELETE /api/data/clear`
- `GET /api/data/files`
- `POST /api/data/load/:filename`
- `GET /api/data/download/:filename`
- `GET /api/data/kpi-plan-config`
- `PUT /api/data/kpi-plan-config`

### 筛选器（`/api/filters`）

- `GET /api/filters/options`

### AI（`/api/ai`）

- `POST /api/ai/nl2sql`（当前返回 410，功能关闭）
- `POST /api/ai/validate-key`
- `POST /api/ai/trend-analysis`

### 业务查询（`/api/query`）

- `GET /api/query/kpi`
- `GET /api/query/kpi-detail`
- `GET /api/query/trend`
- `GET /api/query/quality-business-trend`
- `GET /api/query/truck`
- `GET /api/query/growth`
- `GET /api/query/coefficient`
- `GET /api/query/cost`
- `GET /api/query/comprehensive-bundle`
- `GET /api/query/comprehensive-analysis-bundle`
- `GET /api/query/renewal`
- `GET /api/query/renewal-drilldown`
- `GET /api/query/cross-sell`
- `GET /api/query/cross-sell-trend`
- `GET /api/query/cross-sell-summary`
- `GET /api/query/cross-sell-top-salesman`
- `GET /api/query/cross-sell-bundle`
- `GET /api/query/cross-sell-org-trend`
- `GET /api/query/performance-summary`
- `GET /api/query/performance-trend`
- `GET /api/query/performance-drilldown`
- `GET /api/query/performance-top-salesman`
- `GET /api/query/performance-bundle`
- `GET /api/query/salesman-ranking`
- `GET /api/query/marketing-report`
- `GET /api/query/premium-report`
- `GET /api/query/premium-plan`
- `GET /api/query/plan-achievement`
- `GET /api/query/dashboard-bundle`
- `GET /api/query/fee-analysis`
- `POST /api/query/custom`

## 5) 配置和环境变量

### 环境文件

- 前端/根配置：`.env.example` → `.env.local`
- 后端配置：`server/.env.example` → `server/.env`

### 核心变量（后端）

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 后端端口 | `3000` |
| `NODE_ENV` | 运行环境 | `development` |
| `BIND_HOST` | 监听地址 | `127.0.0.1` |
| `JWT_SECRET` | JWT 密钥 | `change-me-in-production` |
| `JWT_EXPIRES_IN` | Access Token 有效期 | `4h` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh Token 有效期 | `7d` |
| `CORS_ORIGIN` | 允许的前端域名（逗号分隔） | 开发环境附带 localhost 白名单 |

### DuckDB/数据相关变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DUCKDB_PATH` | DuckDB 数据库路径 | `:memory:` |
| `DATA_PATH` | 数据目录 | `./data` |
| `DUCKDB_MAX_MEMORY` | DuckDB 内存上限 | `4GB` |
| `DUCKDB_THREADS` | DuckDB 线程数 | `4` |
| `VPS_MODE` | VPS 预聚合模式开关 | `false` |

### AI 相关变量

| 变量 | 说明 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter Key（主路由） |
| `AI_PRIMARY_MODEL` / `OPENROUTER_MODELS` | 模型降级链（逗号分隔） |
| `AI_PROVIDER_TIMEOUT_MS` | 单模型超时 |
| `AI_TREND_CACHE_TTL_MS` | 趋势解读缓存 TTL |
| `ZHIPU_API_KEY` / `VITE_ZHIPU_API_KEY` | 智谱兜底 Key |

### 企业微信变量（可选）

| 变量 | 说明 |
|---|---|
| `WECOM_CORP_ID` | 企业 ID |
| `WECOM_AGENT_ID` | 应用 ID |
| `WECOM_SECRET` | 应用 Secret |
| `WECOM_ADMIN_USERIDS` | 超级管理员白名单 |

## 6) 数据库模型（DuckDB）

本项目不使用 ORM，采用 DuckDB + SQL 生成器模式。数据模型分为 4 层：

### L1 原始层

- `raw_parquet`：由上传文件或启动扫描加载

### L2 事实视图层

- `PolicyFact`：统一字段口径后的主事实视图（由 `mapping.ts` 做中英文列映射）
- `PolicyFactRenewal`：续保下钻使用视图

`PolicyFact` 可用字段以业务规则文档为准，当前主用字段覆盖保单标识、日期、机构、业务员、险类、保费、续保/新能源/过户/电销标记、交叉销售、赔付和费用相关指标等（详见 `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md`）。

### L3 预聚合层（性能核心）

- `DailyAggregated`：日粒度聚合
- `PeriodAggregated`：月粒度聚合
- `CrossSellDailyAgg`：交叉销售聚合
- `KpiDailySummary`：KPI 轻量聚合
- `RenewalDailyAgg`：续保聚合（VPS 导入）

### L4 维度与权限层

- `UserAccount`、`RoleConfig`：账号与角色配置表
- `KpiPlanConfig`：计划值配置
- `SalesmanTeamMapping`、`SalesmanPlanFact`：业务员团队与计划映射
- `achievement_cache`：计划达成缓存表

### VPS 模式约束

`VPS_MODE=true` 时，服务优先加载预聚合文件（`aggregated.parquet`、`cross_sell_agg.parquet`、`renewal_agg.parquet`），避免在 2C4G VPS 上全量扫描原始明细导致内存风险。

## 7) 运行和部署方式

### 本地开发运行

```bash
# 安装依赖
bun install
cd server && bun install && cd ..

# 复制环境变量模板
cp .env.example .env.local
cp server/.env.example server/.env

# 推荐：同时启动前后端
bun run dev:full
```

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://127.0.0.1:3000`
- 健康检查：`http://127.0.0.1:3000/health`

### 常用命令

```bash
bun run test
bun run test:coverage
bun run governance
bun run build
bun run preview
```

### 数据处理与同步（本地 → VPS）

```bash
# 完整数据处理链（含可选同步）
./数据管理/run.sh full --source 历史数据.xlsx --target 最新数据.xlsx --output 数据管理/warehouse/fact/policy/xxx.parquet

# 仅同步最新 parquet
./scripts/sync-vps.mjs

# 预聚合导出并同步（推荐）
./scripts/sync-vps.mjs --export
```

### 生产部署

- 全量部署脚本：`deploy/vps-deploy.sh`
- 详细步骤：`DEPLOYMENT_GUIDE.md`
- 运维说明：`vps.md`

## 参考文档

- 架构：`ARCHITECTURE.md`
- 技术栈：`开发文档/TECH_STACK.md`
- 开发约定：`开发文档/DEVELOPER_CONVENTIONS.md`
- 后端说明：`server/README.md`
- 测试说明：`TESTING_GUIDE.md`
