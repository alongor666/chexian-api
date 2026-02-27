# 车险数据分析平台（chexian-api）

一个面向车险经营场景的前后端分离分析平台。  
当前为 **API-only 架构**：前端通过 REST API 访问后端 DuckDB（不再使用 DuckDB-WASM 本地模式）。

---

## 项目简介

`chexian-api` 聚焦车险业务的经营分析与数据查询，核心能力包括：

- Parquet 数据导入、加载与管理
- 经营看板（KPI、趋势、排名、结构占比）
- 多专题分析（业绩、交叉销售、续保、增长、成本、系数、营销战报、保费报表、费用分析）
- SQL 查询工作台（模板、可视化构建器、AI 辅助）
- 用户认证、路由权限和行级数据权限控制

代码事实入口：

- 前端入口：`src/app/main.tsx`、`src/app/App.tsx`
- API 客户端：`src/shared/api/client.ts`
- 后端入口：`server/src/app.ts`
- 查询路由：`server/src/routes/query.ts`
- DuckDB 服务：`server/src/services/duckdb.ts`

---

## 技术栈

> 依据 `package.json`（根目录）与 `server/package.json`（后端子项目）整理。

### 前端与构建（根 `package.json`）

- 框架：React 19 + TypeScript + Vite 5
- 路由：`react-router-dom`（`HashRouter`）
- 图表：`echarts` + `echarts-for-react`，`recharts`
- 编辑器：`@monaco-editor/react`
- 表单/选择：`react-select`、`react-datepicker`
- 大数据列表：`react-window`
- 导出能力：`exceljs`、`jspdf`、`jspdf-autotable`、`html2canvas`
- 工具与类型：`zod`、`date-fns`、`clsx`、`tailwind-merge`
- 样式体系：Tailwind CSS + 项目内共享样式层（`src/shared/styles`）

### 后端与数据引擎（`server/package.json`）

- 运行时服务：Express 4 + TypeScript
- 数据引擎：`@duckdb/node-api`
- 认证与安全：`jsonwebtoken`、`bcrypt`、`helmet`、`express-rate-limit`、`cors`
- 文件上传：`multer`
- 参数校验：`zod`

### 测试与质量保障

- 单元/集成：Vitest
- 组件测试：Testing Library（React）
- E2E：Playwright
- 治理与规范检查：`scripts/check-governance.mjs`

---

## 架构概览

```text
Browser (React + Vite)
  └─ /api/* (JWT / Cookie Session)
      └─ Express API (server/src/app.ts)
          ├─ /api/auth         登录/刷新/用户角色管理
          ├─ /api/auth/wecom   企业微信扫码登录
          ├─ /api/data         Parquet 文件管理与加载
          ├─ /api/filters      筛选器选项
          ├─ /api/query        业务分析查询（SQL 生成器）
          └─ /api/ai           NL2SQL/趋势解读
               └─ DuckDB (@duckdb/node-api)
                   └─ Parquet + PolicyFact 视图
```

关键实现特征：

- 启动时后端自动扫描候选数据目录并加载最新 Parquet，创建 `PolicyFact` 视图。
- 查询侧使用 SQL 生成器（`server/src/sql/*.ts`）+ 权限过滤注入，避免前端拼接业务 SQL。
- 高频接口提供查询缓存与 bundle 聚合端点，减少前端并发请求压力。

---

## 项目结构总览

```text
chexian-api/
├── src/                         # 前端应用
│   ├── app/                     # 入口与路由
│   ├── features/                # 业务功能模块（dashboard/cost/growth/...）
│   ├── components/              # 布局与页面容器
│   ├── widgets/                 # 图表/表格/KPI 等复用组件
│   ├── shared/                  # API/上下文/样式/工具/类型
│   └── services/                # 前端服务（如导出）
├── server/                      # 后端子项目
│   ├── src/app.ts               # 服务入口
│   ├── src/routes/              # auth/query/data/filters/ai/wecom-auth
│   ├── src/services/            # duckdb/auth/permission/wecom 等
│   ├── src/sql/                 # 各分析模块 SQL 生成器
│   ├── src/middleware/          # auth/permission/rate-limit/audit/error
│   └── data/                    # 本地数据目录（含 current）
├── scripts/                     # 启动、治理、任务与诊断脚本
├── tests/                       # Vitest + Playwright 测试
├── deploy/                      # 部署与数据同步脚本
├── 数据管理/                     # 数据处理与知识库
└── 开发文档/                     # 规范、索引与治理文档
```

---

## 安装与启动

### 1. 环境要求

- Bun（推荐，日常命令默认使用 Bun）
- Node.js（建议 18+）
- Python 3（用于部分数据脚本，可选）

### 2. 安装依赖

在仓库根目录执行：

```bash
bun install
cd server && bun install && cd ..
```

### 3. 配置环境变量

```bash
cp .env.example .env.local
cp server/.env.example server/.env
```

可选 AI 相关配置见根目录 `.env.example`（OpenRouter / 智谱）。

### 4. 启动开发环境（前后端一起）

```bash
bun run dev:full
```

默认地址：

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:3000/health`

### 5. 数据准备

可通过两种方式启用数据：

- 进入首页“数据导入”上传 `.parquet`
- 将数据放入候选目录（后端会自动扫描）：
  - `数据管理/warehouse/fact/policy/current`
  - `server/data/current`

---

## 根项目脚本（来自 `package.json`）

| 脚本 | 命令 | 说明 |
|---|---|---|
| `start` | `node scripts/start.mjs` | 启动器（默认前端） |
| `start:dev` | `node scripts/start.mjs --dev` | 启动前端开发服务器 |
| `start:server` | `node scripts/start.mjs --server` | 仅启动后端 |
| `start:all` | `node scripts/start.mjs --all` | 同时启动前后端 |
| `dev` | `vite` | 前端开发模式 |
| `dev:full` | `node scripts/start.mjs --all` | 推荐：全栈开发启动 |
| `build` | `NODE_OPTIONS='--max-old-space-size=4096' vite build` | 生产构建 |
| `build:analyze` | `NODE_OPTIONS='--max-old-space-size=4096' vite build --mode analyze` | 构建分析模式 |
| `typecheck` | `node scripts/typecheck.mjs` | 类型检查 |
| `preview` | `vite preview` | 预览构建产物 |
| `test` | `vitest` | 单元/集成测试 |
| `test:coverage` | `vitest --coverage` | 覆盖率 |
| `test:e2e` | `playwright test` | E2E 自动化测试 |
| `test:e2e:cleanup-gate` | `playwright test tests/e2e/03-cleanup-zero-downtime-gate.spec.ts` | 指定 E2E 场景 |
| `test:e2e:ui` | `playwright test --ui` | Playwright UI 模式 |
| `test:burn-down` | `node scripts/test-burn-down.mjs` | 测试债务燃尽报告 |
| `benchmark:key-routes` | `node scripts/benchmark-key-routes.mjs` | 关键路由性能压测 |
| `governance` | `node scripts/check-governance.mjs` | 治理一致性检查 |
| `plans:manage` | `node scripts/manage-plans.mjs` | plans 状态管理 |
| `hooks:install` | `bash scripts/install-git-hooks.sh` | 安装 Git hooks |

补充：后端子项目自身脚本见 `server/package.json`（`dev/build/start/test/lint`）。

---

## 关键功能（基于代码分析）

### 1) 数据接入与管理

- 支持 Parquet 上传、加载、删除、下载、元信息查询（`/api/data/*`）。
- 启动期自动加载数据并创建 `PolicyFact` 视图。
- 数据上下文固定 API 模式（`DataContext` 中 `dataSource: 'api'`）。

### 2) 多主题经营分析 API

`/api/query/*` 已实现高覆盖业务分析接口，包含：

- Dashboard：`kpi`、`kpi-detail`、`trend`、`dashboard-bundle`
- 业绩分析：`performance-summary/trend/drilldown/top-salesman/bundle`
- 交叉销售：`cross-sell`、`cross-sell-summary`、`cross-sell-trend`、`cross-sell-bundle`、`cross-sell-org-trend`
- 成本与费用：`cost`、`fee-analysis`
- 续保：`renewal`、`renewal-drilldown`
- 其他：`growth`、`coefficient`、`truck`、`salesman-ranking`、`marketing-report`、`premium-report`、`premium-plan`、`plan-achievement`

### 3) SQL 工作台

- 预置模板库 + 参数化 SQL
- 可视化查询构建器（维度/度量/筛选）
- 查询结果展示与导出
- 只读 SQL 安全校验（禁止写入/明细泄露/越界访问）

### 4) 认证、权限与安全

- 账号密码登录 + refresh + logout（支持 Cookie 会话）
- 企业微信 OAuth 登录（`/api/auth/wecom/*`）
- 路由级权限 + 行级数据过滤（管理员/机构用户/电销用户）
- 安全中间件：Helmet、限流、审计日志、上传安全校验（文件类型/路径遍历防护）

### 5) AI 辅助能力

- NL2SQL（后端生成并可选执行，执行前做 SQL 安全检查）
- 机构趋势 AI 解读（OpenRouter 主路由 + 智谱兜底 + 缓存）

### 6) 性能与稳定性

- DuckDB 连接池 + 查询缓存 + 慢查询监控
- 高频查询聚合为 bundle 接口，支持路由级缓存
- 启动器可自动清理开发端口冲突并检查端口可用性

---

## 常用开发命令

```bash
# 全栈开发
bun run dev:full

# 测试与治理
bun run test
bun run governance

# 构建与预览
bun run build
bun run preview
```

---

## 相关文档

- 架构规范：[`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 技术栈说明：[`开发文档/TECH_STACK.md`](./开发文档/TECH_STACK.md)
- 开发约定：[`开发文档/DEVELOPER_CONVENTIONS.md`](./开发文档/DEVELOPER_CONVENTIONS.md)
- 部署指南：[`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)
- 后端说明：[`server/README.md`](./server/README.md)
- 治理脚本索引：[`scripts/INDEX.md`](./scripts/INDEX.md)
