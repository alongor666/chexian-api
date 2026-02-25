# 车险数据分析平台（chexian-api）

<div align="center">

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0.0-61dafb.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4.21-646cff.svg)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**企业级车险数据分析平台** | React + Express + DuckDB

[快速开始](#快速开始) • [API文档](#api-总览当前实现) • [部署指南](#生产部署与数据同步) • [开发文档](#文档入口)

</div>

---

## 📊 项目概览

车险数据分析平台是一个现代化的企业级数据分析系统，采用前后端分离架构，专注于车险业务数据的深度分析和可视化呈现。

### 核心能力

- 🚀 **高性能查询** - 基于 DuckDB 的 OLAP 引擎
- 📈 **多维度分析** - KPI、趋势、成本、增长、续保、交叉销售
- 🔐 **权限控制** - 基于 RBAC 的行级数据权限
- 📊 **可视化展示** - 丰富的图表组件和数据看板
- 🤖 **AI 辅助** - 自然语言转 SQL (NL2SQL)
- 🎫 **安全认证** - JWT + 企业微信 OAuth

---

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
├── 📂 src/                      # 前端应用
│   ├── 📂 app/                  # 应用入口与路由
│   ├── 📂 features/             # 业务功能模块
│   │   ├── 📂 auth/            # 认证登录
│   │   ├── 📂 dashboard/       # 总览看板
│   │   ├── 📂 cost/            # 成本分析
│   │   ├── 📂 growth/          # 增长分析
│   │   ├── 📂 premium-report/  # 保费报告
│   │   ├── 📂 filters/         # 筛选器
│   │   └── 📂 sql-query/       # SQL 查询工具
│   ├── 📂 widgets/              # 通用图表/表格/KPI 组件
│   └── 📂 shared/               # API/Context/样式/工具/类型
├── 📂 server/                   # 后端 API
│   ├── 📂 src/
│   │   ├── 📄 app.ts            # 服务入口
│   │   ├── 📂 routes/           # auth/wecom-auth/query/data/filters/ai
│   │   ├── 📂 services/         # duckdb/auth/wecom/permission
│   │   ├── 📂 sql/              # 各分析模块 SQL 生成器
│   │   ├── 📂 middleware/       # Express 中间件
│   │   └── 📂 types/            # TypeScript 类型定义
│   └── 📂 data/                 # Parquet 文件目录
├── 📂 tests/                    # Vitest 测试
│   ├── 📂 api/                  # API 测试
│   ├── 📂 e2e/                  # E2E 测试
│   └── 📂 integration/          # 集成测试
├── 📂 scripts/                  # 启动、治理、计划管理脚本
├── 📂 deploy/                   # VPS 部署与数据同步脚本
├── 📂 数据管理/                 # 数据知识库与数据管道
├── 📂 开发文档/                 # 索引、规范、治理文档
└── 📂 docs/                     # 用户文档
```

---

## 🎨 功能模块详解

### 1. Dashboard 总览看板

**路径**: `src/features/dashboard/`

**功能**:
- 核心业务 KPI 展示（保费、件数、赔付率等）
- 多维度趋势图表
- 预警指标监控
- 数据质量检查
- 交叉销售数据展示

**API**: `GET /api/query/kpi`, `GET /api/query/trend`

**特性**:
- 实时数据更新
- 可配置的 KPI 卡片
- 多种图表类型（折线图、柱状图、饼图等）

### 2. 保费分析报告

**路径**: `src/features/premium-report/`

**功能**:
- 保费达成率分析
- 保费计划对比
- 多维度下钻分析（机构、渠道、产品等）
- 同比/环比趋势
- 保费预测

**API**: `GET /api/query/premium-report`, `GET /api/query/premium-plan`

**特性**:
- Tab 切换展示不同维度
- 可导出报告
- 历史数据对比

### 3. 成本分析

**路径**: `src/features/cost/`

**功能**:
- 变动成本结构分析
- 费用率监控
- 成本趋势追踪
- 成本 KPI 看板
- 成本构成分解

**API**: `GET /api/query/cost`

**特性**:
- 成本科目细分
- 成本预警
- 成本优化建议

### 4. 增长分析

**路径**: `src/features/growth/`

**功能**:
- 业务增长率分析
- 增长贡献度分解
- 增长趋势预测
- 增长因素分析

**API**: `GET /api/query/growth`

**特性**:
- 多期对比
- 增长驱动因素识别

### 5. 续保管理

**路径**: `src/features/renewal/`

**功能**:
- 续保率统计
- 续保预测分析
- 续保明细查询
- 下钻分析（按机构、渠道等）
- 续保跟进提醒

**API**: `GET /api/query/renewal`, `GET /api/query/renewal-drilldown`

**特性**:
- 续保概率预测
- 续保机会识别
- 续保策略建议

### 6. 交叉销售

**路径**: `src/features/cross-sell/`

**功能**:
- 驾乘险推介率分析
- 交叉销售趋势
- 交叉销售汇总报告
- 客户购买倾向分析

**API**: `GET /api/query/cross-sell`, `GET /api/query/cross-sell-summary`

**特性**:
- 推介效果追踪
- 交叉销售机会挖掘

### 7. SQL 查询工具

**路径**: `src/features/sql-query/`

**功能**:
- 自定义 SQL 查询
- NL2SQL 自然语言转 SQL（AI 辅助）
- 查询结果可视化
- 查询历史管理
- SQL 模板库

**API**: `POST /api/query/custom`, `POST /api/ai/nl2sql`

**特性**:
- 智能 SQL 补全
- 查询性能分析
- 结果导出（Excel、CSV）

### 8. 营销报告

**路径**: `src/features/marketing-report/`

**功能**:
- 营销数据统计
- 业务员排名
- 多维度报表
- 营销效果分析

**API**: `GET /api/query/marketing-report`, `GET /api/query/salesman-ranking`

**特性**:
- 自定义报表维度
- 排名趋势追踪

---

## 🔑 认证与权限

### 认证方式

#### 1. 用户名密码登录

```bash
POST /api/auth/login
{
  "username": "your-username",
  "password": "your-password"
}
```

#### 2. 企业微信扫码登录

```bash
# 获取企微配置
GET /api/auth/wecom/config

# 扫码回调
GET /api/auth/wecom/callback?code=xxx
```

### 权限控制

- **RBAC (基于角色的访问控制)** - 不同角色拥有不同的数据访问权限
- **行级权限** - 用户只能查看其权限范围内的数据
- **功能权限** - 控制用户可访问的功能模块

### 权限配置

权限配置位于 `server/src/services/permission.ts`，支持：
- 按机构过滤
- 按渠道过滤
- 按产品线过滤
- 自定义权限规则

---

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

- `ARCHITECTURE.md` - 架构规范与模块边界
- `开发文档/TECH_STACK.md` - 技术栈声明与验证协议
- `开发文档/DEVELOPER_CONVENTIONS.md` - 开发规范与最佳实践
- `开发文档/00_index/DOC_INDEX.md` - 文档索引
- `开发文档/00_index/CODE_INDEX.md` - 代码结构导航
- `开发文档/00_index/DATA_INDEX.md` - 数据字典
- `BACKLOG.md` - 任务清单
- `PROGRESS.md` - 进度追踪
- `DEPLOYMENT_GUIDE.md` - 部署指南
- `TESTING_GUIDE.md` - 测试指南
- `TROUBLESHOOTING.md` - 故障排查

---

## 🧪 测试

### 测试框架

- **Vitest** - 单元测试和集成测试
- **Playwright** - E2E 测试
- **Testing Library** - React 组件测试

### 运行测试

```bash
# 单元测试
bun run test

# 测试覆盖率
bun run test:coverage

# E2E 测试
bun run test:e2e

# E2E 测试 UI 模式
bun run test:e2e:ui
```

### 测试统计

- **单元测试**: 29+ 测试文件
- **E2E 测试**: 关键业务流程覆盖
- **集成测试**: API 接口测试
- **组件测试**: React 组件功能测试

---

## 🤝 开发指南

### 开发流程

1. **创建功能分支**
   ```bash
   git branch feature/your-feature-name
   git checkout feature/your-feature-name
   ```

2. **开发和测试**
   ```bash
   bun run dev:full    # 启动开发环境
   bun run test        # 运行测试
   ```

3. **代码质量检查**
   ```bash
   bun run typecheck   # TypeScript 类型检查
   bun run governance  # 代码规范检查
   ```

4. **提交代码**
   ```bash
   git add .
   git commit -m "feat: your feature description"
   git push origin feature/your-feature-name
   ```

5. **创建 Pull Request**
   - 确保 CI 通过
   - 添加必要的文档
   - 请求代码审查

### 代码规范

- 使用 TypeScript strict 模式
- 遵循 ESLint 和 Prettier 规则
- 组件采用函数式写法 + Hooks
- 编写单元测试覆盖新功能

### Git 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
refactor: 代码重构
test: 测试相关
chore: 构建/工具相关
perf: 性能优化
style: 代码格式
```

---

## 🔧 性能优化

### 前端优化

- ✅ 代码分割和懒加载
- ✅ 虚拟滚动（大数据列表）
- ✅ 图表按需渲染
- ✅ 资源压缩和缓存

### 后端优化

- ✅ DuckDB 查询优化
- ✅ API 响应缓存
- ✅ 连接池管理
- ✅ 请求限流保护

### 数据优化

- ✅ Parquet 列式存储
- ✅ 数据预聚合
- ✅ 索引优化

---

## 🛡️ 安全特性

### 认证与授权

- **JWT Token 认证** - 安全的用户身份验证
- **企业微信 OAuth** - 企业级单点登录
- **RBAC 权限控制** - 基于角色的访问控制
- **行级数据权限** - 精细化的数据访问控制

### 安全措施

- **HTTPS 加密传输** - 生产环境强制 HTTPS
- **SQL 注入防护** - 参数化查询
- **XSS 防护** - 输入验证和转义
- **CSRF 防护** - Token 验证
- **限流保护** - API 访问频率控制
- **审计日志** - 操作记录追踪

---

## 📦 技术栈详情

### 前端技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| React | 19.0.0 | UI 框架 |
| TypeScript | 5.9.3 | 类型系统 |
| Vite | 5.4.21 | 构建工具 |
| Tailwind CSS | 3.4.19 | 样式框架 |
| ECharts | 5.6.0 | 图表库 |
| React Router | 7.12.0 | 路由管理 |
| Vitest | 2.1.9 | 单元测试 |

### 后端技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| Express | 4.18.2 | Web 框架 |
| DuckDB | 1.1.3 | OLAP 数据库 |
| jsonwebtoken | 9.0.2 | JWT 认证 |
| bcrypt | 5.1.1 | 密码哈希 |
| Helmet | 7.1.0 | HTTP 安全头 |
| Zod | 4.3.6 | 输入校验 |

### 数据层

- **DuckDB** - 嵌入式 OLAP 数据库
- **Parquet** - 列式存储格式
- **Apache Arrow** - 内存数据格式

---

## 📈 项目统计

- **代码行数**: 1831+ TypeScript/TSX 文件
- **功能模块**: 15+ 业务功能模块
- **API 接口**: 20+ REST API 端点
- **测试用例**: 29+ 测试文件
- **文档数量**: 20+ 文档文件

---

## 🔄 更新日志

查看 [最近变更](#最近变更基于近期-git-提交) 部分了解最新更新。

完整更新日志请查看 Git 提交历史。

---

## 📞 支持与反馈

### 获取帮助

- 📖 查看 [文档入口](#文档入口)
- 🐛 提交 Issue
- 💬 联系开发团队

### 贡献指南

欢迎贡献代码、文档或提出建议！

1. Fork 项目
2. 创建功能分支
3. 提交 Pull Request
4. 等待代码审查

---

## 📄 许可证

本项目采用 MIT 许可证

---

<div align="center">

**Built with ❤️ using React + TypeScript + DuckDB**

**© 2026 车险数据分析平台**

</div>
