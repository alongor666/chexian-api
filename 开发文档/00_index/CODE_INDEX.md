# 代码索引 (CODE_INDEX)

**核心层目录地图**：快速定位关键代码入口与模块职责。

> 本项目为纯 API 模式（从 chexianYJFX 拆分），所有数据通过后端 DuckDB + REST API 获取，无 DuckDB-WASM / Local 模式。

## 核心层目录

| 层级 | 路径 | 职责 | 索引文件 |
|------|------|------|----------|
| 后端服务层 | `server/src/` | Express 服务、DuckDB 查询、SQL 生成、认证鉴权 | [server/src/sql/INDEX.md](../../server/src/sql/INDEX.md) |
| 前端共享层 | `src/shared/` | API 客户端、上下文管理、通用工具、类型定义 | [INDEX.md](../../src/shared/INDEX.md) |
| 功能特性层 | `src/features/` | Dashboard、Filters 等 21 个业务功能模块 | [INDEX.md](../../src/features/INDEX.md) |
| UI 组件层 | `src/widgets/` | Charts、KPI、Table 通用组件 | [INDEX.md](../../src/widgets/INDEX.md) |
| 自动化脚本 | `scripts/` | 治理校验、构建、CI/CD | [INDEX.md](../../scripts/INDEX.md) |

> 上表仅列**带独立 INDEX.md 的核心层**。下面两张全景表枚举 `src/` 与 `server/src/` 的**全部一级目录**（含核心层未覆盖的入口/遗留/新增模块）。

### 前端 `src/` 一级目录全景

| 一级目录 | 二级/三级要点 | 职责 | 状态 |
|---------|--------------|------|------|
| `app/` | App.tsx · main.tsx · index.css | 应用入口（路由挂载、根组件） | 活跃 |
| `features/` | 21 模块，各含 components/hooks/utils/types | **业务功能模块集**（前端主体） | 活跃 |
| `shared/` | api · contexts · hooks · ui · ai-insights · config · styles · theme · types · utils | 共享层（API 客户端/上下文/设计系统） | 活跃 |
| `widgets/` | alerts · charts · export · filters · kpi · table · tables | 通用 UI 组件库 | 活跃 |
| `components/` | layout/ | 全局布局组件（PageFilterPanel 等） | 活跃 |
| `charts/` | ScissorsTrendChart.tsx | 独立特化图表 | 活跃 |
| `services/` | PdfExportService.ts | 前端轻量服务（看板导出 PDF） | 活跃 |
| `shims/` | external-modules.d.ts | 第三方模块类型垫片 | 活跃 |
| `core/` | 仅 README | 历史架构遗留区，主链路已迁出 | ⚠️ 待归档 |
| `types/` | chart.types.ts | 历史类型目录，新类型放 `shared/types/` | ⚠️ 待归档 |

### 后端 `server/src/` 一级目录全景

| 一级目录 | 二级/三级要点 | 职责 | 状态 |
|---------|--------------|------|------|
| `routes/` | 12 顶层路由 + `query/`（23 子路由 + bundles） | API 路由层（聚合器 + 子路由） | 活跃 |
| `sql/` | 31 顶层 + 8 子目录（cost/cross-sell/trend/growth/performance-analysis/forecast/shared），共 55 文件 | SQL 生成器（业务口径核心） | 活跃 |
| `services/` | 28 文件（duckdb-* 9 拆分 + auth/permission/access-control/PAT/route-cache/state-db…） | 服务层（查询执行/认证/权限/缓存/状态库） | 活跃 |
| `config/` | field-registry/ · metric-registry/（categories 8 域 + __tests__） | 配置注册表（字段/指标/客户类别/环境/路由） | 活跃 |
| `agent/` | registry · routes · schemas · services · tools | **AI Agent 系统**（诊断/解释/预测/审计 + 能力注册表） | 活跃 |
| `skills/` | registry · runner · workflow-runner · red-line-policy · audit-log · skills/ · workflows/ · adapters/llm | **后端技能编排系统**（技能定义 + 工作流编排） | 活跃 |
| `middleware/` | auth · permission · error | 中间件（认证/权限/错误处理） | 活跃 |
| `normalize/` | mapping · validator（codegen 生成） | 列名标准化（中文→英文标准列名） | 活跃 |
| `utils/` | sql-validator · sql-sanitizer · security · logger | 工具（SQL 安全校验/转义/日志） | 活跃 |
| `scripts/` | admin-import-pat · admin-import-users | 管理脚本（PAT/用户导入） | 活跃 |
| `types/` | data.ts 等 | 后端类型定义 | 活跃 |

## 快速入口

### 数据处理链路（API 模式）
```
用户登录 → AuthContext 验证 → JWT Token
  ↓
src/shared/api/client.ts                          # 前端 API 客户端（统一入口 apiClient）
  ├─ getKpi/getKpiDetail/getTrend/...             # 核心 query 方法（仍在基类）
  ├─ login/logout/getCurrentUser                  # 会话生命周期（改写 token 状态，刻意留基类）
  └─ 10 个命名空间子客户端（Phase 2 神类拆分，见下方「API 客户端」表）
       apiClient.auth.* / .ai.* / .data.* / .workflows.* / .crossSell.* /
       .performance.* / .repair.* / .claimsDetail.* / .quoteConversion.* / .customerFlow.*
  ↓
server/src/routes/query.ts                        # 路由聚合器（65 行，挂载 19 个子路由）
  ├─ server/src/routes/query/*.ts                 # 19 个子路由模块 + 1 个 shared.ts
  ↓
server/src/sql/*.ts                               # SQL 生成器（31 个文件：28 生成器 + 3 共享模块）
  ↓
server/src/services/duckdb.ts                     # 后端 DuckDB 服务（查询执行）
  ↓
src/features/dashboard/hooks/useDashboardData.ts  # 前端 Hook（数据获取）
  ↓
src/features/*                                    # 功能模块 UI 渲染
```

### 后端核心模块

#### 路由层 (`server/src/routes/`)

共 12 个顶层路由文件，全部在 `server/src/app.ts` 挂载到 `/api/*`：

| 文件 | API 前缀 | 职责 |
|------|---------|------|
| `query.ts` | `/api/query` | 查询路由聚合器（挂载 23 个子路由 + 统一认证中间件） |
| `query/*.ts` | `/api/query/*` | 23 个子路由模块（KPI/趋势/排名/成本/系数/续保/交叉销售/赔案/报价等）+ `bundles/` |
| `data.ts` | `/api/data` | 数据管理路由（文件上传/列表/加载） |
| `auth.ts` | `/api/auth` | 认证路由（登录/注册/Token 刷新/route-catalog） |
| `wecom-auth.ts` | `/api/auth/wecom` | 企微扫码认证（前置避开 loginLimiter） |
| `filters.ts` | `/api/filters` | 筛选选项路由（机构/业务员/客户类别等） |
| `ai.ts` | `/api/ai` | AI 助手路由（NL2SQL/智能分析） |
| `discover.ts` | `/api/discover` | 能力/路由发现 |
| `reports.ts` | `/api/reports` | 报告产物服务（HTML 报告托管） |
| `skills.ts` | `/api/skills` | 后端技能调用（驱动 `skills/` 编排） |
| `workflows.ts` | `/api/workflows` | 工作流调用（驱动 `skills/workflows/`） |
| `copilot.ts` | `/api/copilot` | AI 副驾对话路由 |
| `admin.ts` | `/api/admin` | 管理后台（用户/PAT 管理） |

> Agent 域路由不在 `routes/` 而在 `server/src/agent/routes/`，挂载到 `/api/agent/{audit,diagnosis,explain,forecast}`（见下文 Agent 系统）。

#### SQL 生成器 (`server/src/sql/`，31 顶层 + 8 子目录拆分，共 55 文件)

**共享基础设施（3 个）**

| 文件 | 行数 | 职责 |
|------|------|------|
| `sql-builder.ts` | 399 | 公共 CTE 构建器（`buildPolicyExposureCTE` 等，19+ 处调用） |
| `perspective-adapter.ts` | 190 | 视角 SQL 适配层（SELECT/WHERE/GROUP BY 视角切换） |
| `performance-analysis-shared.ts` | ~5 | 业绩分析域共享逻辑（barrel → performance-analysis/shared.ts，545行） |

**业务域生成器（28 个）**

| 域 | 文件 | 行数 | 职责 |
|----|------|------|------|
| KPI | `kpi.ts` | 366 | 基础 KPI 查询（件数/保费/占比） |
| KPI | `kpi-detail.ts` | 177 | KPI 详细数据（环形图分解） |
| 趋势 | `trend.ts` | ~18 | 趋势分析桶（barrel re-export）→ `trend/` 子目录：`shared.ts`（类型+常量）/`premium-trend.ts`（机构分组）/`total-trend.ts`（总体）/`quality-business.ts`（优质业务） |
| 增长 | `growth.ts` | 20 | 增长率分析桶（barrel re-export）→ `growth/` 子目录：`shared.ts`（类型+工具）/`yoy.ts`（同比）/`mom.ts`（环比）/`ytd.ts`（年累计）/`custom.ts`（自定义+预设） |
| 排名 | `salesman-ranking.ts` | 52 | 业务员排名 |
| 货车 | `truck.ts` | 192 | 营业货车专项（吨位分段） |
| 成本 | `cost.ts` | 996 | 成本分析（赔付率/费用率/综合成本率） |
| 成本 | `expense-development.ts` | 84 | 费用发展 |
| 交叉销售 | `cross-sell.ts` | 289 | 交叉销售主查询 |
| 交叉销售 | `cross-sell-summary.ts` | 247 | 交叉销售汇总 |
| 交叉销售 | `cross-sell-trend.ts` | 111 | 交叉销售趋势 |
| 交叉销售 | `cross-sell-heatmap.ts` | 438 | 交叉销售热力图 |
| 交叉销售 | `cross-sell-org-trend.ts` | 114 | 交叉销售机构趋势 |
| 交叉销售 | `cross-sell-top-salesman.ts` | 107 | 交叉销售 Top 业务员 |
| 业绩 | `performance-analysis.ts` | 49 | 业绩分析桶（barrel re-export）→ `performance-analysis/` 子目录：`shared.ts`（共享类型与辅助函数，545行）/`summary.ts`（汇总+周期边界）/`trend.ts`（趋势）/`drilldown.ts`（下钻）/`top-salesman.ts`（Top20 业务员） |
| 业绩 | `performance-heatmap.ts` | 463 | 业绩热力图（15 周期连续） |
| 综合 | `comprehensive-analysis.ts` | 271 | 综合分析（保费+赔款+费用+变动成本率） |
| 报表 | `premium-report.ts` | 125 | 保费报表 |
| 报表 | `premiumPlan.ts` | 382 | 保费达成下钻（计划 vs 实际） |
| 报表 | `marketing-report.ts` | 340 | 营销战报（假日分析） |
| 赔案 | `claims-detail.ts` | 517 | 赔案明细（未决监控+地理热力图） |
| 赔案 | `claims-heatmap.ts` | ~250 | 理赔热力图（维度×周月矩阵，含同比） |
| 报价 | `quote-conversion.ts` | 287 | 报价转化分析 |
| 客户 | `customer-flow.ts` | 105 | 客户来源去向（转保/流失） |
| 维修 | `repair.ts` | 91 | 维修资源合作 |
| 地理 | `policy-geo.ts` | 97 | 承保地理分布（省/市两级，车牌归属地聚合） |
| 续保 | `renewal-tracker.ts` | ~90 | 续保追踪（GROUPING SETS 输出 6 种层级聚合，消费派生域 RenewalTrackerFact） |
| Agent | `pivot.ts` | ~50 | PIVOT 维度×指标交叉聚合生成器（白名单维度 + metric-registry 指标） |

#### 服务层 (`server/src/services/`，28 文件)

**DuckDB 引擎簇（10 个，duckdb.ts 主入口 + 9 个职责拆分）**

| 文件 | 职责 |
|------|------|
| `duckdb.ts` | DuckDB 连接池、查询执行、数据加载（单例主入口） |
| `duckdb-infra.ts` / `duckdb-types.ts` / `duckdb-type-converter.ts` | 连接基建 / 类型定义 / 类型转换 |
| `duckdb-parquet-loader.ts` / `duckdb-domain-loaders.ts` | Parquet 加载 / 分域加载器 |
| `duckdb-init-tables.ts` / `duckdb-materialization.ts` | 初始化建表 / 物化预聚合 |
| `data-bootstrapper.ts` / `bootstrapper-registry.ts` / `lazy-domain-registry.ts` | 数据引导 / 引导注册表 / 懒加载域注册表 |

**认证与权限（5 个）**

| 文件 | 职责 |
|------|------|
| `auth.ts` | 认证服务（JWT 生成、密码验证） |
| `permission.ts` | 权限服务（机构过滤、SQL WHERE 子句生成） |
| `access-control.ts` / `access-control-store.ts` | 访问控制（dataScope/allowedRoutes）+ 持久化 |
| `personal-access-token.ts` / `personal-access-token-store.ts` | PAT（只读 Bearer Token）签发与校验 + 存储 |

**缓存 / 状态 / 数据版本（5 个）**

| 文件 | 职责 |
|------|------|
| `route-cache.ts` / `route-concurrency.ts` | 路由 LRU 内存缓存 / 并发控制 |
| `cache-warmer.ts` | 缓存预热 |
| `data-version.ts` | 数据版本（ETL 更新检测，供 SW 轮询） |
| `state-db.ts` / `state-db-schema.ts` | 状态库（SQLite）+ schema |

**外部集成与其他（6 个）**

| 文件 | 职责 |
|------|------|
| `column-normalizer.ts` | 列名标准化（中文→英文标准列名） |
| `zhipu.ts` / `openrouter.ts` | 智谱 AI（NL2SQL） / OpenRouter LLM 适配 |
| `wecom.ts` / `notify.ts` | 企业微信集成 / 通知 |
| `requirement-detector.ts` | 需求识别（AI 意图判定） |

#### AI Agent 系统 (`server/src/agent/`)

挂载到 `/api/agent/*`，结构化诊断/解释/预测/审计 Agent，输出受 Zod schema 约束。

| 二级目录 | 职责 |
|---------|------|
| `routes/` | 4 个路由：`agent-audit` / `agent-diagnosis` / `agent-explain` / `agent-forecast` → `/api/agent/{audit,diagnosis,explain,forecast}` |
| `services/` | 14 个诊断服务：成本/增长/赔案风险/客户流转/报价转化/续保/业务巡检诊断、利润预测、问题路由、指标审计等 |
| `registry/` | Agent 能力注册表：data-capability / metric / forecast-output / unsupported-metric / metric-capability-mapping |
| `schemas/` | 7 个 Zod 契约：audit / capability / diagnosis / explanation / forecast(+baseline) / metric |
| `tools/` | `tool-registry.ts`（Agent 工具注册） |

#### 后端技能编排系统 (`server/src/skills/`)

挂载到 `/api/skills` 与 `/api/workflows`，可组合的"技能 → 工作流"运行器，含红线策略与审计。

| 文件/目录 | 职责 |
|----------|------|
| `registry.ts` / `runner.ts` | 技能注册表 / 单技能运行器 |
| `workflow-runner.ts` / `workflows/` | 工作流运行器 / 工作流定义（如 `auto-risk-control.workflow.ts`） |
| `skills/` | 8 个技能定义：kpi-baseline / cost-diagnosis / claims-drilldown / risk-scoring / segment-risk-scan / pricing-simulation / report-template / attach-narrative / data-health |
| `red-line-policy.ts` / `audit-log.ts` / `run-store.ts` | 红线策略守卫 / 审计日志 / 运行记录存储 |
| `adapters/` | `query-adapter.ts` + `adapters/llm/`（LLM 适配） |
| `types.ts` | 技能/工作流类型定义 |

#### 列名映射与校验 (`server/src/normalize/`)

| 文件 | 职责 |
|------|------|
| `mapping.ts` | 列名别名定义（42 个业务字段 → 多别名映射）⚠️ 由 codegen 生成，勿手动编辑 |
| `validator.ts` | 数据类型校验（EXPECTED_TYPES）⚠️ 由 codegen 生成，勿手动编辑 |

#### 配置注册表 (`server/src/config/`)

| 文件 | 职责 |
|------|------|
| `field-registry/fields.json` | **字段唯一事实源**（56 字段），codegen: `node scripts/field-registry/generate.mjs` |
| `metric-registry/` | 指标注册表（52 个指标） |
| `customer-categories.ts` | 客户类别枚举（11 类）+ 分组常量 + 辅助函数 |
| `env.ts` | 环境变量集中管理（6 分组，启动时校验） |
| `api-routes.ts` | API 路由路径常量（5 组，前后端一致） |
| `paths.ts` | 文件路径配置 |
| `preset-users.ts` | 预设用户凭据 |

#### 中间件 (`server/src/middleware/`)

| 文件 | 职责 |
|------|------|
| `auth.ts` | JWT 认证中间件 |
| `error.ts` | 全局错误处理中间件 |
| `permission.ts` | 角色权限中间件 |

#### 工具函数 (`server/src/utils/`)

| 文件 | 职责 |
|------|------|
| `sql-validator.ts` | SQL 安全校验（只读检查） |
| `sql-sanitizer.ts` | SQL 参数转义 |
| `sql-permission-injector.ts` | 权限过滤注入 |
| `security.ts` | 安全工具（API Key 脱敏、日志安全） |
| `queryBuilder.ts` | 查询构建工具 |
| `logger.ts` | 日志工具 |

### 前端核心模块

#### API 客户端 (`src/shared/api/`)

> **架构（Phase 2 神类拆分，2026-06）**：原单文件 `client.ts`（约 1250 行）已按域拆分为「传输内核 + 业务域方法层 + 10 个命名空间子客户端」。`client.ts` 降至约 312 行（−75%），仅保留核心 query 方法 + 会话生命周期方法 + 子客户端挂载。所有子客户端共享单例 `ApiTransport` 句柄（不新建第二个客户端），统一走 `transport.request` 收口（保留 Bearer 认证、错误处理、in-flight coalescing）。

| 文件 | 职责 |
|------|------|
| `client-core.ts` | 传输内核：`ApiClientCore`（token 状态 setToken/clearToken/setSessionCookieHint + 请求执行 + coalescing）+ 只读 `ApiTransport` 句柄（request/queryGet/drilldownGet/buildQueryString/getToken）|
| `client.ts` | 业务域方法层 `ApiClient`（继承 ApiClientCore）：核心 query 方法（KPI/趋势/排名/自定义/bundle 等）+ 会话生命周期（login/logout/getCurrentUser，改写 token 状态故留基类）+ 挂载 10 个命名空间子客户端；导出单例 `apiClient` |
| `auth-api.ts` | `apiClient.auth.*` — 账号 CRUD（用户/PAT/角色/企微配置 共 12 个无状态端点）|
| `ai-api.ts` | `apiClient.ai.*` — NL2SQL / 趋势解读 / 需求识别 / 能力发现 |
| `data-api.ts` | `apiClient.data.*` — 文件列表/加载/上传/删除/版本 |
| `workflows-api.ts` | `apiClient.workflows.*` — 工作流运行/审计/审批/拒绝/健康 |
| `cross-sell-api.ts` | `apiClient.crossSell.*` — 交叉销售趋势/排名/热力图 |
| `performance-api.ts` | `apiClient.performance.*` — 业绩汇总/下钻/机构热力图 |
| `repair-api.ts` | `apiClient.repair.*` — 车型维修分析 |
| `claims-detail-api.ts` | `apiClient.claimsDetail.*` — 赔案明细 |
| `quote-conversion-api.ts` | `apiClient.quoteConversion.*` — 报价转化 |
| `customer-flow-api.ts` | `apiClient.customerFlow.*` — 客户来源去向 |
| `routes.ts` | 路由常量注册表（`QUERY_ROUTES`/`AUTH_ROUTES`/`DATA_ROUTES`/`AI_ROUTES`/...）|
| `types.ts` | API 数据类型（`KpiData`/`AccessUser`/`AccessRole`/`ApiTokenInfo`/...）|
| `index.ts` | 公共导出面（`apiClient` + 路由常量 + 常用类型）|

> **契约护栏**：`tests/api/client-contracts.test.ts`（82 例）逐方法断言 URL path + query 参数 + HTTP 动词（`expectMethod` 覆盖 GET/POST/PUT/DELETE），防拆分过程中 endpoint 漂移。

#### 上下文管理 (`src/shared/contexts/`)

| 文件 | 职责 |
|------|------|
| `DataContext.tsx` | 数据源状态管理（`isDataLoaded` 唯一来源，固定 `dataSource='api'`） |
| `AuthContext.tsx` | 认证状态管理（JWT Token、登录/登出） |
| `FilterContext.tsx` | 筛选器状态管理 |
| `PermissionContext.tsx` | 角色权限管理 |

#### 通用 Hooks (`src/shared/hooks/`)

| 文件 | 职责 |
|------|------|
| `useApiQuery.ts` | API 查询 Hook（封装请求/缓存/错误处理） |
| `useDataFetch.ts` | 数据获取 Hook |
| `useLoadingStates.ts` | 多状态加载管理 |
| `usePagination.ts` | 分页 Hook |
| `useFocusTrap.ts` | 焦点陷阱 Hook |

#### 功能模块 (`src/features/`)

共 21 个模块（多数含 `components/hooks/utils/types` 三级分层）：

| 模块 | 路径 | 职责 |
|------|------|------|
| Dashboard | `dashboard/` | 仪表盘主视图（KPI、图表、表格、续保分析），主链路入口 `PremiumDashboard.tsx` |
| Comprehensive Analysis | `comprehensive-analysis/` | 综合分析（保费+赔款+费用+变动成本率，含 adapters/charts） |
| Cost | `cost/` | 成本分析（赔付率/费用率/综合费用率/变动成本率） |
| Expense Development | `expense-development/` | 费用发展分析 |
| Growth | `growth/` | 增长率分析（同比/环比/年累计） |
| Claims Detail | `claims-detail/` | 赔案明细（未决监控 + 地理热力图） |
| Customer Flow | `customer-flow/` | 客户来源去向（转保/流失） |
| Quote Conversion | `quote-conversion/` | 报价转化分析 |
| Renewal Tracker | `renewal-tracker/` | 续保追踪 |
| Premium Report | `premium-report/` | 保费报表（机构保费 + 业务员明细） |
| Moto Cost | `moto-cost/` | 摩托车成本（交强 + 人身险捆绑经营） |
| Repair | `repair/` | 维修资源合作 |
| Copilot | `copilot/` | AI 副驾（对话式分析，含 __tests__） |
| Home | `home/` | 首页数据导入（拖拽上传、最近文件、意图解析 intentParser） |
| Filters | `filters/` | 筛选面板（日期/机构/业务员/险别） |
| Report | `report/` | 报表模板功能 |
| Admin | `admin/` | 管理后台（用户/PAT 管理） |
| Auth | `auth/` | 登录/认证页面 |
| Settings | `settings/` | 设置面板 |
| File | `file/` | 文件菜单（数据导入/导出） |
| Pages | `pages/` | 页面路由组件 |

> 已下线：`sql-query/`（交互式 SQL 查询）与 `marketing-report/`（营销战报）已从 features/ 移除。

### 关键类型定义

| 类型/接口 | 路径 | 说明 |
|-----------|------|------|
| `ColumnMapping` | `server/src/normalize/mapping.ts` | 列名映射类型（36 个字段，支持多别名） |
| `DomainField` | `server/src/normalize/mapping.ts` | 业务字段枚举类型 |
| `ValidationResult` | `server/src/normalize/mapping.ts` | 列名校验结果 |
| `TypeValidationResult` | `server/src/normalize/validator.ts` | 数据类型校验结果 |
| `KpiData` | `server/src/types/data.ts` | 后端 KPI 指标数据 |
| `TrendDataPoint` | `server/src/types/data.ts` | 趋势数据点 |
| `AdvancedFilterState` | `server/src/types/data.ts` | 高级筛选器状态 |
| `KpiData` (前端) | `src/shared/api/client.ts` | 前端 KPI 数据接口 |
| `KpiDetailData` | `src/shared/api/client.ts` | KPI 详细数据（环形图） |
| `TrendData` | `src/shared/api/client.ts` | 趋势数据接口 |
| `FileInfo` | `src/shared/api/client.ts` | 文件信息接口 |
| `DataContextValue` | `src/shared/contexts/DataContext.tsx` | 数据上下文值类型 |

### 禁止直接修改的文件

| 文件 | 原因 | 如需变更 |
|------|------|----------|
| `server/src/services/duckdb.ts` | 后端 DuckDB 查询执行逻辑 | 不得修改已有逻辑；只能追加新功能；需 BACKLOG 登记 |
| `server/src/routes/query.ts` | 后端 API 路由定义 | 不得删除已有路由；只能追加新路由；需 BACKLOG 登记 |
| `server/src/normalize/mapping.ts` | 指标口径定义、列名别名映射 | 只能追加新别名，不得删除；需 BACKLOG 证据 |
| `server/src/sql/kpi.ts` | KPI SQL 业务规则 | 只能追加新模板，不得改已有逻辑；需 BACKLOG 证据 |
| `server/src/sql/kpi-detail.ts` | KPI 详细数据 SQL 逻辑 | 只能追加新模板，不得改已有逻辑；需 BACKLOG 证据 |

## 测试入口

| 测试文件 | 覆盖范围 | 路径 |
|----------|----------|------|
| `security.test.ts` | 后端安全工具函数 | `server/src/utils/__tests__/security.test.ts` |
| `client.test.ts` | API 客户端 | `tests/api/client.test.ts` |
| `data-source.test.ts` | 数据源逻辑 | `tests/api/data-source.test.ts` |
| `sql-parser.test.ts` | SQL 解析 | `tests/api/sql-parser.test.ts` |
| `sql-validator.test.ts` | SQL 校验（前端） | `src/shared/utils/__tests__/sql-validator.test.ts` |
| `sqlValidator.test.ts` | SQL 校验（NL2SQL） | `src/features/sql-query/aiSql/__tests__/sqlValidator.test.ts` |
| `sqlGenerator.test.ts` | SQL 生成器 | `src/features/sql-query/queryBuilder/__tests__/sqlGenerator.test.ts` |
| `formatters.test.ts` | 格式化函数 | `tests/formatters.test.ts` |
| `queryBuilder.test.ts` | 查询构建 | `tests/queryBuilder.test.ts` |
| `security.test.ts` | 安全工具 | `tests/security.test.ts` |
| `template-engine.test.ts` | 模板引擎 | `tests/template-engine.test.ts` |
| `holidayUtils.test.ts` | 假日工具 | `tests/marketing-report/holidayUtils.test.ts` |
| `ai-insights/*.test.ts` | AI 洞察 | `src/shared/ai-insights/__tests__/` |
| `critical-path.test.ts` | 关键路径集成测试 | `tests/integration/critical-path.test.ts` |

运行测试：`bun run test`（注意：不是 `bun test`）

## 链接到其他索引

- **文档索引**: [DOC_INDEX.md](./DOC_INDEX.md) - 业务规则、架构文档
- **数据索引**: [DATA_INDEX.md](./DATA_INDEX.md) - 字段定义、业务规则、分析场景
- **进展索引**: [PROGRESS_INDEX.md](./PROGRESS_INDEX.md) - 任务状态、待办事项

---

**变更规则**：
- 新增核心层目录：必须创建 INDEX.md 并在此处登记。
- 新增关键类型：必须在"关键类型定义"表格登记。
- 修改禁止文件：必须先在 BACKLOG.md 登记需求并提供证据链。

## 2026-04-19 数据发布管道补充（新增）

数据发布 manifest 契约与 preflight/metadata 单点写入：

| 文件 | 用途 |
|------|------|
| `数据管理/release-manifest.schema.json` | JSON Schema，约束 run manifest 字段（run_id/run_date/archive_dir/domains） |
| `数据管理/release-manifests/YYYY-MM-DD.json` | 单次发布的 run manifest（4 域：premium/claims_detail/cross_sell/customer_flow） |
| `数据管理/pipelines/preflight_refresh.py` | 发布预检：源文件摆放/日期范围/premium 重叠/legacy 残留/tmp 文件 |
| `数据管理/pipelines/refresh_metadata.py` | 从最终 parquet 单点派生 `data-sources.json`（替代 daily.mjs 4 处散落写入） |

**SOP**:
1. `python3 数据管理/pipelines/preflight_refresh.py --manifest 数据管理/release-manifests/YYYY-MM-DD.json`
2. 备份 + ETL（daily.mjs/replace_range）
3. `python3 数据管理/pipelines/refresh_metadata.py --domain <id> --parquet <glob> --date-column <col> --run-date YYYY-MM-DD`

## 2026-02-25 API-only 清理补充（新增）

- `src/features/dashboard/hooks/useDashboardData.ts`、`src/features/dashboard/Dashboard.tsx`、`src/features/filters/FilterPanel.tsx` 已归档，不再作为当前运行链路入口。
- 归档目录：`archive/legacy-code/2026-02-api-only/`（先归档，后续迭代再物理删除）。
- 当前看板主链路入口：`src/features/dashboard/PremiumDashboard.tsx` + `src/components/layout/PageFilterPanel.tsx`。
- 类型检查护栏：`scripts/check-governance.mjs` 新增 `TS检查范围`，禁止通过 `tsconfig.exclude` 排除活跃目录规避类型问题。

**变更记录**：
- 2026-06-05：一级目录全景对齐——新增「前端 `src/` 一级目录全景」「后端 `server/src/` 一级目录全景」两张全景表，补登此前未文档化的前端 `app/charts/core/services/shims/types` 与后端 `agent/skills/scripts` 模块；新增 Agent 系统、技能编排系统两节；路由表补全 12 顶层路由 + API 前缀，服务层 5→28 文件，SQL 31→55（含子目录），features 13→21（移除已下线 `sql-query`/`marketing-report`）。
- 2026-02-13：全面更新为 API-only 架构，移除所有 DuckDB-WASM/Local 模式引用，更新数据链路为前端 API Client → 后端路由 → SQL 生成器 → DuckDB 服务，补全后端模块清单（路由/SQL/服务/中间件/工具）、前端模块清单（API/上下文/Hooks/功能模块）、测试清单。
