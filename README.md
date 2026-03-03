# 车险数据分析平台（chexian-api）

`chexian-api` 是一个面向车险经营分析的前后端分离系统，采用 **纯 API 架构**：
- 前端：React + TypeScript + Vite
- 后端：Express + DuckDB（`@duckdb/node-api`）
- 数据访问：前端统一通过 `/api/*` 调用后端，不在浏览器执行 DuckDB-WASM

本项目核心目标是把车险保单数据（Parquet）转化为可运营、可决策、可审计的分析能力，覆盖 KPI、趋势、续保、交叉销售、业务员绩效、费用分析、营销战报、保费计划达成等场景。

---

## 1. 项目概述与用途

### 1.1 业务定位
- 车险经营看板：保费、件数、占比、趋势、排名
- 专题分析：增长率、成本、续保、交叉销售、营销战报、保费计划
- 权限控制：登录认证、角色权限、行级数据过滤
- 数据治理：统一列名映射、筛选参数标准化、查询缓存和审计
- AI 能力：机构趋势文本解读（OpenRouter 主路由 + 智谱兜底）

### 1.2 当前运行架构（以代码为准）
- 后端启动入口：`server/src/app.ts`
- DuckDB 服务：`server/src/services/duckdb.ts`
- 查询路由：`server/src/routes/query.ts`
- 前端 API 客户端：`src/shared/api/client.ts`
- 数据上下文：`src/shared/contexts/DataContext.tsx`（固定 `dataSource = 'api'`）

---

## 2. 技术栈与主要依赖

### 2.1 前端
- `react` `19.2.4`
- `typescript` `5.9.3`
- `vite` `5.4.21`
- `@tanstack/react-query` `5.x`
- `echarts` / `echarts-for-react`
- `recharts`
- `react-router-dom` `7.x`
- `zod` `4.x`
- `tailwindcss` `3.4.19`

### 2.2 后端
- `express` `4.18.2`
- `@duckdb/node-api` `1.4.4-r.1`
- `jsonwebtoken` `9.0.2`
- `bcrypt` `5.1.1`
- `helmet` `7.1.0`
- `cors` `2.8.5`
- `express-rate-limit` `7.1.5`
- `multer` `1.4.5-lts.1`
- `zod` `4.0.0`

### 2.3 测试与工程化
- `vitest`（单元/集成）
- `playwright`（E2E）
- `scripts/check-governance.mjs`（治理校验）
- 默认执行器：**Bun**

---

## 3. 项目结构与架构

### 3.1 目录结构

```text
chexian-api/
├── src/                          # 前端应用
│   ├── app/                      # 应用入口（main.tsx / App.tsx）
│   ├── features/                 # 业务功能模块（dashboard、growth、cost 等）
│   ├── shared/                   # API 客户端、上下文、样式系统、工具
│   ├── widgets/                  # 复用图表/表格/KPI 组件
│   └── services/                 # 前端服务封装
├── server/                       # 后端 API
│   ├── src/app.ts                # 后端入口
│   ├── src/routes/               # auth / query / data / filters / ai / wecom-auth
│   ├── src/services/             # duckdb / auth / permission 等
│   ├── src/sql/                  # SQL 生成器
│   ├── src/middleware/           # auth / permission / rate limiter / audit / error
│   ├── src/config/               # auth / cors / database / paths
│   └── data/                     # 服务端数据目录
├── tests/                        # 测试
├── scripts/                      # 启动、治理、压测、计划管理脚本
├── deploy/                       # 部署与数据同步脚本
├── 数据管理/                      # 数据处理链路与知识库
├── 开发文档/                      # 架构、规范、索引、进展
└── README.md
```

### 3.2 运行时数据流

```text
前端页面/Hook
  -> src/shared/api/client.ts
  -> /api/* (HTTP, Cookie/Bearer)
  -> server/src/routes/*.ts
  -> server/src/sql/*.ts
  -> server/src/services/duckdb.ts
  -> DuckDB(PolicyFact / CrossSellDailyAgg 等视图)
  -> JSON 响应 -> 前端渲染
```

### 3.3 架构要点
- API-only：前端不直接跑 SQL
- 鉴权方式：`Authorization: Bearer` 或 `HttpOnly Cookie`
- 查询保护：`authMiddleware + permissionMiddleware + SQL 校验 + 权限过滤注入`
- DuckDB：单例 + 连接池 + 查询缓存 + 慢查询监控
- 数据加载：支持上传 Parquet、加载已有文件、多文件合并

---

## 4. 安装与启动

### 4.1 环境要求
- Bun（推荐，日常命令统一用 Bun）
- Node.js（用于脚本运行；建议 LTS）
- macOS / Linux / Windows 均可

### 4.2 安装依赖

```bash
# 根目录依赖
bun install

# 后端依赖（建议显式安装一次）
cd server && bun install && cd ..
```

### 4.3 配置环境变量

```bash
cp .env.example .env.local
cp server/.env.example server/.env
```

### 4.4 启动（推荐全栈）

```bash
bun run dev:full
```

启动脚本会自动处理：
- 端口清理（`3000`, `5173-5176`）
- 后端先启动，再启动前端
- 检查并提示端口占用

默认地址：
- 前端：`http://localhost:5173`
- 后端：`http://127.0.0.1:3000`
- 健康检查：`http://127.0.0.1:3000/health`

### 4.5 常用命令

```bash
bun run dev              # 仅前端
bun run start:server     # 仅后端（通过 scripts/start.mjs）
bun run build            # 前端构建
bun run preview          # 预览
bun run test             # 单元/集成测试
bun run test:coverage    # 覆盖率
bun run test:e2e         # Playwright E2E
bun run governance       # 治理校验
bun run plans:manage     # 计划管理
```

---

## 5. 使用示例

### 5.1 浏览器使用流程
1. 启动 `bun run dev:full`
2. 打开前端并登录
3. 进入首页上传 `.parquet` 数据文件
4. 选择仪表盘/专题页面，使用筛选器查看分析结果

### 5.2 API 调用示例（cURL，Cookie 会话）

```bash
# 1) 登录并保存 Cookie
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}' \
  http://127.0.0.1:3000/api/auth/login

# 2) 查询 KPI
curl -b cookies.txt \
  "http://127.0.0.1:3000/api/query/kpi?startDate=2026-01-01&endDate=2026-01-31&dateField=policy_date"

# 3) 获取筛选项
curl -b cookies.txt \
  http://127.0.0.1:3000/api/filters/options
```

### 5.3 前端代码调用示例

```ts
import { apiClient } from '@/shared/api/client';

const kpi = await apiClient.getKpi({
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  dateField: 'policy_date',
  orgNames: '机构A,机构B',
});

console.log(kpi.total_premium);
```

---

## 6. API 端点

说明：以下为 `server/src/routes/*.ts` 中已注册端点。
- 基础前缀：`/api`
- 鉴权：`/api/query`、`/api/filters`、`/api/ai` 均要求登录 + 权限中间件
- `query` 常见筛选参数见本节末尾

### 6.1 健康检查

| Method | Endpoint | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 否 | 服务健康状态 |

### 6.2 认证与账号

| Method | Endpoint | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/auth/login` | 否 | 登录，签发会话 |
| POST | `/api/auth/refresh` | 否 | 刷新会话 |
| POST | `/api/auth/logout` | 否 | 注销会话 |
| GET | `/api/auth/me` | Token/Cookie | 当前用户信息 |
| GET | `/api/auth/users` | BRANCH_ADMIN | 用户列表 |
| POST | `/api/auth/users` | BRANCH_ADMIN | 创建用户 |
| PUT | `/api/auth/users/:id` | BRANCH_ADMIN | 更新用户 |
| DELETE | `/api/auth/users/:id` | BRANCH_ADMIN | 删除用户 |
| GET | `/api/auth/roles` | BRANCH_ADMIN | 角色列表 |
| POST | `/api/auth/roles` | BRANCH_ADMIN | 创建角色 |
| PUT | `/api/auth/roles/:role` | BRANCH_ADMIN | 更新角色 |
| DELETE | `/api/auth/roles/:role` | BRANCH_ADMIN | 删除角色 |

### 6.3 企微登录

| Method | Endpoint | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/auth/wecom/config` | 否 | 获取企微扫码配置 |
| GET | `/api/auth/wecom/callback` | 否 | OAuth 回调 |

### 6.4 数据管理

| Method | Endpoint | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/data/upload` | 是 | 上传并加载 Parquet |
| GET | `/api/data/metadata` | 是 | 当前数据元信息 |
| DELETE | `/api/data/clear` | 是 | 清空当前数据 |
| GET | `/api/data/files` | 是 | 文件列表 |
| POST | `/api/data/load/:filename` | 是 | 加载历史文件 |
| GET | `/api/data/download/:filename` | 是 | 下载文件 |
| GET | `/api/data/kpi-plan-config` | 是 | 获取计划配置 |
| PUT | `/api/data/kpi-plan-config` | 是 | 更新计划配置 |

### 6.5 筛选器

| Method | Endpoint | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/filters/options` | 是 + 权限过滤 | 获取筛选器候选值 |

### 6.6 AI

| Method | Endpoint | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/ai/nl2sql` | 是 + 权限过滤 | 已关闭，返回 410 |
| POST | `/api/ai/validate-key` | 是 + 权限过滤 | 验证 AI Key |
| POST | `/api/ai/trend-analysis` | 是 + 权限过滤 | 机构趋势文本解读 |

### 6.7 查询 API

| Method | Endpoint | 说明 |
|---|---|---|
| GET | `/api/query/kpi` | KPI 汇总 |
| GET | `/api/query/kpi-detail` | KPI 细分 |
| GET | `/api/query/trend` | 保费趋势 |
| GET | `/api/query/quality-business-trend` | 优质业务占比趋势 |
| GET | `/api/query/truck` | 营业货车分析 |
| GET | `/api/query/growth` | 增长分析 |
| GET | `/api/query/coefficient` | 系数监控 |
| GET | `/api/query/cost` | 成本分析 |
| GET | `/api/query/comprehensive-bundle` | 综合分析聚合返回 |
| GET | `/api/query/comprehensive-analysis-bundle` | 综合分析兼容端点 |
| GET | `/api/query/renewal` | 续保分析 |
| GET | `/api/query/renewal-drilldown` | 续保下钻 |
| GET | `/api/query/cross-sell` | 交叉销售 |
| GET | `/api/query/cross-sell-trend` | 交叉销售趋势 |
| GET | `/api/query/cross-sell-summary` | 交叉销售分时汇总 |
| GET | `/api/query/cross-sell-top-salesman` | 交叉销售 TOP 业务员 |
| GET | `/api/query/cross-sell-bundle` | 交叉销售聚合端点 |
| GET | `/api/query/cross-sell-org-trend` | 机构推介率走势 |
| GET | `/api/query/performance-summary` | 业绩分析汇总 |
| GET | `/api/query/performance-trend` | 业绩趋势 |
| GET | `/api/query/performance-drilldown` | 业绩下钻 |
| GET | `/api/query/performance-top-salesman` | 业绩 TOP 业务员 |
| GET | `/api/query/performance-bundle` | 业绩分析聚合端点 |
| GET | `/api/query/salesman-ranking` | 业务员排名 |
| GET | `/api/query/marketing-report` | 营销战报 |
| GET | `/api/query/premium-report` | 保费报表 |
| GET | `/api/query/premium-plan` | 保费计划下钻 |
| GET | `/api/query/plan-achievement` | 计划达成面板 |
| GET | `/api/query/dashboard-bundle` | 仪表盘聚合端点 |
| GET | `/api/query/fee-analysis` | 费用分析 |
| POST | `/api/query/custom` | 受限自定义 SQL |
| GET | `/api/query/test` | 测试端点（调试用） |

### 6.8 `query` 常见筛选参数

通用参数定义见 `server/src/utils/filter-params.ts`：
- 日期：`startDate` `endDate` `dateField(policy_date|insurance_start_date)`
- 多选：`orgNames` `salesmanNames` `customerCategories` `coverageCombinations`
- 扩展：`renewalModes` `tonnageSegments` `insuranceGrades` `smallTruckScores` `largeTruckScores`
- 布尔：`isRenewal` `isNewCar` `isTransfer` `isNev` `isTelemarketing` `isCommercialInsure` `isRenewable` `isCrossSell`

---

## 7. 配置项（Environment）

### 7.1 配置文件
- 前端/根目录：`.env.local`（模板：`.env.example`）
- 后端：`server/.env`（模板：`server/.env.example`）

### 7.2 前端配置（`.env.local`）

| 变量 | 说明 | 默认/示例 |
|---|---|---|
| `VITE_API_BASE` | 前端 API 基础地址 | `http://localhost:3000/api` |
| `VITE_APP_TITLE` | 页面标题 | `车险业绩分析系统` |
| `VITE_AUTO_LOAD_DATA` | 是否自动加载默认数据 | `false` |
| `VITE_DATA_URL` | 默认数据 URL | `/data/data.parquet` |
| `VITE_ENABLE_COMPREHENSIVE_ANALYSIS` | 综合分析功能开关 | `false` |
| `VITE_ENABLE_BUNDLE_ROUTES` | 是否优先调用 bundle 接口 | `true` |
| `VITE_ZHIPU_API_KEY` | 智谱 Key（前端兜底） | 空 |

### 7.3 后端核心配置（`server/.env`）

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 服务端口 | `3000` |
| `BIND_HOST` | 监听地址 | `127.0.0.1` |
| `NODE_ENV` | 运行环境 | `development` |
| `CORS_ORIGIN` | 允许跨域来源（逗号分隔） | 开发环境自动附加本地端口 |
| `JWT_SECRET` | JWT 密钥 | `change-me-in-production` |
| `JWT_EXPIRES_IN` | Access 过期时间 | `4h` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh 过期时间 | `7d` |
| `USER_PASSWORDS` | 生产环境预置密码哈希映射（JSON） | 可选 |

### 7.4 数据库与性能配置

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DUCKDB_PATH` | DuckDB 路径 | `:memory:` |
| `DATA_PATH` | 数据目录 | `./data` |
| `DUCKDB_MAX_MEMORY` | DuckDB 内存上限 | `4GB` |
| `DUCKDB_THREADS` | DuckDB 线程数 | `4` |
| `ENABLE_QUERY_BUNDLES` | 服务端是否启用 bundle 路由 | `true` |

### 7.5 AI 与企微配置

| 变量 | 说明 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter Key |
| `AI_PRIMARY_MODEL` / `OPENROUTER_MODELS` | 模型链（逗号分隔） |
| `AI_PROVIDER_TIMEOUT_MS` | AI 请求超时 |
| `AI_TREND_CACHE_TTL_MS` | 趋势分析缓存 TTL |
| `ZHIPU_API_KEY` | 智谱后端 Key |
| `WECOM_CORP_ID` `WECOM_AGENT_ID` `WECOM_SECRET` | 企微登录配置 |
| `WECOM_ADMIN_USERIDS` | 企微管理员白名单 |

---

## 8. 开发指南

### 8.1 必守约束
- 使用 **Bun** 执行项目命令
- 保持 **API-only** 架构，不回退到本地 DuckDB 模式
- 不删除既有查询路由，新增能力优先在现有模块扩展
- SQL 与筛选逻辑优先复用 `server/src/utils/filter-params.ts` 与既有 SQL 生成器

### 8.2 前端样式与格式化规范
- UI 样式必须优先复用 `src/shared/styles/index.ts` 导出的语义样式
- 禁止页面内硬编码通用 Tailwind 色值组合
- 数值展示优先复用 `src/shared/utils/formatters.ts`

### 8.3 筛选与时间口径规范
- 支持 `policy_date` / `insurance_start_date` 双口径
- 日期逻辑优先用户筛选值，避免后端硬编码当前日期函数
- 新增查询必须兼容权限过滤（`req.permissionFilter`）

### 8.4 提交前验证

```bash
bun run test
bun run governance
```

高风险改动（SQL、筛选、权限、时间维度）建议额外做：
- 浏览器 Network/Console 实测
- 关键接口 cURL 回归
- 对应测试补充到 `tests/`

### 8.5 参考文档
- `ARCHITECTURE.md`
- `开发文档/TECH_STACK.md`
- `开发文档/DEVELOPER_CONVENTIONS.md`
- `server/README.md`
- `DEPLOYMENT_GUIDE.md`
- `vps.md`

---

## 附：部署与数据同步

常见脚本：

```bash
# 本地数据链路（可带同步）
./数据管理/run.sh full --source 历史数据.xlsx --target 最新数据.xlsx --output 数据管理/warehouse/fact/policy/xxx.parquet

# 同步到 VPS
./deploy/sync-data.sh

# 全量部署
./deploy/vps-deploy.sh
```
