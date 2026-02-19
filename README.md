# 车险数据分析平台（chexian-api）

**版本**: v2.6  
**最后更新**: 2026-02-19

> 车险经营分析平台（API 版）。采用**纯 API 架构**：前端通过 REST API 访问后端 DuckDB（Node.js），不再支持 DuckDB-WASM / Local 模式。

## 项目概览

- **前端**：React 19 + TypeScript + Vite
- **后端**：Express + `@duckdb/node-api`
- **数据格式**：Parquet（后端加载、查询）
- **安全能力**：JWT 认证、权限控制、限流、审计日志
- **部署状态**：已上线 `https://chexian.cretvalu.com`

## 当前架构（最新）

本项目为前后端分离的 API-only 架构：

```text
Browser (React)
   └─ /api/* 请求（Bearer Token）
         └─ Node.js/Express (server/src/app.ts)
               ├─ /api/auth     认证
               ├─ /api/data     文件与数据加载
               ├─ /api/query    业务查询
               ├─ /api/filters  筛选选项
               └─ /api/ai       NL2SQL
                     └─ DuckDB 查询 Parquet
```

### 关键约束

- 数据源固定为 API（`DataContext` 中 `dataSource='api'`）。
- 所有 `/api/*` 路由必须经过认证中间件。
- SQL 由 `server/src/sql/*.ts` 统一生成，不在前端拼接 SQL。

## 目录结构

```text
chexian-api/
├── src/                    # 前端应用
│   ├── app/                # 应用入口（main.tsx / App.tsx）
│   ├── features/           # 业务模块
│   ├── widgets/            # 通用组件
│   ├── components/         # 页面与布局组件
│   └── shared/             # API/Context/样式/工具/类型
├── server/                 # 后端 API
│   ├── src/app.ts          # 后端入口
│   ├── src/routes/         # 路由层
│   ├── src/services/       # 服务层（DuckDB/Auth/Permission）
│   ├── src/sql/            # SQL 生成器
│   ├── src/normalize/      # 字段映射与校验
│   └── data/               # Parquet 文件目录
├── tests/                  # Vitest 测试
├── scripts/                # 启动/治理/计划管理脚本
├── 开发文档/               # 项目文档与索引
└── 数据管理/               # 数据管道与知识库
```

## 快速开始

### 1) 环境要求

- Node.js 18+
- Bun（项目统一执行器）
- Python 3.8+（仅用于数据管道）

### 2) 安装依赖

```bash
bun install
cd server && bun install && cd ..
```

### 3) 准备数据

将 `.parquet` 文件放入 `server/data/`。

### 4) 启动项目（推荐）

```bash
bun run dev:full
```

> `dev:full` 会先清理常见占用端口（3000, 5173-5176），再启动后端与前端。

### 5) 访问系统

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3000`

默认管理员账号：`admin / admin123`

## 常用命令

```bash
bun run dev            # 仅前端
bun run dev:full       # 前后端联动启动（推荐）
bun run build          # 生产构建
bun run preview        # 预览构建产物
bun run test           # Vitest 测试
bun run test:coverage  # 覆盖率
bun run governance     # 治理校验
bun run plans:manage   # plans 状态管理
```

## 核心 API（节选）

| 路径 | 方法 | 说明 |
|---|---|---|
| `/api/auth/login` | POST | 登录获取 JWT |
| `/api/data/files` | GET | 获取可用数据文件 |
| `/api/data/load/:filename` | POST | 加载指定 Parquet |
| `/api/query/kpi` | GET | KPI 汇总 |
| `/api/query/trend` | GET | 趋势分析 |
| `/api/query/cost` | GET | 成本分析 |
| `/api/query/renewal` | GET | 续保分析 |
| `/api/query/renewal-drilldown` | GET | 续保下钻 |
| `/api/query/cross-sell` | GET | 交叉销售分析 |
| `/api/query/cross-sell-summary` | GET | 交叉销售汇总 |
| `/api/query/marketing-report` | GET | 营销战报 |
| `/api/ai/nl2sql` | POST | 自然语言转 SQL |
| `/api/filters/options` | GET | 筛选器选项 |

## 文档入口（建议先读）

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [CLAUDE.md](./CLAUDE.md)
- [开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)
- [开发文档/DEVELOPER_CONVENTIONS.md](./开发文档/DEVELOPER_CONVENTIONS.md)
- [开发文档/00_index/DOC_INDEX.md](./开发文档/00_index/DOC_INDEX.md)
- [开发文档/00_index/CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md)
- [开发文档/00_index/DATA_INDEX.md](./开发文档/00_index/DATA_INDEX.md)
- [BACKLOG.md](./BACKLOG.md)
- [PROGRESS.md](./PROGRESS.md)

## 生产部署与数据同步

生产地址：`https://chexian.cretvalu.com`

```bash
./deploy/sync-data.sh                  # 同步最新 Parquet
./deploy/sync-data.sh <文件名.parquet>  # 同步指定文件
```

更多说明：

- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- [vps.md](./vps.md)
- [deploy/sync-data.sh](./deploy/sync-data.sh)

## 故障排查（API 模式）

仪表盘出现“暂无数据”时按顺序检查：

1. 是否已登录（`auth_token` 是否存在）
2. 后端是否运行在 3000 端口
3. 后端是否有已加载的数据文件
4. 浏览器 Network 中 `/api/*` 是否返回 200
5. `isDataLoaded` 是否为 `true`

## 许可证

[MIT](./LICENSE)
