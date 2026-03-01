# 车险数据分析平台（chexian-api）

面向车险经营分析场景的前后端分离系统，前端通过 REST API 访问后端 DuckDB 引擎，基于 Parquet 数据提供经营看板、专题分析、权限控制与 AI 辅助分析能力。

## 项目简介

`chexian-api` 是一个以 API 为核心的数据分析平台，覆盖以下业务能力：

- 车险经营看板：KPI、趋势、结构占比、排名
- 专题分析：交叉销售、续保、增长、成本、费用、系数、营销战报、保费计划
- 数据接入：Parquet 上传/加载/切换
- 权限体系：认证、路由权限、行级数据过滤
- AI 能力：NL2SQL、趋势解读

当前架构为 **API-only**（非 DuckDB-WASM 本地模式），前端数据状态由后端数据加载结果驱动。

## 项目结构与主要代码文件

```text
chexian-api/
├── src/                              # 前端应用（React + TS）
│   ├── app/
│   │   ├── main.tsx                  # 前端入口
│   │   └── App.tsx                   # 根组件
│   ├── features/                     # 业务页面与专题模块
│   ├── widgets/                      # 图表/表格/KPI 复用组件
│   ├── components/                   # 布局与页面级组件
│   └── shared/
│       ├── api/client.ts             # 前端 API 客户端
│       ├── contexts/DataContext.tsx  # 数据上下文（固定 API 模式）
│       ├── styles/index.ts           # 共享样式系统
│       └── utils/                    # 公共工具函数
├── server/                           # 后端服务（Express + DuckDB）
│   ├── src/app.ts                    # 后端入口，注册中间件与路由
│   ├── src/routes/                   # 路由层（auth/query/data/filters/ai）
│   ├── src/services/duckdb.ts        # DuckDB 初始化与查询服务
│   ├── src/sql/                      # SQL 生成器（按业务主题拆分）
│   ├── src/middleware/               # 认证、权限、审计、限流、错误处理
│   └── src/normalize/                # 字段映射与校验
├── tests/                            # Vitest 单元/集成测试与 Playwright E2E
├── scripts/                          # 启动、治理、性能、诊断脚本
├── deploy/                           # 部署与数据同步脚本
├── 数据管理/                          # 数据处理流程与知识库
└── 开发文档/                          # 架构、规范、索引、治理文档
```

### 关键入口

- 前端入口：[src/app/main.tsx](./src/app/main.tsx)
- 前端根组件：[src/app/App.tsx](./src/app/App.tsx)
- API 客户端：[src/shared/api/client.ts](./src/shared/api/client.ts)
- 数据上下文：[src/shared/contexts/DataContext.tsx](./src/shared/contexts/DataContext.tsx)
- 后端入口：[server/src/app.ts](./server/src/app.ts)
- 查询路由：[server/src/routes/query.ts](./server/src/routes/query.ts)
- DuckDB 服务：[server/src/services/duckdb.ts](./server/src/services/duckdb.ts)

## 技术栈

基于根目录 `package.json` 与 `server/package.json` 分析。

### 前端

- React 19
- TypeScript 5
- Vite 5
- React Router (`react-router-dom`)
- ECharts (`echarts`, `echarts-for-react`) / Recharts
- Tailwind CSS（配合 `src/shared/styles` 样式层）

### 后端

- Node.js + Express 4
- TypeScript
- DuckDB Node API (`@duckdb/node-api`)
- Zod（参数/数据校验）
- 安全与治理：Helmet、CORS、express-rate-limit、审计中间件
- 认证：JWT + bcrypt

### 测试与工程化

- Vitest（单元/集成）
- Testing Library（React 组件测试）
- Playwright（E2E）
- Bun 作为默认执行器
- 治理脚本：`scripts/check-governance.mjs`

## 安装步骤

### 1. 环境要求

- Bun（推荐）
- Node.js 18+
- 可选：Python 3（数据处理脚本）

### 2. 安装依赖

```bash
bun install
cd server && bun install && cd ..
```

### 3. 配置环境变量

```bash
cp .env.example .env.local
# 如需要后端单独环境文件，请按 server 目录 README 配置
```

## 使用说明

### 启动开发环境（前后端）

```bash
bun run dev:full
```

默认端口：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3000`
- 健康检查：`http://localhost:3000/health`

### 常用命令

```bash
# 前端开发
bun run dev

# 后端开发（通过统一启动脚本）
bun run start:server

# 构建与预览
bun run build
bun run preview

# 测试
bun run test
bun run test:coverage
bun run test:e2e

# 治理检查
bun run governance
```

### 数据加载

- 方式 1：通过页面上传 `.parquet`
- 方式 2：将数据放入候选目录（后端启动时自动扫描）

说明：平台在 API 模式下以“后端是否已加载数据”作为可用性判定依据。

## 部署与运维

- 部署指南：[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- VPS 运维手册：[vps.md](./vps.md)
- 数据同步脚本：[deploy/sync-data.sh](./deploy/sync-data.sh)

## 相关文档

- 架构文档：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 技术栈说明：[开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)
- 开发约定：[开发文档/DEVELOPER_CONVENTIONS.md](./开发文档/DEVELOPER_CONVENTIONS.md)
- 后端说明：[server/README.md](./server/README.md)
- 测试指南：[TESTING_GUIDE.md](./TESTING_GUIDE.md)

