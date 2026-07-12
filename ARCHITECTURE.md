# 车险经营分析平台架构

本文档只描述当前生产架构与依赖边界。早期 L0/L1/L2 Python 子项目、`input/output` 文件交换及目录模板已退役，原规范完整归档于 [legacy Python 子项目约定](reference/legacy-python-subproject-convention.md)，不得作为当前实现的强制规则。

## 1. 系统定位

`chexian-api` 是 API-only 的车险经营分析平台：浏览器端只负责交互和展示，所有业务数据通过后端 REST API 获取。DuckDB native 仅运行在 Node.js 后端；系统不包含浏览器 DuckDB-WASM 或 Local 查询模式。

```text
外部业务数据
  → 数据管理/daily.mjs + pipelines（校验、转换、发布）
  → 数据管理/warehouse（Parquet fact/dim）
  → Express routes → SQL generators → DuckDB native
  → React Web / @chexian/cli / @chexian/mcp / AI Agent
```

## 2. 当前模块边界

| 模块 | 职责 | 依赖方向 |
|---|---|---|
| `数据管理/` | ETL 编排、数据校验、Parquet 仓库、发布台账 | 外部源 → warehouse |
| `server/` | 认证授权、REST 路由、SQL 生成、DuckDB 查询、缓存、AI/技能编排 | warehouse → API |
| `src/` | React 页面、筛选状态、React Query、可视化 | API → UI |
| `cli/` | PAT 认证的只读命令行入口 | API → CLI |
| `mcp/` | 面向 Agent 的 MCP 工具入口 | API → MCP |
| `scripts/` | 构建、治理、发布与运维编排 | 跨模块校验，不承载业务口径 |

## 3. 前端分层

```text
src/app                应用入口、显式路由、全局 Provider
src/components/layout  全局布局
src/features           页面与业务功能装配
src/widgets            通用图表、KPI、表格
src/shared             API 客户端、上下文、配置、通用 UI 与工具
```

- `src/shared/config/productMetadata.ts` 是用户可见产品命名事实源。
- `src/shared/config/routeRegistry.ts` 是 canonical 页面、导航、权限配置项和兼容 redirect 的事实源。
- React 页面仍在 `src/app/App.tsx` 显式注册；测试负责与注册表对账。
- feature 不横向依赖其他 feature；共享能力下沉到 `shared` 或 `widgets`。

## 4. 后端与数据层

后端采用 `routes → sql/services → DuckDB` 的单向调用。路由层负责参数、认证与响应契约；SQL 生成器负责查询语义；服务层负责数据加载、执行、缓存及基础设施。字段、指标和 API 路由由各自注册表治理，不在调用点复制定义。

数据管道以 `数据管理/data-sources.json` 和 warehouse 实际目录为准。`daily.mjs` 组织 ETL，`pipelines/` 提供校验与转换，产物进入 `warehouse/fact`、`warehouse/dim`，再经发布链同步至服务环境。前端不得直读 Parquet。

## 5. 运行与发布

- 本地开发与验证统一使用 Bun。
- Web、CLI、MCP 与 AI 都通过同一 API 权限边界访问数据。
- 生产发布按 ETL → 同步 → reload → health 的顺序执行，任一关键阶段失败应阻断后续发布。
- 架构、路由、权限或口径变更必须通过对应测试、类型检查和 `bun run governance`。

## 6. 协作规则

- 当前代码和注册表是易变事实的来源；文档避免维护无法自动验证的数量。
- 新能力应扩展现有模块，只有职责和生命周期真正独立时才新增包。
- 历史 Python 子项目约定仅供追溯，不得覆盖当前 warehouse/API-only 架构。

---

维护者：alongor · 当前架构校准：2026-07-12
