# 共享逻辑层 (Shared Layer)

**职责**：提供业务无关的通用逻辑（API 客户端、类型、工具、UI 基础组件、设计系统）。属 L1 共享层（分层权威见根目录 `ARCHITECTURE.md §2.2`），**禁止依赖 `src/features/**`**（governance「分层依赖边界」闸自动拦截）。

> 当前为 API-only 架构：数据查询统一入口 `api/client.ts` → 后端 `/api/*`。历史上的 `duckdb/`、`sql/`、`normalize/`、`cache/` 本地查询链路已整体移除（历史见 git log）。
> 本文件只保留当前态映射，禁止流水账式追加变更记录。

## 子模块

| 模块 | 路径 | 职责 | 文档 |
|------|------|------|------|
| API | `api/` | 后端 API 客户端：传输内核 + 命名空间业务域子客户端（统一 `/api/*` 入口） | 见下方「API 客户端结构」 |
| Types | `types/` | TypeScript 类型定义（数据/筛选/KPI/趋势/视角/预警/品牌类型） | 无独立文档 |
| Utils | `utils/` | 通用工具（格式化/日志/日期/导出/存储/ECharts 注册/机构与业务员展示） | 无独立文档 |
| Hooks | `hooks/` | 通用 React Hooks（视角/分页/RBAC/焦点陷阱/稳定参数等） | 无独立文档 |
| Contexts | `contexts/` | 全局 Context（数据加载/筛选/权限/分公司/稳定引用） | 无独立文档 |
| Components | `components/` | 跨页共享业务组件（QuickFilterBar、折叠筛选区） | 无独立文档 |
| Config | `config/` | 全局配置（图表样式/机构权限/客户类别/下钻维度/能力矩阵） | 无独立文档 |
| Export | `export/` | 导出上下文与截图豁免（`ExportContext.tsx`、`ignoreElements.ts`；PDF 生成活链路在 `src/services/PdfExportService.ts`） | [README](./export/README.md) |
| Theme | `theme/` | 主题系统（浅色/深色/随系统） | 无独立文档 |
| UI | `ui/` | 基础 UI 组件库 | 见下方「UI 组件库」 |
| Styles | `styles/` | 统一设计系统（唯一事实源 `styles/index.ts`） | `DESIGN.md` |

## 关键入口文件

### API 客户端结构（Phase 2 拆分后）

`src/shared/api/client.ts` 拆为三层，单例仍是 `apiClient`：

- **`client.ts`** — 业务域方法层 `ApiClient extends ApiClientCore`：会话生命周期（`login`/`logout`/`getCurrentUser`）+ 核心查询（`getKpi`/`getTrend`/`getComprehensiveBundle`/`getPivot`/...）+ 挂载命名空间子客户端。
- **`client-core.ts`** — 传输内核 `ApiClientCore`（token 生命周期 / `request` / GET 同 key 合并 / 30s 超时 / 401 静默刷新）+ **只读**传输句柄 `ApiTransport`。
- **`*-api.ts`** — 命名空间子客户端，调用形 `apiClient.{auth,ai,data,workflows,crossSell,performance,repair,claimsDetail,quoteConversion,customerFlow,premium,geo}.方法()`，各持只读 `ApiTransport`（不能写 token）。

**架构不变量（机器强制）**：`tests/api/sub-client-boundary.test.ts`（禁 token 写 / 禁 new 第二个 core / 禁 import 单例）、`tests/api/client-core-transport.test.ts`（鉴权头 / 401 刷新 / GET 合并 / 超时）、契约门禁 `scripts/check-hotfile-contracts.mjs`。

### Contexts

- **`contexts/DataContext.tsx`**：数据加载状态（`isDataLoaded` / `refreshFiles` Promise 级合并）
- **`contexts/FilterContext.tsx`**：全局筛选状态（跨页面共享，`useGlobalFilters`）
- **`contexts/PermissionContext.tsx`**：用户权限（分公司管理员/三级机构用户，`usePermission`）

### Utils（高频）

- **`utils/formatters.ts`**：统一格式化唯一事实源（`formatCount`/`formatPremiumWan`/`formatPercent`/`formatCoefficient`/`formatChartValue`/`formatSalesmanName` 等，禁止在特性层另写格式化）
- **`utils/echarts.ts`**：ECharts 按需导入注册
- **`utils/size-sensor.ts`**：size-sensor 安全兼容层（⚠️ 经 `vite.config.ts` 包别名被 echarts-for-react 使用，引用图分析不可见，勿当死代码删除）
- **`utils/logger.ts`** / **`utils/storage.ts`** / **`utils/date.ts`** / **`utils/export.ts`**（CSV/Excel）
- **`utils/quickFilterHelpers.ts`**：快捷筛选派生与回写

### Config

- **`config/organizations.ts`**：机构与权限（三级机构、角色、路由白名单、旧路由重定向映射）
- **`config/filter-dimension-capability.ts`**：维度×数据域能力矩阵（与 server 端镜像逐字一致，governance「能力矩阵镜像」对账）
- **`config/chartStyles.ts`** / **`config/customer-categories.ts`** / **`config/drilldown-dimensions.ts`** / **`config/org-groups.ts`**

## UI 组件库（`ui/`）

所有功能模块优先使用这些组件，禁止重写同功能组件。

| 组件 | 文件 | 说明 |
|------|------|------|
| Card / StatCard | `Card.tsx` | 卡片容器 / 统计数值卡片 |
| Button / IconButton / ButtonGroup | `Button.tsx` | 按钮族 |
| Badge / StatusBadge / CountBadge | `Badge.tsx` | 徽章族 |
| Input / SearchInput / PasswordInput / TextArea / FormItem | `Input.tsx` | 输入族 |
| Select / NativeMultiSelect | `Select.tsx` | 选择器 |
| Table / NumericCell / TrendCell / StatusCell | `Table.tsx` | 表格（排序/固定表头/斑马纹）与语义单元格 |
| RateCell | `RateCell.tsx` | 率值单元格（polarity + baseline 趋势色） |
| StickyTableFrame | `StickyTableFrame.tsx` | 长表滚动容器（表头吸顶 + 首列冻结，配 `styles` 的 `stickyTableStyles`） |
| Tabs | `Tabs.tsx` | 标签页 |
| Icon | `Icon.tsx` | 图标（lucide-react） |
| Skeleton / KpiCardSkeleton / TableSkeleton / DashboardSkeleton | `Skeleton.tsx` | 骨架屏族 |
| EmptyState / ErrorState | `EmptyState.tsx` / `ErrorState.tsx` | 空态/错误态 |
| Drilldown 族 | `DrilldownBreadcrumb/Cell/ExhaustedBanner/LoadingOverlay.tsx` | 下钻交互组件 |
| ConfirmDialog / SectionTitle / FunnelIndicator / RenewalStatusBadge / PageWithRightFilter | 同名文件 | 其余通用件 |

## 统一设计系统（`styles/`）

唯一事实源 `styles/index.ts`：设计令牌（`colors`/`spacing`/`fontSize`/...）、组件样式常量（`cardStyles`/`buttonStyles`/`tableStyles`/`textStyles`/`fontStyles`/`stickyTableStyles`/`comprehensiveTheme`）、工具函数（`cn`/`getTrendColorClass`/`getTrendColorClassByPolarity`/`MetricPolarity`/`getYearChartColor`）。使用规范见 `DESIGN.md` §8 与 `.claude/rules/frontend.md`。

## 禁止触碰区域

业务口径相关配置修改需产品确认 + BACKLOG 登记（`config/organizations.ts` 权限映射、`config/filter-dimension-capability.ts` 能力矩阵——后者与 server 镜像由 governance 对账）。

## 链接到全局索引

- **代码索引**: [CODE_INDEX](../../开发文档/00_index/CODE_INDEX.md)
- **文档索引**: [DOC_INDEX](../../开发文档/00_index/DOC_INDEX.md)

---

**变更规则**：新增子模块必须在此登记；本文件只保留当前态映射（历史由 git 承载）。
