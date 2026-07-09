# 代码索引 (CODE_INDEX)

**核心层目录地图**：快速定位关键代码入口与模块职责。

> 本项目为纯 API 模式（从 chexianYJFX 拆分），所有数据通过后端 DuckDB + REST API 获取，无 DuckDB-WASM / Local 模式。

## 核心层目录

| 层级 | 路径 | 职责 | 索引文件 |
|------|------|------|----------|
| 后端服务层 | `server/src/` | Express 服务、DuckDB 查询、SQL 生成、认证鉴权 | [server/src/sql/INDEX.md](../../server/src/sql/INDEX.md) |
| 前端共享层 | `src/shared/` | API 客户端、上下文管理、通用工具、类型定义 | [INDEX.md](../../src/shared/INDEX.md) |
| 功能特性层 | `src/features/` | Dashboard、Filters 等业务功能模块（模块数以目录为准） | [INDEX.md](../../src/features/INDEX.md) |
| UI 组件层 | `src/widgets/` | Charts、KPI、Table 通用组件 | [INDEX.md](../../src/widgets/INDEX.md) |
| 自动化脚本 | `scripts/` | 治理校验、构建、CI/CD | [INDEX.md](../../scripts/INDEX.md) |

> 上表仅列**带独立 INDEX.md 的核心层**。下面两张全景表枚举 `src/` 与 `server/src/` 的**全部一级目录**（含核心层未覆盖的入口/遗留/新增模块）。

### 前端 `src/` 一级目录全景

| 一级目录 | 二级/三级要点 | 职责 | 状态 |
|---------|--------------|------|------|
| `app/` | App.tsx · main.tsx · index.css | 应用入口（路由挂载、根组件） | 活跃 |
| `features/` | 模块数以目录为准（各含 components/hooks/utils/types） | **业务功能模块集**（前端主体） | 活跃 |
| `shared/` | api · contexts · hooks · ui · config · styles · theme · types · utils | 共享层（API 客户端/上下文/设计系统） | 活跃 |
| `widgets/` | alerts · charts · filters · kpi · table · tables | 通用 UI 组件库 | 活跃 |
| `components/` | layout/ | 全局布局组件（PageFilterPanel 等） | 活跃 |
| `charts/` | ScissorsTrendChart.tsx | 独立特化图表 | 活跃 |
| `services/` | PdfExportService.ts | 前端轻量服务（看板导出 PDF） | 活跃 |
| `shims/` | external-modules.d.ts | 第三方模块类型垫片 | 活跃 |

### 后端 `server/src/` 一级目录全景

| 一级目录 | 二级/三级要点 | 职责 | 状态 |
|---------|--------------|------|------|
| `routes/` | 顶层路由 + `query/` 子路由（数量以目录为准，见下文路由层表） | API 路由层（聚合器 + 子路由） | 活跃 |
| `sql/` | 顶层生成器 + 8 业务子目录（cost/cross-sell/cube/forecast/growth/performance-analysis/shared/trend），文件数以目录实际为准 | SQL 生成器（业务口径核心） | 活跃 |
| `services/` | 文件数以目录为准（duckdb-* 引擎簇 + cube 双轨 + auth/permission/access-control/PAT/route-cache/state-db…） | 服务层（查询执行/立方体/认证/权限/缓存/状态库） | 活跃 |
| `config/` | field-registry/ · metric-registry/（categories 域数以目录为准）· 路由/口径契约（route-param-contracts 等） | 配置注册表（字段/指标/客户类别/环境/路由/口径） | 活跃 |
| `agent/` | registry · routes · schemas · services · tools | **AI Agent 系统**（诊断/解释/预测/审计 + 能力注册表） | 活跃 |
| `skills/` | registry · runner · workflow-runner · red-line-policy · audit-log · skills/ · workflows/ · adapters/llm | **后端技能编排系统**（技能定义 + 工作流编排） | 活跃 |
| `middleware/` | auth · permission · readonly · rateLimiter · audit · brotli · special-feature · error | 中间件（认证/权限/只读/限流/审计/压缩/错误处理） | 活跃 |
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
  ├─ client-core.ts                               # 传输内核（鉴权头/401刷新/GET合并/超时）
  └─ 12 个命名空间子客户端 *-api.ts（Phase 2 神类拆分；2026-07 patrol 域整链退役）
       apiClient.{auth,ai,data,workflows,crossSell,performance,repair,claimsDetail,quoteConversion,customerFlow,premium,geo}.*
  ↓
server/src/routes/query.ts                        # 路由聚合器（挂载 22 个子路由 + 认证/只读/权限中间件）
  ├─ server/src/routes/query/*.ts                 # 22 个子路由模块 + shared.ts + bundles/
  ↓
server/src/sql/*.ts                               # SQL 生成器（生成器 + 共享模块，数量以目录为准）
  ↓
server/src/services/duckdb.ts                     # 后端 DuckDB 服务（查询执行；立方体路由见 cube-routing.ts）
  ↓
src/features/*/hooks                              # 前端功能模块 Hook（数据获取）→ UI 渲染
```

### 后端核心模块

#### 路由层 (`server/src/routes/`)

顶层路由文件（数量以目录为准）在 `server/src/app.ts` 挂载到 `/api/*`：

| 文件 | API 前缀 | 职责 |
|------|---------|------|
| `query.ts` | `/api/query` | 查询路由聚合器（挂载 22 个子路由 + 统一认证/只读/权限中间件） |
| `query/*.ts` | `/api/query/*` | 22 个子路由模块（KPI/趋势/排名/成本/系数/续保/交叉销售/赔案/报价/立方体/透视等）+ `shared.ts` + `bundles/` |
| `data.ts` | `/api/data` | 数据管理路由（文件上传/列表/加载） |
| `auth.ts` | `/api/auth` | 认证路由（登录/注册/Token 刷新/route-catalog） |
| `wecom-auth.ts` | `/api/auth/wecom` | 企微扫码认证（前置避开 loginLimiter） |
| `filters.ts` | `/api/filters` | 筛选选项路由（机构/业务员/客户类别等） |
| `ai.ts` | `/api/ai` | AI 助手路由（NL2SQL/智能分析） |
| `discover.ts` | `/api/discover` | 能力/路由发现 |
| `reports.ts` | `/api/reports` | 报告产物服务（HTML 报告托管；`portal/:slug/:file` 门户按登录用户选省级/本机构静态报告——B346） |
| `skills.ts` | `/api/skills` | 后端技能调用（驱动 `skills/` 编排） |
| `workflows.ts` | `/api/workflows` | 工作流调用（驱动 `skills/workflows/`） |
| `copilot.ts` | `/api/copilot` | AI 副驾对话路由 |
| `admin.ts` | `/api/admin` | 管理后台（用户/PAT 管理） |

> Agent 域路由不在 `routes/` 而在 `server/src/agent/routes/`，挂载到 `/api/agent/{audit,diagnosis,explain,forecast}`（见下文 Agent 系统）。
>
> `routes/` 下另有 2 个**非路由的纯函数辅助模块**：`data-layout.ts`（current/ 目录布局解析，被 `data.ts` 消费）与 `discover-fields-view.ts`（字段视图构造，被 `discover.ts` 消费），均无 Express 依赖、可被 vitest 直接单测。

#### SQL 生成器 (`server/src/sql/`，顶层 + 8 子目录拆分，文件数以目录为准)

**共享基础设施（3 个顶层文件）**

| 文件 | 职责 |
|------|------|
| `sql-builder.ts` | 公共 CTE 构建器（`buildPolicyExposureCTE` 等，多处生成器调用） |
| `perspective-adapter.ts` | 视角 SQL 适配层（SELECT/WHERE/GROUP BY 视角切换） |
| `performance-analysis-shared.ts` | 业绩分析域共享逻辑（barrel → `performance-analysis/shared.ts`） |

**业务域生成器（28 个顶层文件）**

| 域 | 文件 | 职责 |
|----|------|------|
| KPI | `kpi.ts` | 基础 KPI 查询（件数/保费/占比） |
| KPI | `kpi-detail.ts` | KPI 详细数据（环形图分解） |
| 趋势 | `trend.ts` | 趋势分析桶（barrel re-export）→ `trend/` 子目录：`shared.ts`（类型+常量）/`premium-trend.ts`（机构分组）/`total-trend.ts`（总体）/`quality-business.ts`（优质业务） |
| 增长 | `growth.ts` | 增长率分析桶（barrel re-export）→ `growth/` 子目录：`shared.ts`（类型+工具）/`yoy.ts`（同比）/`mom.ts`（环比）/`ytd.ts`（年累计）/`custom.ts`（自定义+预设） |
| 排名 | `salesman-ranking.ts` | 业务员排名 |
| 货车 | `truck.ts` | 营业货车专项（吨位分段） |
| 成本 | `cost.ts` | 成本分析（赔付率/费用率/综合成本率；部分拆至 `cost/` 子目录） |
| 成本 | `expense-development.ts` | 费用发展 |
| 交叉销售 | `cross-sell.ts` | 交叉销售主查询（部分拆至 `cross-sell/` 子目录） |
| 交叉销售 | `cross-sell-summary.ts` | 交叉销售汇总 |
| 交叉销售 | `cross-sell-trend.ts` | 交叉销售趋势 |
| 交叉销售 | `cross-sell-heatmap.ts` | 交叉销售热力图 |
| 交叉销售 | `cross-sell-org-trend.ts` | 交叉销售机构趋势 |
| 交叉销售 | `cross-sell-top-salesman.ts` | 交叉销售 Top 业务员 |
| 业绩 | `performance-analysis.ts` | 业绩分析桶（barrel re-export）→ `performance-analysis/` 子目录：`shared.ts`（共享类型与辅助函数）/`summary.ts`（汇总+周期边界）/`trend.ts`（趋势）/`drilldown.ts`（下钻）/`top-salesman.ts`（Top20 业务员） |
| 业绩 | `performance-heatmap.ts` | 业绩热力图（15 周期连续） |
| 综合 | `comprehensive-analysis.ts` | 综合分析（保费+赔款+费用+变动成本率） |
| 报表 | `premium-report.ts` | 保费报表 |
| 报表 | `premiumPlan.ts` | 保费达成下钻（计划 vs 实际） |
| 报表 | `marketing-report.ts` | 营销战报（假日分析） |
| 赔案 | `claims-detail.ts` | 赔案明细（未决监控+地理热力图） |
| 赔案 | `claims-heatmap.ts` | 理赔热力图（维度×周月矩阵，含同比） |
| 报价 | `quote-conversion.ts` | 报价转化分析 |
| 客户 | `customer-flow.ts` | 客户来源去向（转保/流失） |
| 维修 | `repair.ts` | 维修资源合作 |
| 地理 | `policy-geo.ts` | 承保地理分布（省/市两级，车牌归属地聚合） |
| 续保 | `renewal-tracker.ts` | 续保追踪（GROUPING SETS 输出 6 种层级聚合，消费派生域 RenewalTrackerFact） |
| Agent | `pivot.ts` | PIVOT 维度×指标交叉聚合生成器（白名单维度 + metric-registry 指标） |

> 无顶层 barrel 的子目录：`cube/`（通用立方体查询加速，消费方含 `services/duckdb-cube.ts`、`sql/kpi.ts` 与多个 `routes/query/*` 子路由）、`forecast/`（利润预测基线，消费方 `agent/services/agent-forecast-baseline-service.ts`）、`shared/`（跨域共享片段：`business-conditions.ts` / `policy-dedup.ts`）。行数/文件数不在本表登记，以目录实际为准。

#### 服务层 (`server/src/services/`，文件数以目录为准)

**DuckDB 引擎簇（duckdb.ts 主入口 + 职责拆分）**

| 文件 | 职责 |
|------|------|
| `duckdb.ts` | DuckDB 连接池、查询执行、数据加载（单例主入口） |
| `duckdb-infra.ts` / `duckdb-types.ts` / `duckdb-type-converter.ts` | 连接基建 / 类型定义 / 类型转换 |
| `duckdb-parquet-loader.ts` / `duckdb-domain-loaders.ts` | Parquet 加载 / 分域加载器 |
| `duckdb-init-tables.ts` / `duckdb-materialization.ts` | 初始化建表 / 物化预聚合 |
| `duckdb-error-classifier.ts` | DuckDB 错误分类（可重试/致命错误判定） |
| `data-bootstrapper.ts` / `bootstrapper-registry.ts` / `lazy-domain-registry.ts` | 数据引导 / 引导注册表 / 懒加载域注册表 |

**通用立方体加速双轨（3 个）**

| 文件 | 职责 |
|------|------|
| `duckdb-cube.ts` | 立方体物化与查询执行（消费 `sql/cube/`；构建失败同版本退避 3 次 + OOM 结构化降级，2026-07-09 性能审计） |
| `cube-routing.ts` | 立方体灰度路由判定（`CUBE_ROUTING_ENABLED`/`CUBE_ROUTING_ROUTES`/`CUBE_SHADOW_COMPARE` 开关解析的 SSOT） |
| `cube-shadow.ts` | 影子对账（立方体 vs 明细双跑数值对比，灰度安全闸，与切流开关互斥；计数器落盘 `server/data/cube-shadow-stats.json` 跨 reload 累计） |

**认证与权限（5 个）**

| 文件 | 职责 |
|------|------|
| `auth.ts` | 认证服务（JWT 生成、密码验证） |
| `permission.ts` | 权限服务（机构过滤、SQL WHERE 子句生成） |
| `access-control.ts` / `access-control-store.ts` | 访问控制（dataScope/allowedRoutes）+ 持久化 |
| `personal-access-token.ts` / `personal-access-token-store.ts` | PAT（只读 Bearer Token）签发与校验 + 存储 |

**缓存 / 状态 / 数据版本（6 个）**

| 文件 | 职责 |
|------|------|
| `route-cache.ts` / `route-concurrency.ts` | 路由 LRU 内存缓存 / 并发控制 |
| `cache-warmer.ts` | 缓存预热 |
| `user-activation-cache.ts` | JWT 实时吊销：内存态「有效在职用户名」集合（authMiddleware O(1) 判定，隔离 duckdb 原生依赖） |
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
| `skills/` | 9 个技能定义：kpi-baseline / cost-diagnosis / claims-drilldown / risk-scoring / segment-risk-scan / pricing-simulation / report-template / attach-narrative / data-health |
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
| `field-registry/fields.json` | **字段唯一事实源**（字段数以该文件为准），codegen: `node scripts/field-registry/generate.mjs` |
| `metric-registry/` | 指标注册表（categories/ 按域分文件，数量以 `validate.ts` 为准） |
| `customer-categories.ts` | 客户类别枚举（11 类）+ 分组常量 + 辅助函数 |
| `env.ts` | 环境变量集中管理（分组启动时校验） |
| `api-routes.ts` | API 路由路径常量（前后端一致） |
| `route-param-contracts.ts` | 路由参数契约（path→zod/解析字段，governance「RouteCatalog参数契约」对账源） |
| `query-routes-metadata.ts` | 查询路由元数据（`RouteTimeWindow` 时间口径七枚举） |
| `disambiguation-protocol.ts` | 时间口径反问协议机器可读 SSOT（B290，4 类触发） |
| `filter-dimension-capability.ts` | 筛选维度能力矩阵（与前端镜像，governance「能力矩阵镜像」对账） |
| `sql-federation-policy.ts` | 多省联邦策略（部署省码、current/ 子目录布局开关） |
| `paths.ts` | 文件路径配置 |
| `earned-premium-factors.ts` | 已赚保费险类系数 α 唯一事实源（0.82/0.94/0.90，SQL 生成器共享，2026-07 硬编码专项收口） |
| `preset-users.ts` | 预设用户凭据 |

> 其余配置文件（auth/cors/csp/database/organizations/fixed-cost-params/comprehensive-thresholds/renewal-tracker/route-field-legend/branch-names/capability-registry 等）以目录实际为准。

#### 中间件 (`server/src/middleware/`)

| 文件 | 职责 |
|------|------|
| `auth.ts` | JWT/PAT 认证中间件 |
| `permission.ts` | 角色权限中间件 |
| `readonly.ts` | 只读拦截（PAT 强制只读，拦 POST/PUT/DELETE） |
| `rateLimiter.ts` | 三级限流（api/login/query + PAT 单独桶） |
| `audit.ts` | 审计日志中间件（`logs/audit.log`，含 auth_kind/token_id） |
| `brotli.ts` | Brotli 压缩 |
| `special-feature.ts` | 特性开关守卫 |
| `error.ts` | 全局错误处理中间件（含 404 notFoundHandler） |

#### 工具函数 (`server/src/utils/`，文件数以目录为准)

| 分组 | 文件 | 职责 |
|------|------|------|
| SQL 安全 | `sql-validator.ts` / `sql-sanitizer.ts` / `sql-permission-injector.ts` | 只读校验 / 参数转义 / 权限过滤注入 |
| 安全与日志 | `security.ts` / `logger.ts` | API Key 脱敏、危险字符黑名单 / 日志工具 |
| 请求上下文 | `request-context.ts` / `api-meta.ts` / `ip.ts` / `accept-encoding.ts` | 请求元信息 / API 响应元数据 / IP 解析 / 编码协商 |
| 路由与参数 | `route-helpers.ts` / `filter-params.ts` / `date.ts` / `parse-env.ts` | 路由辅助（含 timeWindow 编译期不变量） / 筛选参数解析 / 日期工具 / 环境变量解析 |
| Parquet | `parquet-metadata.ts` / `parquet-source.ts` | Parquet 元数据读取 / 数据源定位 |

### 前端核心模块

#### API 客户端 (`src/shared/api/`)

> 2026-06 Phase 2 神类拆分：`client.ts`（原 1250 行）拆为 传输内核 + 业务域方法层 + 13 个命名空间子客户端（2026-07 patrol 域整链退役后现存 12 个）。单例仍是 `apiClient`。

| 文件 | 职责 |
|------|------|
| `client.ts` | 业务域方法层 `ApiClient` + 单例 `apiClient`：会话生命周期（login/logout/getCurrentUser）+ 核心查询（getKpi/getTrend/getComprehensiveBundle/...）+ 挂载 12 个子客户端 |
| `client-core.ts` | 传输内核 `ApiClientCore`（token / request / GET 合并 / 30s 超时 / 401 静默刷新）+ 只读句柄 `ApiTransport` |
| `*-api.ts`（12 个） | 命名空间业务域子客户端：`apiClient.{auth,ai,data,workflows,crossSell,performance,repair,claimsDetail,quoteConversion,customerFlow,premium,geo}.*`，各持只读 `ApiTransport` |

> 守卫：契约 `tests/api/client-contracts.test.ts` · 传输内核 `tests/api/client-core-transport.test.ts` · 架构边界 `tests/api/sub-client-boundary.test.ts` · 金 master `tests/api/client-wire-golden.test.ts`（99 业务方法逐一 verb/path/param/body/auth/dedupe vs 冻结 golden，`UPDATE_GOLDEN=1` 重生） · 守恒 `scripts/api-wire-conservation.mjs`（原99 = 保留18 + Σ命名空间81，已入 governance #25） · 门禁 `scripts/check-hotfile-contracts.mjs`（锚 `client.ts` + `client-core.ts` + 全部 `*-api.ts`，清单从文件系统派生）。

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
| `useLoadingStates.ts` | 多状态加载管理 |
| `usePagination.ts` | 分页 Hook |
| `useFocusTrap.ts` | 焦点陷阱 Hook |
| `usePerspective.ts` | 视角状态管理 Hook（`ViewPerspective` + safeStorage 持久化） |
| `usePopoverPosition.ts` | 弹层定位 Hook（placement + 箭头样式计算） |
| `useRBAC.ts` | 角色权限 Hook（读 PermissionContext 的机构用户作用域） |
| `useScopeLabel.ts` | 数据范围标题标签 Hook（筛选状态 → 标题前缀） |
| `useStableParams.ts` | 参数引用稳定化 Hook（值相同返回旧引用，避免 useEffect 重复请求） |

> 历史 `useApiQuery.ts` / `useDataFetch.ts` 已移除；数据获取统一走 React Query + `apiClient`。

#### 功能模块 (`src/features/`)

共 20 个模块（数量以目录为准，多数含 `components/hooks/utils/types` 三级分层）：

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
| Chart Ledger | `chart-ledger/` | 保险经营图表账本（12 类经营图表方法论按承保业务链路单页组织，真实数据驱动） |
| Copilot | `copilot/` | AI 副驾（对话式分析，含 __tests__） |
| Home | `home/` | 首页数据导入（拖拽上传、最近文件、意图解析 intentParser） |
| Filters | `filters/` | 筛选面板（日期/机构/业务员/险别） |
| Admin | `admin/` | 管理后台（用户/PAT 管理） |
| Auth | `auth/` | 登录/认证页面 |
| File | `file/` | 文件菜单（数据导入/导出） |
| Pages | `pages/` | 页面路由组件 |

> 已下线：`sql-query/`（交互式 SQL 查询）、`marketing-report/`（营销战报）、`report/`（报表模板）、`settings/`（设置面板）已从 features/ 移除。

### 关键类型定义

| 类型/接口 | 路径 | 说明 |
|-----------|------|------|
| `ColumnMapping` | `server/src/normalize/mapping.ts` | 列名映射类型（字段数以 `field-registry/fields.json` 为准，codegen 派生，支持多别名） |
| `DomainField` | `server/src/normalize/mapping.ts` | 业务字段枚举类型 |
| `ValidationResult` | `server/src/normalize/mapping.ts` | 列名校验结果 |
| `TypeValidationResult` | `server/src/normalize/validator.ts` | 数据类型校验结果 |
| `KpiData` | `server/src/types/data.ts` | 后端 KPI 指标数据 |
| `TrendDataPoint` | `server/src/types/data.ts` | 趋势数据点 |
| `AdvancedFilterState` | `server/src/types/data.ts` | 高级筛选器状态 |
| `KpiData` (前端) | `src/shared/api/types.ts` | 前端 KPI 数据接口 |
| `KpiDetailData` | `src/shared/api/types.ts` | KPI 详细数据（环形图） |
| `TrendData` | `src/shared/api/types.ts` | 趋势数据接口 |
| `FileInfo` | `src/shared/api/types.ts` | 文件信息接口 |
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

测试文件已达上百个，**不在此逐一枚举**（易腐）。收集范围的唯一事实源与运行命令（分层协议详见 CLAUDE.md §5）：

| 层 | 收集范围事实源 | 运行命令 | 环境 |
|----|--------------|---------|------|
| 单元测试 | `vite.config.ts` 的 `test.exclude`（原生 .node 依赖测试在此排除） | `bun run test --run`（⚠️ 不是 `bun test`；不带 `--run` 进 vitest watch） | CI + 本地 |
| 集成测试 | `vitest.integration.config.ts` | `bun run test:integration` | 仅本地（需 DuckDB 原生二进制） |
| Python 测试 | 根级 `pytest.ini` testpaths | `bun run test:py` | CI（production-gate）+ 本地 |
| E2E | `playwright.config.ts` | `bun run test:e2e`（需先 `bun run dev:full`） | 本地 |

代表性契约守卫（API 客户端金 master / 架构边界 / 传输内核）见上文「API 客户端」小节的守卫清单。

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
- 2026-07-08：事实核对大修——①易腐硬编码计数统一改「以目录/注册表为准」（features 21→20、routes 顶层 12→14、services 28→34、fields 56→以 fields.json 为准、metric categories 8→9 域、skills 8→9），并消除同文档内 19 vs 23 子路由自相矛盾（实际 22 子路由 + shared + bundles/）；②SQL 生成器表删除无事实源的「行数」列，子目录补登 `cube/`；③补登新模块：立方体双轨（duckdb-cube/cube-routing/cube-shadow）、duckdb-error-classifier、user-activation-cache、中间件 5 个（readonly/rateLimiter/audit/brotli/special-feature）、routes/ 下 2 个纯函数辅助模块（data-layout/discover-fields-view）、口径契约配置 5 个、chart-ledger 功能模块；④清理已消失实体：`widgets/export`、`useApiQuery`/`useDataFetch`、features `report/`/`settings/`、`holidayUtils.test.ts`、链路图中已归档的 `useDashboardData.ts`；⑤前端类型定义路径 client.ts → types.ts；⑥测试入口由 7 文件枚举（已烂 1 个）改为分层事实源表
- 2026-06-05：一级目录全景对齐——新增「前端 `src/` 一级目录全景」「后端 `server/src/` 一级目录全景」两张全景表，补登此前未文档化的前端 `app/charts/core/services/shims/types` 与后端 `agent/skills/scripts` 模块；新增 Agent 系统、技能编排系统两节；路由表补全 12 顶层路由 + API 前缀，服务层 5→28 文件，SQL 31→55（含子目录），features 13→21（移除已下线 `sql-query`/`marketing-report`）。
- 2026-02-13：全面更新为 API-only 架构，移除所有 DuckDB-WASM/Local 模式引用，更新数据链路为前端 API Client → 后端路由 → SQL 生成器 → DuckDB 服务，补全后端模块清单（路由/SQL/服务/中间件/工具）、前端模块清单（API/上下文/Hooks/功能模块）、测试清单。
