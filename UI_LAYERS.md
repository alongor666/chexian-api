# 车险API - UI层级结构文档

> 记录系统中所有页面、板块及其层级关系

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      登录层 (/login)                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    主应用层 (SidebarLayout)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      侧边栏导航                            │  │
│  │  首页 | 仪表盘 | 保费报表 | 营销战报 | 营业货车 | 续保分析  │  │
│  │  车驾意推介率 | 增长分析 | 成本分析 | 数据对比 | 系数监控   │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     主内容区域                              │  │
│  │  (根据路由渲染对应页面)                                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、页面清单

### 2.1 一级页面（路由级）

| 路由路径 | 页面名称 | 组件 | 描述 |
|----------|----------|------|------|
| `/login` | 登录页 | `LoginPage` | 用户登录认证 |
| `/` | 首页 | `DataImportPage` | 数据导入管理 |
| `/dashboard` | 仪表盘 | `PremiumDashboard` | 核心业务仪表盘 |
| `/premium-report` | 保费报表 | `PremiumReportPage` | 保费数据报表 |
| `/marketing-report` | 营销战报 | `MarketingReportPage` | 营销业绩战报 |
| `/truck` | 营业货车 | `TruckPage` | 货车业务分析 |
| `/renewal` | 续保分析 | `RenewalPage` | 续保业务分析 |
| `/cross-sell` | 车驾意推介率 | `CrossSellPage` | 交叉销售分析 |
| `/growth` | 增长分析 | `GrowthPage` | 业务增长分析 |
| `/cost` | 成本分析 | `CostPage` | 成本与费用分析 |
| `/comparison` | 数据对比 | `ComparisonPage` | 多维度数据对比 |
| `/coefficient` | 系数监控 | `CoefficientPage` | 系数监控分析 |
| `/sql-query` | SQL查询 | `SqlQueryPage` | 自定义SQL查询 |
| `/templates` | 报表模板 | `ReportTemplatesPanel` | 报表模板管理 |

**页面总数：14 个一级页面**

---

## 三、页面详情与子板块

### 3.1 首页 (`/`)

> 路径：`src/features/home/DataImportPage.tsx`

**子板块：**
- 数据导入区域
- 文件列表展示
- 数据状态显示
- 导入进度提示

---

### 3.2 仪表盘 (`/dashboard`)

> 路径：`src/features/dashboard/PremiumDashboard.tsx`

**包含页面：**
- `Dashboard.tsx` - 主仪表盘页面
- `PremiumDashboard.tsx` - 保费仪表盘入口

**子板块：**
| 板块名称 | 组件 | 路径 |
|----------|------|------|
| KPI卡片区 | `KpiSection` | `components/KpiSection.tsx` |
| 玫瑰图区 | `RoseChartsSection` | `components/RoseChartsSection.tsx` |
| 表格区 | `TableSection` | `components/TableSection.tsx` |
| 趋势图区 | `TrendSection` | `components/TrendSection.tsx` |
| 告警面板 | `AlertPanel` | `widgets/alerts/AlertPanel.tsx` |
| 交叉销售分析 | `CrossSellAnalysisPanel` | `CrossSellAnalysisPanel.tsx` |
| 续保分析 | `RenewalAnalysisPanel` | `RenewalAnalysisPanel.tsx` |
| 续保钻取 | `RenewalDrilldownPanel` | `RenewalDrilldownPanel.tsx` |
| 货车分析 | `TruckAnalysisPanel` | `TruckAnalysisPanel.tsx` |

**子板块总数：9 个**

---

### 3.3 保费报表 (`/premium-report`)

> 路径：`src/features/pages/PremiumReportPage.tsx`

**子板块：**
| 板块名称 | 组件 | 路径 |
|----------|------|------|
| 保费计划面板 | `PremiumPlanPanel` | `premium-report/components/PremiumPlanPanel.tsx` |
| 保费报表面板 | `PremiumReportPanel` | `premium-report/components/PremiumReportPanel.tsx` |
| 保费汇总卡片 | `PremiumSummaryCard` | `premium-report/components/PremiumSummaryCard.tsx` |

**子板块总数：3 个**

---

### 3.4 营销战报 (`/marketing-report`)

> 路径：`src/features/pages/MarketingReportPage.tsx`

**子板块：**
| 板块名称 | 组件 | 路径 |
|----------|------|------|
| 营销报表面板 | `MarketingReportPanel` | `marketing-report/components/MarketingReportPanel.tsx` |
| 节假日钻取面板 | `HolidayDrilldownPanel` | `marketing-report/components/HolidayDrilldownPanel.tsx` |
| 节假日汇总卡片 | `HolidaySummaryCard` | `marketing-report/components/HolidaySummaryCard.tsx` |
| 机构报表表格 | `OrganizationReportTable` | `marketing-report/components/OrganizationReportTable.tsx` |
| 业务员明细表 | `SalesmanDetailTable` | `marketing-report/components/SalesmanDetailTable.tsx` |
| 可排序表格 | `SortableTable` | `marketing-report/components/SortableTable.tsx` |

**子板块总数：6 个**

---

### 3.5 营业货车 (`/truck`)

> 路径：`src/features/pages/TruckPage.tsx`

**子板块：**
- 货车分析图表
- 按吨位分类图表
- 机构对比图表

---

### 3.6 续保分析 (`/renewal`)

> 路径：`src/features/pages/RenewalPage.tsx`

**子板块：**
- 续保KPI漏斗
- 续保趋势图表
- 续保明细表格

---

### 3.7 车驾意推介率 (`/cross-sell`)

> 路径：`src/features/pages/CrossSellPage.tsx`

**子板块：**
- 交叉销售分析面板
- 象限分析视图
- 时间周期汇总

---

### 3.8 增长分析 (`/growth`)

> 路径：`src/features/pages/GrowthPage.tsx`

**子板块：**
| 板块名称 | 组件 | 路径 |
|----------|------|------|
| 增长分析面板 | `GrowthAnalysisPanel` | `growth/components/GrowthAnalysisPanel.tsx` |
| 对比分析面板 | `ComparisonAnalysisPanel` | `growth/components/ComparisonAnalysisPanel.tsx` |
| 增长对比区块 | `GrowthComparisonSection` | `growth/components/GrowthComparisonSection.tsx` |
| 增长明细区块 | `GrowthDetailSection` | `growth/components/GrowthDetailSection.tsx` |
| 增长KPI卡片 | `GrowthKpiCards` | `growth/components/GrowthKpiCards.tsx` |
| 月份标签页 | `GrowthMonthTabs` | `growth/components/GrowthMonthTabs.tsx` |

**子板块总数：6 个**

---

### 3.9 成本分析 (`/cost`)

> 路径：`src/features/pages/CostPage.tsx`

**子板块：**
| 板块名称 | 组件 | 路径 |
|----------|------|------|
| 成本分析面板 | `CostAnalysisPanel` | `cost/components/CostAnalysisPanel.tsx` |
| 已赚保费图表 | `EarnedPremiumCharts` | `cost/components/EarnedPremiumCharts.tsx` |
| 已赚保费表格 | `EarnedPremiumTable` | `cost/components/EarnedPremiumTable.tsx` |
| 费用率预测面板 | `ExpenseRatioForecastPanel` | `cost/components/ExpenseRatioForecastPanel.tsx` |
| 变动成本KPI板 | `VariableCostKpiBoard` | `cost/components/VariableCostKpiBoard.tsx` |
| 成本分析控制面板 | `CostAnalysisControlPanel` | `cost/components/CostAnalysisControlPanel.tsx` |
| 赔付率表格 | `ClaimRatioTable` | `cost/components/ClaimRatioTable.tsx` |

**子板块总数：7 个**

---

### 3.10 数据对比 (`/comparison`)

> 路径：`src/features/pages/ComparisonPage.tsx`

**子板块：**
- 双轴对比图表
- 多维度选择器

---

### 3.11 系数监控 (`/coefficient`)

> 路径：`src/features/pages/CoefficientPage.tsx`

**子板块：**
- 系数分析图表
- 系数筛选控制

---

### 3.12 SQL查询 (`/sql-query`)

> 路径：`src/features/sql-query/SqlQueryPage.tsx`

**子板块：**
| 板块名称 | 组件 | 路径 |
|----------|------|------|
| SQL编辑器 | `SqlEditor` | `sql-query/SqlEditor.tsx` |
| 增强SQL编辑器 | `EnhancedSqlEditor` | `sql-query/EnhancedSqlEditor.tsx` |
| 查询构建器 | `QueryBuilderPanel` | `sql-query/queryBuilder/QueryBuilderPanel.tsx` |
| AI SQL面板 | `AiSqlPanel` | `sql-query/aiSql/AiSqlPanel.tsx` |
| 模板库 | `TemplateLibrary` | `sql-query/TemplateLibrary.tsx` |
| 查询结果 | `QueryResults` | `sql-query/QueryResults.tsx` |
| 参数表单 | `ParameterForm` | `sql-query/ParameterForm.tsx` |

**子板块总数：7 个**

---

### 3.13 报表模板 (`/templates`)

> 路径：`src/features/report/components/ReportTemplatesPanel.tsx`

**子板块：**
- 模板列表
- 模板预览
- 模板选择

---

## 四、共用组件库

### 4.1 组件 (src/components/)

| 组件 | 路径 | 用途 |
|------|------|------|
| SidebarLayout | `components/layout/SidebarLayout.tsx` | 侧边栏布局 |
| SidebarNavigation | `components/layout/SidebarNavigation.tsx` | 侧边栏导航 |
| SidebarFilterPanel | `components/layout/SidebarFilterPanel.tsx` | 侧边栏筛选面板 |
| FilterPanel | `features/filters/FilterPanel.tsx` | 筛选面板 |
| DataGuard | `components/layout/DataGuard.tsx` | 数据守卫 |
| AuthGuard | `components/layout/AuthGuard.tsx` | 认证守卫 |
| ErrorBoundary | `components/layout/ErrorBoundary.tsx` | 错误边界 |

### 4.2 通用组件 (src/widgets/)

| 组件 | 路径 |
|------|------|
| AlertPanel | `widgets/alerts/AlertPanel.tsx` |
| AlertBadge | `widgets/alerts/AlertBadge.tsx` |
| DataScopeAlert | `widgets/alerts/DataScopeAlert.tsx` |
| BarChart | `widgets/charts/BarChart.tsx` |
| LineChart | `widgets/charts/LineChart.tsx` |
| RoseChart | `widgets/charts/RoseChart.tsx` |
| GroupedBarChart | `widgets/charts/GroupedBarChart.tsx` |
| DualYAxisComparisonChart | `widgets/charts/DualYAxisComparisonChart.tsx` |
| WaterfallChart | `widgets/charts/WaterfallChart.tsx` |
| KpiCard | `widgets/kpi/KpiCard.tsx` |
| EnhancedKpiCard | `widgets/kpi/EnhancedKpiCard.tsx` |
| RenewalKpiFunnel | `widgets/kpi/RenewalKpiFunnel.tsx` |
| VirtualTable | `widgets/table/VirtualTable.tsx` |
| EnhancedVirtualTable | `widgets/table/EnhancedVirtualTable.tsx` |
| ExportDialog | `widgets/export/ExportDialog.tsx` |
| PerspectiveSwitcher | `widgets/filters/PerspectiveSwitcher.tsx` |

---

## 五、UI层级统计

| 层级 | 类型 | 数量 |
|------|------|------|
| 一级 | 页面（路由级） | 14 |
| 二级 | 子板块（各页面内） | 约 40+ |
| 三级 | 共用组件 | 30+ |

**总页面数：14 个**
**总子板块数：约 40+ 个**

---

## 六、路由守卫

| 守卫类型 | 页面范围 | 说明 |
|----------|----------|------|
| 无守卫 | `/login` | 不需要认证 |
| AuthGuard | 主应用所有页面 | 需要登录认证 |
| DataGuard | 除首页/模板外的所有数据分析页面 | 需要加载数据 |

---

*文档创建时间：2026-02-21*
