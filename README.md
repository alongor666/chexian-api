# 车险经营管理系统 (Insurance Sales Dashboard)

**版本**: v2.4
**最后更新**: 2026-02-14

一个基于 **React + TypeScript + DuckDB** 的高性能车险销售数据分析看板，采用纯 API 模式前后端分离架构，专为保险公司业绩管理设计。

## 核心特性

### 技术架构
- **纯 API 模式**: Node.js 后端 (Express + DuckDB Neo API) + React 前端，所有数据查询通过 REST API
- **JWT 认证**: 安全的用户认证和权限管理，支持多机构权限隔离
- **TypeScript 严格模式**: 全面的类型安全保障
- **渐进式加载**: KPI 优先显示，图表和明细数据异步加载
- **审计中间件**: 请求审计日志记录

### 业务功能
- **PolicyFact 视图**: 强制实现"保单去重"业务逻辑 (MAX Premium)
- **多维度分析**: 支持按机构、业务员、时间等多维度下钻分析
- **14 个功能模块**: 仪表盘、SQL 查询、系数监控、成本分析、保费报表、营销战报等
- **智能查询**: NL2SQL 自然语言转 SQL + 17 个预置查询模板
- **车驾意推介率分析**: 交叉销售分析面板，含时段汇总与趋势可视化
- **续保下钻分析**: 层级式续保数据下钻，支持多维度逐级展开

### 数据处理
- **Python 数据管道**: Excel 到 Parquet 的转换与清洗（支持 34 个字段）
- **数据质量检测**: 自动验证数据完整性和业务规则
- **字段映射**: 灵活的字段名映射配置系统 (`server/src/normalize/mapping.ts`)

## 项目结构

```
├── src/                      # 前端源码
│   ├── app/                  # 应用入口和全局配置
│   │   ├── App.tsx          # 根组件
│   │   ├── main.tsx         # 应用启动点
│   │   └── index.css        # 全局样式
│   ├── shared/              # 共享业务逻辑
│   │   ├── api/             # API 客户端
│   │   │   └── client.ts    # 后端 API 调用封装
│   │   ├── contexts/        # React Context
│   │   │   ├── DataContext.tsx      # 数据状态管理（dataSource 固定为 'api'）
│   │   │   ├── AuthContext.tsx      # 认证状态管理
│   │   │   ├── PermissionContext.tsx # 权限状态管理
│   │   │   └── FilterContext.tsx    # 筛选状态管理
│   │   ├── styles/          # 全局样式系统
│   │   ├── ui/              # 基础 UI 组件
│   │   ├── hooks/           # 自定义 Hooks
│   │   ├── types/           # 类型定义
│   │   ├── utils/           # 通用工具函数 (formatters/security 等)
│   │   ├── config/          # 配置文件
│   │   ├── export/          # 导出功能
│   │   └── ai-insights/     # AI 洞察功能
│   ├── features/            # 业务功能模块（14 个）
│   │   ├── auth/            # 用户认证
│   │   ├── home/            # 首页数据导入
│   │   ├── dashboard/       # 仪表盘主视图
│   │   ├── filters/         # 筛选面板
│   │   ├── growth/          # 增长率分析
│   │   ├── sql-query/       # 交互式 SQL 查询
│   │   ├── coefficient/     # 商车自主定价系数监控
│   │   ├── cost/            # 成本分析（赔付率/费用率/综合费用率/变动成本率）
│   │   ├── premium-report/  # 保费报表
│   │   ├── marketing-report/# 营销战报
│   │   ├── report/          # 报表模板
│   │   ├── settings/        # 设置面板
│   │   ├── file/            # 文件菜单
│   │   └── pages/           # 独立页面
│   └── widgets/             # 通用 UI 组件
│       ├── charts/          # ECharts 图表组件
│       ├── kpi/             # KPI 卡片组件
│       ├── table/           # 虚拟表格
│       ├── filters/         # 筛选组件
│       ├── alerts/          # 警告组件
│       └── export/          # 导出对话框
│
├── server/                   # 后端服务
│   ├── src/
│   │   ├── app.ts           # Express 应用入口
│   │   ├── routes/          # API 路由
│   │   │   ├── auth.ts      # 认证路由
│   │   │   ├── data.ts      # 数据管理路由
│   │   │   ├── query.ts     # 查询路由
│   │   │   ├── ai.ts        # AI 助手路由（NL2SQL）
│   │   │   └── filters.ts   # 筛选器选项路由
│   │   ├── services/        # 业务服务
│   │   │   ├── duckdb.ts    # 后端 DuckDB 查询服务
│   │   │   ├── auth.ts      # 认证服务
│   │   │   ├── permission.ts# 权限服务
│   │   │   ├── zhipu.ts     # 智谱 AI 服务（NL2SQL）
│   │   │   └── column-normalizer.ts # 列名标准化
│   │   ├── sql/             # SQL 生成器（14 个模块）
│   │   │   ├── kpi.ts       # KPI 查询
│   │   │   ├── kpi-detail.ts# KPI 明细
│   │   │   ├── trend.ts     # 趋势查询
│   │   │   ├── salesman-ranking.ts # 业务员排名
│   │   │   ├── cost.ts      # 成本分析
│   │   │   ├── coefficient.ts # 系数查询
│   │   │   ├── growth.ts    # 增长分析
│   │   │   ├── renewal.ts   # 续保查询
│   │   │   ├── renewal-drilldown.ts # 续保下钻
│   │   │   ├── truck.ts     # 营业货车
│   │   │   ├── premiumPlan.ts # 保费计划
│   │   │   ├── cross-sell.ts # 交叉销售分析
│   │   │   ├── cross-sell-summary.ts # 交叉销售汇总
│   │   │   ├── marketing-report.ts # 营销战报
│   │   │   └── perspective-adapter.ts # 视角适配
│   │   ├── normalize/       # 数据标准化
│   │   │   ├── mapping.ts   # 字段映射配置
│   │   │   └── validator.ts # 数据验证
│   │   ├── middleware/      # 中间件
│   │   │   ├── auth.ts      # JWT 认证中间件
│   │   │   ├── audit.ts     # 请求审计中间件
│   │   │   ├── error.ts     # 错误处理中间件
│   │   │   └── permission.ts# 权限中间件
│   │   ├── config/          # 配置（数据库/认证/CORS/路径/机构/系数）
│   │   ├── types/           # 类型定义（13 个文件）
│   │   └── utils/           # 工具函数
│   └── data/                # 数据文件目录
│       └── *.parquet        # Parquet 数据文件
│
├── tests/                    # Vitest 单元测试（28 个测试文件）
├── scripts/                  # 构建和治理脚本（27 个文件）
├── 数据管理/                 # 数据仓库与管道
│   ├── warehouse/           # 数据仓库（fact/dim）
│   ├── pipelines/           # Python 数据管道
│   ├── knowledge/           # 知识库（业务规则/数据模式/AI 参考）
│   └── config/              # 数据管理配置
├── 开发文档/                 # 项目文档（33 个文件）
└── .claude/                  # Claude Code 工作流集成
    ├── commands/            # 31 个 Slash Commands
    └── agents/              # 14 个 Subagents
```

## 技术栈

### 前端
- **React 19.0.0** - 用户界面框架
- **TypeScript 5.9.3** - 类型安全的 JavaScript
- **Vite 5.4.21** - 现代化构建工具
- **ECharts 5.6.0** - 数据可视化图表库
- **Monaco Editor 4.7.0** - SQL 编辑器
- **Tailwind CSS 3.4.19** - 实用优先的 CSS 框架
- **React Router 7.12** - 路由管理
- **Zod 4.3** - 运行时数据验证

### 后端
- **Node.js 18+** - 服务端运行时（通过 tsx 执行 TypeScript）
- **Express 4.18** - Web 框架
- **@duckdb/node-api 1.4.4-r.1** - DuckDB Neo API，高性能 OLAP 数据分析引擎
- **JWT (jsonwebtoken 9.x)** - 用户认证
- **Bcrypt** - 密码加密
- **Helmet + CORS** - 安全中间件
- **Multer** - 文件上传处理
- **Zod** - 数据验证

### 开发工具
- **Bun** - 高性能包管理器（禁止使用 npm/yarn/pnpm）
- **Vitest 2.1.9** - 单元测试框架
- **tsx 4.7** - TypeScript 执行器
- **Playwright** - E2E 测试

## 快速开始

### 环境要求
- **Node.js** 18+
- **Bun** 最新版本
- **Python** 3.8+（数据管道脚本需要）

### 1. 克隆项目
```bash
git clone <repository-url>
cd chexian-api
```

### 2. 安装依赖
```bash
# 安装前端依赖
bun install

# 安装后端依赖
cd server && bun install && cd ..
```

### 3. 数据准备

将 Parquet 数据文件放置在 `server/data/` 目录下：
```bash
cp your-data.parquet server/data/
```

或使用数据管道从 Excel 转换：
```bash
cd 数据管理
python pipelines/transform.py
# 转换后的文件在 warehouse/fact/policy/ 目录
# 需复制到 server/data/
```

### 4. 启动服务

#### 方式一：一键启动前后端（推荐）
```bash
bun run dev:full
```

#### 方式二：分别启动
```bash
# 终端 1：启动后端服务（端口 3000）
cd server && bun run dev

# 终端 2：启动前端服务（端口 5173）
bun run dev
```

> **注意**: 必须同时启动前后端。仅启动前端会导致 API 请求失败、数据无法加载。

### 5. 访问应用

1. 打开浏览器访问 `http://localhost:5173`
2. 使用以下账号登录：
   - **管理员**: `admin` / `admin123`（可查看所有机构数据）
   - **机构用户**: 快速切换面板选择（仅可查看本机构数据）
3. 在首页选择数据文件并点击"加载"
4. 数据加载完成后自动跳转到仪表盘

### 6. 运行测试
```bash
bun run test          # 运行所有测试
bun run test -- --watch  # 监听模式
```

### 7. 构建生产版本
```bash
bun run build     # 类型检查 + 生产构建
bun run preview   # 预览生产版本
```

## 系统架构

### 数据流程（纯 API 模式）
```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                │
├─────────────────────────────────────────────────────────────────┤
│  React 前端 (localhost:5173)                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ 用户登录     │───>│ JWT Token    │───>│ API 请求     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                                       │               │
│         v                                       v               │
│  ┌──────────────┐                      ┌──────────────┐        │
│  │ Auth/Permission│                    │ DataContext   │        │
│  │ Context       │                     │ (API only)   │        │
│  └──────────────┘                      └──────────────┘        │
│                                                │               │
│                                     useApiQuery() / apiClient  │
└─────────────────────────────────────────────────────────────────┘
                              │
                     REST API (JSON)
                              │
                              v
┌─────────────────────────────────────────────────────────────────┐
│  Node.js 后端 (localhost:3000)                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │/api/auth │  │/api/data │  │/api/query│  │/api/ai   │       │
│  │用户认证  │  │文件管理  │  │数据查询  │  │NL2SQL    │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│       │              │              │              │            │
│       v              v              v              v            │
│  ┌──────────────────────────────────────────────────────┐      │
│  │         SQL 生成器层（server/src/sql/）                │      │
│  │  kpi / trend / cost / coefficient / renewal / ...    │      │
│  └──────────────────────────────────────────────────────┘      │
│                          │                                      │
│                          v                                      │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                 DuckDB (Node.js)                      │      │
│  │              server/data/*.parquet                    │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### 数据加载流程
1. 用户登录获取 JWT Token
2. 前端调用 `/api/data/files` 获取可用数据文件列表
3. 用户选择文件，前端调用 `/api/data/load/:filename` 通知后端加载
4. 后端 DuckDB 加载 Parquet 文件，创建 PolicyFact 视图
5. 前端通过 `/api/query/*` 端点查询数据，后端执行 SQL 并返回 JSON
6. 前端 ECharts / React 组件渲染数据

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录，返回 JWT |
| `/api/auth/register` | POST | 用户注册 |
| `/api/data/files` | GET | 获取数据文件列表 |
| `/api/data/load/:filename` | POST | 加载指定数据文件 |
| `/api/data/upload` | POST | 上传新数据文件 |
| `/api/query/kpi` | GET | 获取 KPI 汇总数据 |
| `/api/query/kpi-detail` | GET | 获取 KPI 明细数据 |
| `/api/query/trend` | GET | 获取趋势数据 |
| `/api/query/salesman-ranking` | GET | 获取业务员排名 |
| `/api/query/cost` | GET | 获取成本分析数据 |
| `/api/query/coefficient` | GET | 获取系数数据 |
| `/api/query/renewal` | GET | 获取续保分析数据 |
| `/api/query/renewal-drilldown` | GET | 续保下钻分析数据 |
| `/api/query/cross-sell` | GET | 交叉销售（车驾意推介率）分析 |
| `/api/query/cross-sell-summary` | GET | 交叉销售时段汇总 |
| `/api/query/marketing-report` | GET | 营销战报数据 |
| `/api/query/custom` | POST | 执行自定义 SQL 查询 |
| `/api/ai/nl2sql` | POST | 自然语言转 SQL |
| `/api/filters/options` | GET | 获取筛选器选项 |

## 业务规则

### 数据口径
- **数据粒度**: 保单级别
- **去重规则**: 同一 `policy_no` 取 `MAX(premium)`
- **时间维度**: 支持自然日、自然周、自然月、季度、年度

### 核心 KPI
- **总保费**: 所有保单保费总和（去重后）
- **机构数**: 有业务发生的机构数量
- **业务员数**: 有业绩记录的业务员数量
- **人均保费**: 总保费 / 业务员数
- **续保占比**: 续保保单 / 总保单数
- **新能源占比**: 新能源车险保费 / 总保费

### 数据质量规则
- 必填字段：`policy_no`、`premium`、`org_name`、`salesman_name`
- 数值范围：`premium > 0`
- 日期格式：统一为 YYYY-MM-DD
- 编码规范：机构和业务员编码符合公司标准

## 配置说明

### 环境变量

#### 前端配置 (`.env.local`)
```env
# API 后端地址
VITE_API_BASE=http://localhost:3000/api
```

#### 后端配置 (`server/.env`)
```env
# 服务端口
PORT=3000

# JWT 密钥（生产环境请使用强密钥）
JWT_SECRET=your-secret-key

# 数据目录
DATA_DIR=./data

# CORS 允许的前端地址
CORS_ORIGIN=http://localhost:5173
```

### 字段映射配置
编辑 `server/src/normalize/mapping.ts`：
```typescript
export const fieldMapping = {
  // Excel 字段名 -> 标准字段名
  '保单号': 'policy_no',
  '保费': 'premium',
  '机构代码': 'org_code',
  // ... 更多映射
}
```

## 测试策略

### 单元测试（28 个测试文件）
- KPI 计算逻辑测试
- 数据映射和验证测试
- SQL 查询模板测试
- 安全功能测试（SQL 注入防护）
- 格式化函数测试

### 集成测试
- API 客户端测试
- 关键路径集成测试
- 数据源切换测试

### 运行测试
```bash
bun run test              # 运行所有测试
bun run test:coverage     # 测试覆盖率报告
bun run governance        # 治理规则检查
```

## AI 协作功能

### Claude Code 工作流
本项目集成了完整的 Claude Code 工作流：

#### Slash Commands（31 个）

| 类别 | 命令 | 描述 |
|------|------|------|
| **Git 工作流** | `/commit-push-pr` | 提交代码并创建 PR |
| | `/sync-and-rebase` | 同步远程代码并 Rebase |
| **数据分析** | `/data-analysis` | 车险数据多维度深度分析 |
| | `/data-tools` | Python 数据分析工具库 |
| | `/data-profile` | 数据概览与质量检查 |
| | `/data-kpi` | 业绩分析与排名 |
| | `/data-trends` | 时间趋势分析 |
| | `/data-export` | 数据导出（CSV/JSON/Excel） |
| **报告生成** | `/weekly-report` | 车险业务周报自动生成 |
| | `/report-weekly` | 周报（自然周数据） |
| | `/report-monthly` | 月报（同比环比） |
| | `/report-custom` | 自定义报告 |
| **安全审查** | `/security-review` | 全面安全审查 |
| | `/security-sql` | SQL 注入防护专项 |
| | `/security-xss` | XSS 防护专项 |
| | `/security-cors` | CORS 与文件上传安全 |
| | `/security-all` | 全量安全审查 |
| **开发工具** | `/performance-audit` | 全栈性能审计 |
| | `/ui-review` | UI/UX 设计审查 |
| | `/test-coverage` | 测试覆盖率分析 |
| | `/cost-analysis` | 成本分析深度审计 |
| | `/tdd` | TDD 开发工作流 |
| **项目管理** | `/init-project` | 初始化 Claude Code 配置 |
| | `/session-manager` | 管理对话历史 |
| | `/extract-knowledge` | 提取隐性知识 |

#### Subagents（14 个）
- `architect` / `build-error-resolver` / `business-intelligence`
- `code-simplifier` / `data-validator` / `duckdb-optimizer`
- `e2e-runner` / `knowledge-miner` / `react-performance`
- `security-reviewer` / `session-manager` / `tdd-guide`
- `ui-ux-designer` / `verify-app`

#### MCP 服务器
- **GitHub MCP**: Issue/PR 管理
- **Puppeteer MCP**: 浏览器自动化测试
- **Filesystem MCP**: 文件操作

详细说明请查看：
- [CLAUDE.md](./CLAUDE.md) - 项目上下文和开发规范（AI 协作协议）
- [FORalongor.md](./FORalongor.md) - 项目深度理解指南
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构规范

## 相关文档

### 开发文档
- **[开发文档/00_index/CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md)** - 代码索引
- **[开发文档/00_index/DOC_INDEX.md](./开发文档/00_index/DOC_INDEX.md)** - 文档索引
- **[开发文档/00_index/DATA_INDEX.md](./开发文档/00_index/DATA_INDEX.md)** - 数据索引
- **[开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)** - 技术栈详细说明
- **[开发文档/AI_COLLABORATION.md](./开发文档/AI_COLLABORATION.md)** - AI 协作指南

### 项目治理
- **[BACKLOG.md](./BACKLOG.md)** - 任务待办列表
- **[PROGRESS.md](./PROGRESS.md)** - 项目进度记录

## 故障排除

### 常见问题

#### 后端连接失败
```bash
# 检查后端是否运行
curl http://localhost:3000/api/data/files

# 如果返回 401，说明需要认证
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

#### 仪表盘显示"暂无数据"
1. 确认后端服务已启动（终端应显示 "Server is running on http://localhost:3000"）
2. 确认已登录（检查 localStorage 中的 `auth_token`）
3. 确认 `server/data/` 目录下有 `.parquet` 文件
4. 检查浏览器网络面板，确认 API 请求返回 200
5. 检查浏览器控制台无 CORS 或 Failed to fetch 错误

#### 数据加载失败 "Cannot read properties of undefined"
- 刷新页面后重试
- 检查后端日志是否有错误
- 确认 Parquet 文件格式正确

#### 性能问题
- 检查数据集大小（建议 < 500MB）
- 使用查询缓存机制
- 检查 SQL 查询是否触发全表扫描

### 调试工具
- 浏览器开发者工具 (F12)
- 后端日志（`server/` 终端输出）
- React DevTools
- Vitest 调试模式

### 端口占用
```bash
# 查看端口占用
lsof -i :3000  # 后端
lsof -i :5173  # 前端

# 杀死占用进程
kill -9 <PID>
```

## 生产部署

### 生产环境
- **地址**: `https://chexian.cretvalu.com`
- **架构**: Nginx (HTTPS + IP 白名单) → PM2 (Node.js) → DuckDB
- **安全**: HTTPS + 内网 IP 白名单 + JWT 认证 + 审计日志

### 一键数据同步（本地 → VPS）

```bash
./deploy/sync-data.sh              # 自动同步最新 Parquet 文件到 VPS
./deploy/sync-data.sh 文件名.parquet  # 指定文件
```

### 部署脚本

| 脚本 | 说明 |
|------|------|
| `deploy/sync-data.sh` | 一键数据同步（上传 + 重启 + 验证） |
| `deploy/vps-deploy.sh` | VPS 全量部署（首次部署用） |
| `deploy/deploy-fullstack.sh` | 前后端分离部署 |

详细部署文档：[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | [vps.md](./vps.md)

## 近期更新

### v2.4 (2026-02-14)
- **DuckDB Neo API 迁移**: 从废弃的 `duckdb` 包迁移到 `@duckdb/node-api` (1.4.4-r.1)，移除 `apache-arrow` 依赖
- **新增 5 个业务字段**: `insurance_grade`(保险等级)、`small_truck_score`(小货车评分)、`large_truck_score`(大货车评分)、`is_cross_sell`(是否交叉销售)、`cross_sell_premium_driver`(交叉销售保费_驾意)
- **车驾意推介率分析**: 新增交叉销售分析面板，含时段汇总与可视化
- **续保下钻分析**: 层级式续保数据多维度下钻面板
- **营销战报 SQL 生成器**: 新增 `marketing-report.ts` 和 `cross-sell-summary.ts` SQL 模块
- **5 个数据分析板块修复**: 修复系数/成本/增长/续保/营销等面板的数据异常
- **统一侧边栏筛选器**: 重构右侧筛选器布局，新增 `SidebarFilterPanel` 和 `PageFilterPanel` 组件
- **12 处类型错误修复**: 优化 TypeScript 类型检查性能
- **审计中间件**: 新增 `audit.ts` 请求审计日志
- **UI 组件**: 新增 `Tabs` 通用组件

### v2.3 (2026-02-13)
- 文档全面更新为 API-only 架构
- 3 项安全修复（CORS/XSS/SQL 注入）
- GitHub Actions CI/CD 集成

## 许可证

本项目采用 [MIT 许可证](./LICENSE)。

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

请确保：
- 通过所有测试 (`bun run test`)
- 遵循代码规范
- 更新相关文档
- 通过治理检查 (`bun run governance`)

---

**提示**: 使用 Bun 作为包管理器以获得最佳性能体验。遇到问题请先查看上方故障排除章节。
