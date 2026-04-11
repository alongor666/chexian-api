# 代码索引 (CODE_INDEX)

**核心层目录地图**：快速定位关键代码入口与模块职责。

> 本项目为纯 API 模式（从 chexianYJFX 拆分），所有数据通过后端 DuckDB + REST API 获取，无 DuckDB-WASM / Local 模式。

## 核心层目录

| 层级 | 路径 | 职责 | 索引文件 |
|------|------|------|----------|
| 后端服务层 | `server/src/` | Express 服务、DuckDB 查询、SQL 生成、认证鉴权 | [server/src/sql/INDEX.md](../../server/src/sql/INDEX.md) |
| 前端共享层 | `src/shared/` | API 客户端、上下文管理、通用工具、类型定义 | [INDEX.md](../../src/shared/INDEX.md) |
| 功能特性层 | `src/features/` | Dashboard、Filters 等 13 个业务功能模块 | [INDEX.md](../../src/features/INDEX.md) |
| UI 组件层 | `src/widgets/` | Charts、KPI、Table 通用组件 | [INDEX.md](../../src/widgets/INDEX.md) |
| 自动化脚本 | `scripts/` | 治理校验、构建、CI/CD | [INDEX.md](../../scripts/INDEX.md) |

## 快速入口

### 数据处理链路（API 模式）
```
用户登录 → AuthContext 验证 → JWT Token
  ↓
src/shared/api/client.ts                          # 前端 API 客户端（统一入口）
  ├─ getKpi(filters)                              # /api/query/kpi
  ├─ getKpiDetail(filters)                        # /api/query/kpi-detail
  ├─ getTrend(granularity, filters)               # /api/query/trend
  ├─ getSalesmanRanking(limit, filters)           # /api/query/salesman-ranking
  └─ executeCustomQuery(sql)                      # /api/query/custom
  ↓
server/src/routes/query.ts                        # 路由聚合器（65 行，挂载 19 个子路由）
  ├─ server/src/routes/query/*.ts                 # 19 个子路由模块 + 1 个 shared.ts
  ↓
server/src/sql/*.ts                               # SQL 生成器（31 个文件：27 生成器 + 4 共享模块）
  ↓
server/src/services/duckdb.ts                     # 后端 DuckDB 服务（查询执行）
  ↓
src/features/dashboard/hooks/useDashboardData.ts  # 前端 Hook（数据获取）
  ↓
src/features/*                                    # 功能模块 UI 渲染
```

### 后端核心模块

#### 路由层 (`server/src/routes/`)

| 文件 | 职责 |
|------|------|
| `query.ts` | 查询路由聚合器（65 行，挂载 19 个子路由 + 统一认证中间件） |
| `query/*.ts` | 19 个子路由模块（KPI/趋势/排名/成本/系数/续保/交叉销售/赔案/报价等） |
| `data.ts` | 数据管理路由（文件上传/列表/加载） |
| `auth.ts` | 认证路由（登录/注册/Token 刷新） |
| `filters.ts` | 筛选选项路由（机构/业务员/客户类别等） |
| `ai.ts` | AI 助手路由（NL2SQL/智能分析） |

#### SQL 生成器 (`server/src/sql/`，31 个文件)

**共享基础设施（4 个）**

| 文件 | 行数 | 职责 |
|------|------|------|
| `sql-builder.ts` | 399 | 公共 CTE 构建器（`buildPolicyExposureCTE` 等，19+ 处调用） |
| `perspective-adapter.ts` | 190 | 视角 SQL 适配层（SELECT/WHERE/GROUP BY 视角切换） |
| `performance-analysis-shared.ts` | 545 | 业绩分析域共享逻辑 |
| `renewal-drilldown-shared.ts` | 218 | 续保下钻域共享逻辑 |

**业务域生成器（27 个）**

| 域 | 文件 | 行数 | 职责 |
|----|------|------|------|
| KPI | `kpi.ts` | 366 | 基础 KPI 查询（件数/保费/占比） |
| KPI | `kpi-detail.ts` | 177 | KPI 详细数据（环形图分解） |
| 趋势 | `trend.ts` | 561 | 趋势分析（日/周/月/年） |
| 增长 | `growth.ts` | 20 | 增长率分析桶（barrel re-export）→ `growth/` 子目录：`shared.ts`（类型+工具）/`yoy.ts`（同比）/`mom.ts`（环比）/`ytd.ts`（年累计）/`custom.ts`（自定义+预设）/`dual-metric.ts`（双指标对比） |
| 排名 | `salesman-ranking.ts` | 52 | 业务员排名 |
| 货车 | `truck.ts` | 192 | 营业货车专项（吨位分段） |
| 系数 | `coefficient.ts` | 494 | 商车自主定价系数监控 |
| 成本 | `cost.ts` | 996 | 成本分析（赔付率/费用率/综合成本率） |
| 成本 | `fee-analysis.ts` | 319 | 费用分析 |
| 成本 | `expense-development.ts` | 84 | 费用发展 |
| 续保 | `renewal-universe.ts` | 327 | 续保宇宙分析（应续/已续/报价） |
| 交叉销售 | `cross-sell.ts` | 289 | 交叉销售主查询 |
| 交叉销售 | `cross-sell-summary.ts` | 247 | 交叉销售汇总 |
| 交叉销售 | `cross-sell-trend.ts` | 111 | 交叉销售趋势 |
| 交叉销售 | `cross-sell-heatmap.ts` | 438 | 交叉销售热力图 |
| 交叉销售 | `cross-sell-org-trend.ts` | 114 | 交叉销售机构趋势 |
| 交叉销售 | `cross-sell-top-salesman.ts` | 107 | 交叉销售 Top 业务员 |
| 业绩 | `performance-analysis.ts` | 49 | 业绩分析桶（barrel re-export）→ `performance-analysis/` 子目录：`summary.ts`（汇总+周期边界）/`trend.ts`（趋势）/`drilldown.ts`（下钻）/`top-salesman.ts`（Top20 业务员） |
| 业绩 | `performance-heatmap.ts` | 463 | 业绩热力图（15 周期连续） |
| 综合 | `comprehensive-analysis.ts` | 271 | 综合分析（保费+赔款+费用+变动成本率） |
| 报表 | `premium-report.ts` | 125 | 保费报表 |
| 报表 | `premiumPlan.ts` | 382 | 保费达成下钻（计划 vs 实际） |
| 报表 | `marketing-report.ts` | 340 | 营销战报（假日分析） |
| 赔案 | `claims-detail.ts` | 517 | 赔案明细（未决监控+地理热力图） |
| 报价 | `quote-conversion.ts` | 287 | 报价转化分析 |
| 客户 | `customer-flow.ts` | 105 | 客户来源去向（转保/流失） |
| 维修 | `repair.ts` | 91 | 维修资源合作 |

#### 服务层 (`server/src/services/`)

| 文件 | 职责 |
|------|------|
| `duckdb.ts` | DuckDB 连接池、查询执行、数据加载（单例） |
| `column-normalizer.ts` | 列名标准化（中文→英文标准列名） |
| `auth.ts` | 认证服务（JWT 生成、密码验证） |
| `permission.ts` | 权限服务（机构过滤、SQL WHERE 子句生成） |
| `zhipu.ts` | 智谱 AI 服务（NL2SQL） |

#### 列名映射与校验 (`server/src/normalize/`)

| 文件 | 职责 |
|------|------|
| `mapping.ts` | 列名别名定义（42 个业务字段 → 多别名映射）⚠️ 由 codegen 生成，勿手动编辑 |
| `validator.ts` | 数据类型校验（EXPECTED_TYPES）⚠️ 由 codegen 生成，勿手动编辑 |

#### 配置注册表 (`server/src/config/`)

| 文件 | 职责 |
|------|------|
| `field-registry/fields.json` | **字段唯一事实源**（42 字段），codegen: `node scripts/field-registry/generate.mjs` |
| `metric-registry/` | 指标注册表（25 个指标） |
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
| `coefficient-period.ts` | 系数监控周期工具 |
| `logger.ts` | 日志工具 |

### 前端核心模块

#### API 客户端 (`src/shared/api/`)

| 文件 | 职责 |
|------|------|
| `client.ts` | 统一 API 客户端（JWT 认证、错误处理、所有后端请求入口） |

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

| 模块 | 路径 | 职责 |
|------|------|------|
| Home | `home/` | 首页数据导入（拖拽上传、最近文件） |
| Dashboard | `dashboard/` | 仪表盘主视图（KPI、图表、表格、续保分析） |
| Filters | `filters/` | 筛选面板（日期/机构/业务员/险别） |
| Growth | `growth/` | 增长率分析（同比/环比/年累计） |
| SQL Query | `sql-query/` | 交互式SQL查询（只读+聚合，NL2SQL） |
| Coefficient | `coefficient/` | 商车自主定价系数监控 |
| Cost | `cost/` | 成本分析（赔付率/费用率/综合费用率/变动成本率） |
| Premium Report | `premium-report/` | 保费报表（机构保费+业务员明细） |
| Marketing Report | `marketing-report/` | 营销战报（假日营销分析） |
| Auth | `auth/` | 登录/认证页面 |
| Report | `report/` | 报表模板功能 |
| Settings | `settings/` | 设置面板 |
| File | `file/` | 文件菜单（数据导入/导出） |
| Pages | `pages/` | 页面路由组件 |

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

## 2026-02-25 API-only 清理补充（新增）

- `src/features/dashboard/hooks/useDashboardData.ts`、`src/features/dashboard/Dashboard.tsx`、`src/features/filters/FilterPanel.tsx` 已归档，不再作为当前运行链路入口。
- 归档目录：`archive/legacy-code/2026-02-api-only/`（先归档，后续迭代再物理删除）。
- 当前看板主链路入口：`src/features/dashboard/PremiumDashboard.tsx` + `src/components/layout/PageFilterPanel.tsx`。
- 类型检查护栏：`scripts/check-governance.mjs` 新增 `TS检查范围`，禁止通过 `tsconfig.exclude` 排除活跃目录规避类型问题。

**变更记录**：
- 2026-02-13：全面更新为 API-only 架构，移除所有 DuckDB-WASM/Local 模式引用，更新数据链路为前端 API Client → 后端路由 → SQL 生成器 → DuckDB 服务，补全后端模块清单（路由/SQL/服务/中间件/工具）、前端模块清单（API/上下文/Hooks/功能模块）、测试清单。
