# 功能特性层 (Features Layer)

**职责**：实现具体业务功能——取数（apiClient/React Query）、口径、装配；通用可视化能力一律复用 L1（`src/shared/` + `src/widgets/`），**不得横向互引其他特性域**（分层权威见根目录 `ARCHITECTURE.md §2.2`，governance「分层依赖边界」闸拦截）。

> 本文件只保留"模块 → 职责 → 入口"的**当前态映射**（历史变更见 git log）。体验层组织原则（决策五问）与组件收敛路线见 `开发文档/架构设计/前端极简架构规划_2026-07-07.md`。

## 页面主链路

- 入口路由：`src/app/App.tsx`（HashRouter，路由 × 权限守卫 × 懒加载）
- 页面容器：`src/features/pages/*Page.tsx`（筛选 preset + 面板装配）
- 统一筛选：`src/features/filters/PageFilterPanel.tsx` + `src/features/filters/AdvancedFilterPanel.tsx`
- 数据入口：`src/shared/api/client.ts`（`apiClient.*`，详见 CODE_INDEX.md）

## 模块清单（与 route registry 决策域对齐）

### 一、经营总览

| 模块 | 路由 | 职责 | 关键入口 |
|------|------|------|---------|
| `home/` | `/home` | 报告门户 | `HomePage.tsx` |
| `dashboard/`（保费看板部分） | `/dashboard` | 保费分析看板（KPI/趋势/排名/玫瑰图，bundle 优先） | `PremiumDashboard.tsx` · `hooks/useDashboardBundle.ts` |
| `chart-ledger/` | `/chart-ledger` | 保险经营图表账本（12 类经营图表方法论，真实数据+全局筛选联动） | `ChartLedgerPage.tsx` · [README](./chart-ledger/README.md) |

### 二、增长达成

| 模块 | 路由 | 职责 | 关键入口 |
|------|------|------|---------|
| `dashboard/`（业绩分析部分） | `/performance-analysis` | 业绩分析（热力图/环比/趋势/下钻/Top20，bundle 优先） | `PerformanceAnalysisPanel.tsx` · `performance/PerformanceOrgHeatmapV2/` |
| `growth/` | `/growth` | 增长率分析（同比/环比/年累计/对比分析） | `components/GrowthAnalysisPanel.tsx` · `hooks/useGrowthAnalysis.ts` |
| `premium-report/` | `/reports` | 保费达成（计划达成 + 机构/业务员保费报表） | `components/PremiumReportPanel.tsx` · `components/PremiumPlanPanel.tsx` |

### 三、成本质量

| 模块 | 路由 | 职责 | 关键入口 |
|------|------|------|---------|
| `cost/` | `/cost` | 成本分析（满期赔付率/费用率/综合成本率/变动成本率/已赚保费） | `components/CostAnalysisPanel.tsx` · `hooks/useCostAnalysis.ts` |
| `comprehensive-analysis/` | `/cost?view=comprehensive` | 综合分析子视图（六模块，单接口 bundle） | `hooks/useComprehensiveBundle.ts` · `pages/ComprehensiveAnalysisPage.tsx` |
| `claims-detail/` | `/claims-detail` | 赔案明细分析（独立数据源 ClaimsDetail） | `components/`（热力图/发展/地理风险面板） |
| `expense-development/` | `/expense-development` | 费用率发展（超级用户特性） | `components/ExpenseRatioDevelopmentPanel.tsx` |
| `moto-cost/` | `/moto-cost` | 摩托车成本模型（外部 iframe，特性授权） | `index.ts` |

### 四、客户经营（续保/转化/流向）

| 模块 | 路由 | 职责 | 关键入口 |
|------|------|------|---------|
| `renewal-tracker/` | `/renewal-tracker` | 商业险续保追踪（到期窗口盯盘，独立派生域） | `RenewalTrackerPage.tsx` |
| `quote-conversion/` | `/quote-conversion` | 报价转化分析（独立数据源） | `QuoteConversionPage.tsx` |
| `customer-flow/` | `/customer-flow` | 客户来源去向分析（独立数据源） | `CustomerFlowPage.tsx` |

### 五、专项资源

| 模块 | 路由 | 职责 | 关键入口 |
|------|------|------|---------|
| `dashboard/`（交叉销售部分） | `/specialty?tab=cross-sell` | 驾意险交叉销售（KPI/热力图/趋势/下钻/Top20，bundle 优先） | `CrossSellAnalysisPanel.tsx` · `hooks/useCrossSellAnalysis.ts` |
| `dashboard/`（货车专项部分） | `/specialty?tab=truck` | 营业货车专项分析 | `TruckAnalysisPanel.tsx` |
| `repair/` | `/repair` | 维修资源分析（独立数据源 RepairDim） | `RepairPage.tsx` |

### 六、平台管理

| 模块 | 路由 | 职责 | 关键入口 |
|------|------|------|---------|
| `home/` | `/data-import` | 数据管理与导入 | `DataImportPage.tsx` |
| `admin/` | `/admin/access-control` | 用户、角色与页面权限配置 | `AccessControlPage.tsx` |

### 支撑模块（非分析页面）

| 模块 | 职责 | 关键入口 |
|------|------|---------|
| `pages/` | 页面容器装配（筛选 preset + 面板 + 锚点骨架） | `PremiumDashboardPage` / `PerformanceAnalysisPage` / `GrowthPage` / `CostPage` / `ReportsPage` / `SpecialtyPage` / `ClaimsDetailPage` / `ComprehensiveAnalysisPage` |
| `filters/` | 筛选面板（页面容器/高级筛选/日期口径/页面标题栏） | `PageFilterPanel.tsx` · `AdvancedFilterPanel.tsx` · `FilterLayoutV2.tsx` · `PageHeaderBar.tsx` |
| `auth/` | 登录 + 会话 + 路由权限守卫 | `LoginPage` · `AuthGuard` · `RouteAccessGuard` |
| `admin/` | 权限管理（分公司管理员专属） | `AccessControlPage.tsx` |
| `copilot/` | 经营副驾抽屉（预测基线/情景推演） | `CopilotDrawer.tsx`（经 `copilot` slot 由 App 注入 `SidebarLayout`） |
| `file/` | 文件菜单弹窗（导入/导出/报表模板） | `FileMenu.tsx` · `DataImportModal` / `ExportModal` / `ReportTemplatesModal`（经 `fileMenu` slot 由 App 注入顶栏） |

## 数据流（当前 API-only 架构）

```
features/filters（全局筛选 FilterContext）
  → features/*/hooks/use*.ts（React Query 优先；bundle 路由优先 + 回退组合查询）
  → shared/api/client.ts（apiClient）→ GET /api/query/*
  → 面板组件装配 L1 可视化（widgets/charts · widgets/kpi · shared/ui 表格）
```

加载策略：并行查询 + 请求取消 + 错误隔离；SW 活跃时 React Query `staleTime=Infinity`（见 `src/app/App.tsx`）。

## 待开发功能

见 [BACKLOG.md](../../BACKLOG.md)；组件收敛 follow-up（ECharts 容器/KPI 卡/热力图归一）见架构规划文档第六节。

## 链接到全局索引

- **代码索引**: [CODE_INDEX](../../开发文档/00_index/CODE_INDEX.md)
- **文档索引**: [DOC_INDEX](../../开发文档/00_index/DOC_INDEX.md)

---

**变更规则**：新增/删除/移动特性模块必须同步本清单；禁止流水账式追加变更记录（历史由 git 承载）。
