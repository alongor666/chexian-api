# 车险经营管理系统（chexian-api）

**最后更新**: 2026-02-18  
**当前架构**: 纯 API 模式（React 前端 + Express 后端 + DuckDB Neo API）

本项目是车险经营数据分析平台，前端只通过 REST API 访问后端 DuckDB，不再使用 DuckDB-WASM / 本地 DuckDB 模式。

## 最近变更（基于近期 Git 提交）

- `12da4bd` (2026-02-16): 新增 `.github/workflows/deploy.yml`，支持 push 到 `main` 后自动构建并部署 VPS。
- `809149f` (2026-02-16): 统一设计系统（颜色、字体、组件样式令牌），集中在 `src/shared/styles/index.ts`。
- `1b37f05` (2026-02-15): `bun run dev:full` 启动前自动清理占用端口（`3000`, `5173-5176`）。
- `10e8c29` (2026-02-13): 修复 5 个核心分析面板，新增交叉销售时段汇总、营销战报 SQL，重构筛选器右侧布局。
- `8608c9f` (2026-02-13): 新增 `scripts/typecheck.mjs`，修复类型错误并优化类型检查体验。

## 核心能力

- 统一认证与权限控制：JWT 登录 + 路由权限过滤（机构级可见范围）。
- 后端 SQL 生成器：KPI、趋势、成本、系数、续保、交叉销售、营销战报等模块。
- 数据文件管理：上传 / 加载 / 列表 / 元信息 / 下载（Parquet）。
- AI SQL：`/api/ai/nl2sql` 支持自然语言转 SQL（含校验与可选执行）。
- 统一设计系统：样式常量、语义色、表格/按钮/卡片样式统一复用。

## 项目结构（当前）

```text
chexian-api/
├── src/                         # 前端（React + TypeScript + Vite）
│   ├── app/                     # 入口（main.tsx / App.tsx）
│   ├── features/                # 14 个业务功能模块
│   ├── shared/                  # API、Context、样式系统、工具、类型
│   ├── widgets/                 # 图表/KPI/表格/筛选等复用组件
│   └── components/              # 布局和通用页面组件
├── server/                      # 后端（Express + DuckDB Neo API）
│   └── src/
│       ├── app.ts               # 后端入口
│       ├── routes/              # auth/data/query/filters/ai 路由
│       ├── services/            # duckdb/auth/permission 等服务
│       ├── sql/                 # 各分析模块 SQL 生成器
│       ├── normalize/           # 字段映射与校验
│       └── middleware/          # auth/permission/error/audit
├── tests/                       # Vitest 测试（当前 24 个 *.test.ts）
├── scripts/                     # 启动/治理/类型检查/诊断脚本
├── 数据管理/                     # 数据仓库、管道、知识库
├── 开发文档/                     # 规范、索引、治理文档
└── .github/workflows/           # CI/CD（治理检查、部署流程）
```

## 技术栈

### 前端
- React 19
- TypeScript 5.9
- Vite 5
- Tailwind CSS 3
- ECharts 5
- React Router 7

### 后端
- Node.js 18+
- Express 4.18
- `@duckdb/node-api` 1.4.4-r.1
- JWT (`jsonwebtoken`)
- `bcrypt`
- `helmet` + `cors`
- `zod`

### 工具链
- Bun（项目默认包管理器/脚本执行器）
- Vitest（单元测试）
- Playwright（浏览器测试支持）

## API 概览

### 认证
- `POST /api/auth/login`
- `POST /api/auth/refresh`

### 数据管理
- `POST /api/data/upload`
- `GET /api/data/metadata`
- `GET /api/data/files`
- `POST /api/data/load/:filename`
- `GET /api/data/download/:filename`
- `DELETE /api/data/clear`

### 查询
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
- `POST /api/query/custom`
- `GET /api/query/test`

### 筛选与 AI
- `GET /api/filters/options`
- `POST /api/ai/nl2sql`
- `POST /api/ai/validate-key`

## 快速开始

### 1. 环境要求
- Node.js 18+
- Bun 1.1+
- Python 3.8+（仅数据管道相关脚本需要）

### 2. 安装依赖

```bash
bun install
cd server && bun install && cd ..
```

### 3. 准备数据

将 `.parquet` 文件放到 `server/data/`：

```bash
cp your-data.parquet server/data/
```

后端启动时会自动尝试加载 `server/data/` 中最新文件（优先非 `test-data*`）。

### 4. 启动开发环境（推荐）

```bash
bun run dev:full
```

说明：
- 会先清理占用端口 `3000`、`5173-5176`。
- 然后启动后端（3000）和前端（Vite）。

也可分开启动：

```bash
cd server && bun run dev   # 终端 1
bun run dev                # 终端 2
```

### 5. 登录与访问

- 前端: `http://localhost:5173`
- 健康检查: `http://localhost:3000/health`
- 默认管理员账号: `admin / admin123`

## 常用命令

```bash
bun run dev:full           # 前后端联动启动（推荐）
bun run dev                # 仅前端
bun run build              # 前端构建
bun run preview            # 前端构建预览
bun run typecheck          # 类型检查
bun run test               # Vitest
bun run test:coverage      # 覆盖率
bun run governance         # 治理检查

cd server && bun run dev   # 后端开发
cd server && bun run build # 后端构建
```

## 故障排查（高频）

1. 先确认已登录（JWT token 存在）。
2. 确认后端 3000 端口正常：`curl http://localhost:3000/health`。
3. 确认 `server/data/` 下存在可用 parquet 文件，并已加载为当前文件。
4. 浏览器 Network 检查 `/api/*` 是否 200。
5. 前端用 `isDataLoaded` 判断数据可用状态，而不是只看页面展示。

## 重要文档入口

- `ARCHITECTURE.md`
- `开发文档/TECH_STACK.md`
- `开发文档/DEVELOPER_CONVENTIONS.md`
- `开发文档/00_index/DOC_INDEX.md`
- `开发文档/00_index/CODE_INDEX.md`
- `BACKLOG.md`
- `PROGRESS.md`

## 说明

- 本 README 已对齐当前代码状态与近期提交。
- 旧版 README 中的过时描述（如不存在的接口、过时统计口径）已清理。
