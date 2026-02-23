# 车险数据分析平台（chexian-api）

**版本**: v2.8  
**最后更新**: 2026-02-20

> 车险经营分析平台（纯 API 架构）。前端通过 REST API 访问后端 DuckDB，不再包含 DuckDB-WASM / Local 模式分支。

## 最近变更（基于近期 Git 提交）

- **2026-02-20**: 新增企微扫码混合登录（用户名密码 + WeCom OAuth 回调）
  - 后端新增 `server/src/routes/wecom-auth.ts`、`server/src/services/wecom.ts`
  - 前端登录页新增企微扫码入口与 `wecom_token` 回调处理
- **2026-02-19**: 修复成本分析 API 与前端类型对齐问题
  - `server/src/routes/query.ts` 成本相关接口修复
  - `src/features/cost/` 新增/增强 `VariableCostKpiBoard`、类型与 Hook
- **2026-02-18**: 保费达成下钻功能上线
  - 新增 `GET /api/query/premium-plan`
  - `premium-report` 模块新增 Tab 切换与下钻分析
- **2026-02-19 ~ 2026-02-20**: 增补 E2E 验证产物与部署脚本增强（健康检查、VPS 发布流程）

## 项目概览

- 前端：React 19 + TypeScript + Vite（HashRouter）
- 后端：Express + `@duckdb/node-api`
- 数据：Parquet（后端自动加载最新文件并创建 `PolicyFact` 视图）
- 安全：JWT 认证、行级权限过滤、限流、审计日志
- 部署：`https://chexian.cretvalu.com`

## 当前架构

```text
Browser (React)
  └─ /api/* (Bearer Token)
      └─ Node.js/Express (server/src/app.ts)
          ├─ /api/auth          用户名密码登录 + Token 刷新
          ├─ /api/auth/wecom    企微 OAuth 配置与回调
          ├─ /api/data          文件上传/加载/下载/元信息
          ├─ /api/query         业务分析查询（SQL 生成器）
          ├─ /api/filters       筛选器选项
          └─ /api/ai            NL2SQL 与 API Key 验证
                └─ DuckDB 查询 Parquet
```

关键约束：

- 前端 `DataContext` 固定 `dataSource='api'`
- 业务查询统一走 `server/src/sql/*.ts`，前端不拼接 SQL
- 查询与筛选接口统一经过认证和权限注入（行级可见范围）

## 目录结构（当前）

```text
chexian-api/
├── src/                      # 前端应用
│   ├── app/                  # 应用入口与路由
│   ├── features/             # 业务功能（dashboard/cost/growth/premium-report/...）
│   ├── widgets/              # 通用图表/表格/KPI 组件
│   └── shared/               # API/Context/样式/工具/类型
├── server/                   # 后端 API
│   ├── src/app.ts            # 服务入口
│   ├── src/routes/           # auth/wecom-auth/query/data/filters/ai
│   ├── src/services/         # duckdb/auth/wecom/permission
│   ├── src/sql/              # 各分析模块 SQL 生成器
│   └── data/                 # Parquet 文件目录
├── tests/                    # Vitest 测试
├── scripts/                  # 启动、治理、计划管理脚本
├── deploy/                   # VPS 部署与数据同步脚本
├── 开发文档/                 # 索引、规范、治理文档
└── 数据管理/                 # 数据知识库与数据管道
```

## 快速开始

### 1) 环境要求

- Node.js 18+
- Bun（默认执行器）
- Python 3.8+（仅数据管道脚本需要）

### 2) 安装依赖

```bash
bun install
cd server && bun install && cd ..
```

### 3) 环境变量

前端（可选）：`.env.local`

```env
VITE_API_BASE=http://localhost:3000/api
```

后端：`server/.env`（可从 `server/.env.example` 复制）

```env
PORT=3000
JWT_SECRET=your-secret-key-change-in-production
CORS_ORIGIN=http://localhost:5173
```

企微扫码登录需要额外配置：

```env
WECOM_CORP_ID=...
WECOM_AGENT_ID=...
WECOM_SECRET=...
WECOM_ADMIN_USERIDS=userA,userB
```

### 4) 准备数据

将 `.parquet` 文件放入 `server/data/`，或使用部署脚本同步到 VPS。

### 5) 启动（推荐）

```bash
bun run dev:full
```

说明：

- 自动清理端口 `3000, 5173-5176`
- 同时启动后端与前端

### 6) 访问

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:3000/health`

登录方式：

- 用户名密码登录（账号配置在 `server/src/services/auth.ts`）
- 企微扫码登录（启用 WeCom 环境变量后可用）

## 常用命令

```bash
bun run dev            # 仅前端
bun run dev:full       # 前后端联动启动（推荐）
bun run start:server   # 仅后端（通过 scripts/start.mjs）
bun run build          # 前端生产构建
bun run preview        # 预览构建产物
bun run test           # Vitest
bun run test:coverage  # 覆盖率
bun run governance     # 治理检查
bun run plans:manage   # plans 快照管理
```

## API 总览（当前实现）

认证：

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/wecom/config`
- `GET /api/auth/wecom/callback`

数据管理：

- `POST /api/data/upload`
- `GET /api/data/files`
- `POST /api/data/load/:filename`
- `GET /api/data/metadata`
- `GET /api/data/download/:filename`
- `DELETE /api/data/clear`

分析查询：

- `GET /api/query/kpi`
- `GET /api/query/kpi-detail`
- `GET /api/query/trend`
- `GET /api/query/truck`
- `GET /api/query/growth`
- `GET /api/query/coefficient`
- `GET /api/query/cost`
- `GET /api/query/renewal`
- `GET /api/query/renewal-drilldown`
- `GET /api/query/cross-sell`
- `GET /api/query/cross-sell-summary`
- `GET /api/query/salesman-ranking`
- `GET /api/query/marketing-report`
- `GET /api/query/premium-report`
- `GET /api/query/premium-plan`
- `POST /api/query/custom`

筛选与 AI：

- `GET /api/filters/options`
- `POST /api/ai/nl2sql`
- `POST /api/ai/validate-key`

## 生产部署与数据同步

生产地址：`https://chexian.cretvalu.com`

```bash
# 完整一键链路：Excel 接收 → 续保匹配 → Parquet 转换 → VPS 同步
./数据管理/run.sh full \
  --source 历史数据.xlsx \
  --target 最新数据.xlsx \
  --output 数据管理/warehouse/fact/policy/车险保单综合明细表MMDD.parquet

# 仅本地转换，不同步 VPS
./数据管理/run.sh full ... --no-sync

# 单独同步已有 Parquet（跳过转换步骤）
./deploy/sync-data.sh                  # 自动找最新 Parquet
./deploy/sync-data.sh <文件名.parquet>  # 指定文件
```

更多部署说明：

- `DEPLOYMENT_GUIDE.md`
- `vps.md`
- `deploy/vps-deploy.sh`
- `deploy/sync-data.sh`

## 故障排查（API 模式）

出现“暂无数据”时按顺序检查：

1. 已登录且本地存在有效 `auth_token`
2. 后端运行在 `3000` 端口
3. 后端存在已加载数据（`/api/data/files` 有 `isCurrent=true`）
4. 浏览器 Network 中 `/api/*` 返回 200
5. 前端 `isDataLoaded === true`

## 文档入口

- `ARCHITECTURE.md`
- `开发文档/TECH_STACK.md`
- `开发文档/DEVELOPER_CONVENTIONS.md`
- `开发文档/00_index/DOC_INDEX.md`
- `开发文档/00_index/CODE_INDEX.md`
- `开发文档/00_index/DATA_INDEX.md`
- `BACKLOG.md`
- `PROGRESS.md`
