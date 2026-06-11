# 功能特性层 (Features Layer)

**职责**：实现具体业务功能，组合共享逻辑与 UI 组件。

## 子模块

| 模块 | 路径 | 职责 | 文档 |
|------|------|------|------|
| Home | `home/` | 首页数据导入（拖拽上传、最近文件） | 无独立文档 |
| Dashboard | `dashboard/` | 仪表盘主视图（KPI、图表、表格） | [README](./dashboard/README.md) |
| Filters | `filters/` | 筛选面板（日期、业务员、机构） | 无独立文档 |
| Growth | `growth/` | 增长率分析（同比、环比、年累计、自定义期间） | [README](./growth/README.md) |
| Premium Report | `premium-report/` | 保费报表（机构保费统计+业务员保费明细+汇总） | 无独立文档 |
| SQL Query | `sql-query/` | 交互式SQL查询（只读+聚合，预置模板，导出） | [README](./sql-query/README.md) |
| Report | `report/` | 报表模板功能（预设分析场景模板） | [README](./report/README.md) |
| Coefficient | `coefficient/` | 商车自主定价系数监控（阈值合规、周期分表、缺口保费） | 无独立文档 |
| Cost | `cost/` | 成本分析（赔付率/费用率/综合费用率/变动成本率/已赚保费） | 无独立文档 |
| Comprehensive Analysis | `comprehensive-analysis/` | 综合分析页（autowrKPI 六模块复刻，单接口 bundle） | 无独立文档 |
| Marketing Report | `marketing-report/` | 营销战报（假日营销分析：机构战报+业务员明细） | 无独立文档 |
| Pages | `pages/` | 独立页面组件（筛选器+分析面板） | 无独立文档 |
| Renewal Tracker | `renewal-tracker/` | 商业险续保追踪（到期日窗口盯盘 + buildRenewalTrackerParams 受限参数集映射层） | 无独立文档 |
| Settings | `settings/` | 设置面板（主题设置、系统设置） | 无独立文档 |
| File | `file/` | 文件菜单弹窗（数据导入、导出、报表模板） | 无独立文档 |
| Slide Report | `slide-report/` | PPT风格周报查看器（16:9幻灯片+导航+全屏+导出） | [规划文档](../../.claude/plans/【功能实施】PPT风格周报查看器规划.md) |

## 关键入口文件

### Home 模块
- **`home/DataImportPage.tsx`**: 首页数据导入页面（拖拽上传、最近文件列表、快捷操作）

### Dashboard 模块
- **`dashboard/Dashboard.tsx`**: 仪表盘容器组件（状态管理、数据加载）
- **`dashboard/useDashboardData.ts`**: 数据加载自定义 Hook（并发控制、错误处理）
- **`dashboard/PremiumDashboard.tsx`**: 保费分析看板（含占比玫瑰图、标签页切换）
- **`dashboard/TruckAnalysisPanel.tsx`**: 营业货车专项分析面板（玫瑰图+双Y图，2026-01-12修复：添加DuckDB数据加载检查）
- **`dashboard/TruckAnalysisPanel.tsx`**: 营业货车专项分析面板（左右布局+机构占比饼图+下钻堆叠图）
- **`dashboard/hooks/usePerspective.ts`**: 视角状态管理 Hook（支持保费/商业险件数/交强险件数切换+localStorage持久化）

### Filters 模块
- **`filters/FilterPanel.tsx`**: 筛选面板 UI 组件
- **`filters/useFilters.ts`**: 筛选状态管理 Hook
- **`filters/AdvancedFilterPanel.tsx`**: 高级筛选面板（切片器分组与三态按钮）
- **`filters/AdvancedFilterPanel.tsx`**: 切片器式筛选布局（含月份筛选与一键切换）
- **`filters/FilterLayoutV2.tsx`**: 置顶两行筛选布局（口径/年度/日期与机构/客户/险别）

### Growth 模块
- **`growth/hooks/useGrowthAnalysis.ts`**: 增长率分析 Hook（支持同比/环比/年累计/双指标对比）
- **`growth/components/GrowthAnalysisPanel.tsx`**: 增长率分析面板组件（含对比分析视图）
- **`growth/components/ComparisonQuickPresets.tsx`**: 对比快捷预设按钮组件（同比YoY/环比月MoM/环比周WoW/自定义）
- **`growth/utils/comparisonPresets.ts`**: 对比分析预设日期计算工具（智能期间对齐、闰年处理）
- **`shared/sql/growth.ts`**: 增长率 SQL 生成器（CTE模式、PolicyFact视图、双指标对比查询）

### SQL Query 模块
- **`sql-query/SqlQueryPage.tsx`**: SQL 查询主页面（编辑器+模板库+构建器+结果展示）
- **`sql-query/useQueryExecutor.ts`**: SQL 查询执行 Hook（验证+超时+批次管理）
- **`sql-query/SqlEditor.tsx`**: Monaco 编辑器组件（SQL 高亮+快捷键）
- **`sql-query/EnhancedSqlEditor.tsx`**: 增强版 Monaco 编辑器（集成智能补全）
- **`sql-query/useSqlAutocomplete.ts`**: SQL 自动补全 Hook（字段/函数/关键字）
- **`sql-query/QueryResults.tsx`**: 查询结果组件（分页+导出）
- **`sql-query/TemplateLibrary.tsx`**: 预置查询模板库（17个模板，分7类）
- **`sql-query/QUERY_TEMPLATES.ts`**: 模板定义（只读+聚合+参数化）
- **`sql-query/ParameterForm.tsx`**: 参数化查询表单（动态参数输入+防重复筛选）
- **`sql-query/queryBuilder/`**: 可视化查询构建器模块（维度/度量选择+筛选条件+SQL生成）
  - `types.ts`: 类型定义（QueryBuilderState/FieldDefinition/FilterCondition）
  - `fieldConfig.ts`: 字段元数据（14个维度字段+6个度量字段+6个预设度量）
  - `sqlGenerator.ts`: SQL 生成器（聚合表达式+筛选条件+分组排序）
  - `useQueryBuilder.ts`: 状态管理 Hook（维度/度量/筛选操作）
  - `QueryBuilderPanel.tsx`: 主面板组件（维度/度量/筛选选择器+SQL预览）
  - `DimensionSelector.tsx`: 维度选择器（分组下拉+Chips）
  - `MeasureSelector.tsx`: 度量选择器（预设快选+自定义配置）
  - `FilterBuilder.tsx`: 筛选条件构建器（动态字段选项加载）
- **`sql-query/aiSql/`**: AI SQL 生成模块（智谱 GLM 自然语言转 SQL）
  - `types.ts`: 类型定义（ZhipuConfig/AISqlResult/ChatMessage）
  - `systemPrompt.ts`: System Prompt（车险数据专用 SQL 生成提示词）
  - `zhipuClient.ts`: 智谱 API 客户端（调用 GLM 模型）
  - `configStore.ts`: API Key 配置存储（localStorage）
  - `AiSqlPanel.tsx`: AI SQL 面板（自然语言输入+配置管理+生成执行）

### Report 模块
- **`report/components/ReportTemplatesPanel.tsx`**: 报表模板选择面板（6个预设模板，分6类）

### Pages 模块（侧边栏独立页面）
- **`pages/index.ts`**: 独立页面组件导出入口
- **`pages/RenewalPage.tsx`**: 续保分析页面（筛选面板+分析面板）
- **`pages/GrowthPage.tsx`**: 增长分析页面（筛选面板+分析面板）
- **`pages/CostPage.tsx`**: 成本分析页面（筛选面板+分析面板）
- **`pages/CoefficientPage.tsx`**: 系数监控页面（筛选面板+分析面板）
- **`pages/ComprehensiveAnalysisPage.tsx`**: 综合分析页面（6模块 Tab + loss 子视图 + bundle 单请求）
- **`pages/PremiumReportPage.tsx`**: 保费报表页面（筛选面板+保费报表面板）
- **`pages/MarketingReportPage.tsx`**: 营销战报页面（筛选面板+战报面板）

### Marketing Report 模块（营销战报）
- **`marketing-report/index.ts`**: 模块导出入口
- **`marketing-report/types/marketingReport.ts`**: 类型定义（OrganizationReportRow/SalesmanDetailRow/SortState）
- **`marketing-report/utils/holidayData.ts`**: 2026年节假日数据（元旦/春节/清明/五一/端午/中秋/国庆）
- **`marketing-report/utils/holidayUtils.ts`**: 节假日计算工具（日期范围内节假日统计、SQL VALUES生成）
- **`marketing-report/sql/orgReport.ts`**: 机构战报SQL生成器（开单率=节假日出单人数/总人数）
- **`marketing-report/sql/salesmanDetail.ts`**: 业务员明细SQL生成器（签单比例=签单天数/假日天数）
- **`marketing-report/hooks/useMarketingReport.ts`**: 营销战报数据Hook（并行加载+排序管理）
- **`marketing-report/components/SortableTable.tsx`**: 通用可排序表格组件（点击表头排序）
- **`marketing-report/components/OrganizationReportTable.tsx`**: 机构战报表格（保费/开单率）
- **`marketing-report/components/SalesmanDetailTable.tsx`**: 业务员明细表格（签单天数/比例）
- **`marketing-report/components/HolidaySummaryCard.tsx`**: 节假日统计摘要卡片
- **`marketing-report/components/MarketingReportPanel.tsx`**: 营销战报主面板（整合所有组件）

### Premium Report 模块（保费报表）
- **`premium-report/index.ts`**: 模块导出入口
- **`premium-report/types/premiumReport.ts`**: 类型定义（OrgPremiumReportRow/SalesmanPremiumReportRow/PremiumReportSummary）
- **`premium-report/sql/orgPremiumReport.ts`**: 保费报表SQL生成器（机构保费+业务员保费查询）
- **`premium-report/hooks/usePremiumReport.ts`**: 保费报表数据Hook（并行加载+排序管理）
- **`premium-report/components/PremiumSummaryCard.tsx`**: 保费报表汇总卡片（总保费/件数/机构数/业务员数）
- **`premium-report/components/PremiumReportPanel.tsx`**: 保费报表主面板（整合所有组件）

## 业务规则

### Dashboard 加载策略
1. **并行查询**：KPI、TopN、趋势图并行加载（共享 requestId）
2. **请求取消**：筛选条件变化时取消旧请求（`isLatestRequest()`）
3. **错误隔离**：单个查询失败不影响其他查询（独立 try-catch）

### Filters 联动规则
- **日期范围**：影响所有查询的时间窗口
- **业务员**：影响 TopN 和表格的数据范围
- **机构**：影响全局数据筛选（WHERE 条件）

## 数据流

```
filters/FilterPanel.tsx
  ↓ (用户选择筛选条件)
dashboard/Dashboard.tsx
  ↓ (触发数据加载)
dashboard/useDashboardData.ts
  ↓ (调用 SQL 生成)
shared/sql/kpi.ts
  ↓ (生成 SQL)
shared/duckdb/client.ts
  ↓ (执行查询)
dashboard/Dashboard.tsx
  ↓ (渲染 UI)
widgets/charts/BarChart.tsx
widgets/kpi/KpiCard.tsx
widgets/table/VirtualTable.tsx
```

## 待开发功能

查看 [BACKLOG.md](../../BACKLOG.md) 中板块为 `Feature` 的任务。已完成项归档至 `开发文档/BACKLOG_ARCHIVE.md`（如 B007 数据导出 CSV/Excel、B008 图表下钻）。

## 链接到全局索引

- **代码索引**: [CODE_INDEX](../../开发文档/00_index/CODE_INDEX.md) - 核心模块入口
- **文档索引**: [DOC_INDEX](../../开发文档/00_index/DOC_INDEX.md) - 业务规则、架构文档

---

**变更规则**：
- 新增功能模块：必须在此处登记并创建对应 README.md。
- 修改加载策略：需更新 `dashboard/README.md` 文档。

## 新增组件登记（续保分析与筛选器优化）

- **`growth/components/GrowthKpiCards.tsx`**: 增长率分析三级KPI卡片（今日战况/本月进度/全年累计）
- **`dashboard/RenewalAnalysisPanel.tsx`**: 续保专项分析面板（KPI、趋势、排名、到期预警，含子视图切换）
- **`dashboard/RenewalRateRankingPanel.tsx`**: 分机构月度续保率排名面板（12个月标签页，三条折线：当日/当月/当年续保率）
- **`filters/DateRangePicker.tsx`**: 日期范围选择器（react-datepicker）
- **`filters/MultiSelectDropdown.tsx`**: 多选下拉框组件（react-select）
- **`filters/DateCriteriaSelector.tsx`**: 数据口径选择器（签单日期/起保日期）
- **`filters/CollapsibleFilterSection.tsx`**: 筛选器折叠区域组件（Accordion + localStorage记忆）
- **`dashboard/components/DashboardCustomizerPanel.tsx`**: 看板自定义面板（模块/KPI显示与排序）

## 新增 Dashboard Hooks 与类型

- **`dashboard/hooks/useDashboardData.ts`**: 基础看板数据加载 Hook（KPI/TopN/表格/占比）
- **`dashboard/hooks/useDashboardFilters.ts`**: 基础看板筛选 Hook（WHERE 构建 + 下钻）
- **`dashboard/hooks/useDataQualityCheck.ts`**: 数据质量检查 Hook（Parquet 加载后校验）
- **`dashboard/hooks/useFilterState.ts`**: 高级看板筛选状态 Hook（选项加载 + 联动）
- **`dashboard/hooks/usePremiumDashboardData.ts`**: 高级看板数据加载 Hook（表格 + 玫瑰图）
- **`dashboard/types.ts`**: Dashboard 相关类型定义（图表/表格数据）
- **`dashboard/hooks/useDashboardLayout.ts`**: 看板布局自定义 Hook（模块/KPI显示与顺序，localStorage持久化）
- **`dashboard/dashboardLayoutConfig.ts`**: 看板布局配置与KPI元数据（默认顺序/名称）
- **`dashboard/hooks/useAlerts.ts`**: 预警管理 Hook（预警检测、状态管理、localStorage持久化）

## 变更记录

- **`filters/DateRangePicker.tsx`**: 增加日期字符串解析容错，避免无效日期触发 DatePicker 异常
- **`dashboard/TruckAnalysisPanel.tsx`**: 营业货车专项分析面板接入视角切换器，联动切换保费/件数视角
- **`growth/components/GrowthAnalysisPanel.tsx`**: 增长率分析面板接入视角切换器，支持保费/件数视角联动
- **`filters/AdvancedFilterPanel.tsx`**: 快捷组合新增“可续”按钮（可续+套单+商业险）
- **`dashboard/components/TableSection.tsx`**: 业务员明细拆分为全部业务/优质业务 Top10 双表
- **`dashboard/components/TrendSection.tsx`**: 优质业务占比趋势固定显示
- **`dashboard/RenewalAnalysisPanel.tsx`**: 续保专项分析面板接入视角切换器，续保明细表格支持保费/件数口径
- **`filters/AdvancedFilterPanel.tsx`**: 更新筛选器术语为"快捷组合/基本选项"，与文档一致
- **`growth/components/GrowthAnalysisPanel.tsx`**: 新增"对比分析"模式（同比/环比月/环比周/自定义期间，双指标图表+详细数据表格）
- **`growth/components/ComparisonQuickPresets.tsx`**: 对比快捷预设按钮组件（YoY/MoM/WoW一键切换）
- **`growth/utils/comparisonPresets.ts`**: 预设日期计算工具（闰年处理、跨年边界、期间对齐验证）
- **`dashboard/Dashboard.tsx`**: 集成预警系统（AlertPanel + AlertBadge）
- **`filters/FilterLayoutV2.tsx`**: 置顶筛选改为四维度按需展开（三级机构/客户类别/险别组合/续保模式）
- **`filters/DateRangePicker.tsx`**: 起始日/截止日合并为起止日期，使用原生 date 输入并按需展开
- **`filters/MultiSelectDropdown.tsx`**: 支持 compact 形态用于折叠容器内展示
- **`dashboard/CrossSellQuadrantView.tsx`**: 交叉销售四象限判断视图（复用表格主视图数据，输出 Decision Header + 散点象限图）
- **`dashboard/CrossSellTrendChart.tsx`**: 驾意险推介率走势组件（日/周/月/季度四粒度，主全/交三/单交/整体四线）
- **`dashboard/hooks/useCrossSellTrend.ts`**: 驾意险推介率走势数据 Hook（调用 `/api/query/cross-sell-trend`，含并发请求防抖）
- **`dashboard/crossSellRateStatus.ts`**: 驾意险推介率统一状态规则（主全/交三阈值、状态文案、四象限分类与配色）
- **`dashboard/CrossSellSummaryKpiBoard.tsx`**: 推介率驱动因子环比看板（2026-02-25 新增环比功能：当日/周/月视角显示绝对值+百分比变化，格式如 `↑ +8.3, +7.1%`）
- **`filters/PageHeaderBar.tsx`**: 页面标题栏组件（2026-02-25 新增：动态标题根据筛选范围显示，sticky top-0 置顶，已筛选条件 chips 展示）
- **`dashboard/utils/performanceHeatmapSelection.ts`**: 绩效热力图选择工具（将热力图时间桶映射为签单日期范围，并统一下钻来源判定，避免日期丢失与行下钻被热力图上下文抢占）

### Coefficient 模块（商车自主定价系数监控）

- **`coefficient/hooks/useCoefficientMonitor.ts`**: 系数监控数据加载 Hook（批量查询优化、周期分组、缺口保费计算）
- **`coefficient/components/CoefficientMonitorPanel.tsx`**: 系数监控主面板（视图切换：周期分表/明细表）
- **`coefficient/components/CoefficientPeriodTable.tsx`**: 单周期数据表组件（1-7日、8-14日、15-21日、22-月末）

### Cost 模块（成本分析）

- **`cost/index.ts`**: 模块导出入口
- **`cost/types/costTypes.ts`**: 成本分析类型定义（ClaimRatioData/ExpenseRatioData/ComprehensiveCostData/VariableCostData/EarnedPremiumData/EarnedPremiumSummaryData）
- **`cost/hooks/useCostAnalysis.ts`**: 成本分析数据 Hook（赔付率/费用率/综合费用率/变动成本率/已赚保费五种查询）
- **`cost/hooks/useExportHandlers.ts`**: 导出处理器 Hook（CSV/Excel导出，支持五种成本分析类型）
- **`cost/components/CostAnalysisPanel.tsx`**: 成本分析主面板（Tab容器+控制面板+表格）
- **`cost/components/CostAnalysisControlPanel.tsx`**: 控制面板（子Tab切换/维度选择/截止日期/月末选择器）
- **`cost/components/ClaimRatioTable.tsx`**: 赔付率分析表格（VirtualTable渲染10列数据）
- **`cost/components/EarnedPremiumTable.tsx`**: 已赚保费分析表格（公式展示区+汇总表+明细表，2026-01-17新增）
- **`cost/components/VariableCostKpiBoard.tsx`**: 变动成本率KPI看板（分公司整体→点击下钻三级机构，固定机构口径）
- **`cost/utils/transformData.ts`**: 数据转换工具（各类成本数据格式化显示）

### Comprehensive Analysis 模块（综合分析）

- **`comprehensive-analysis/types.ts`**: 综合分析类型定义（bundle contract / view model / tab key）
- **`comprehensive-analysis/hooks/useComprehensiveBundle.ts`**: 综合分析单接口数据 Hook（复用全局筛选+权限注入）
- **`comprehensive-analysis/adapters/*`**: 字段适配层（后端响应 -> 图表输入模型）
- **`comprehensive-analysis/rules.ts`**: 阈值与告警规则（可单测）
- **`comprehensive-analysis/charts/options/*`**: 图表 option 生成器（overview/premium/cost/loss/expense/roi）
- **`comprehensive-analysis/components/ComprehensiveMetricTable.tsx`**: 综合分析明细表组件

### Settings 模块（设置菜单）

- **`settings/index.ts`**: 模块导出入口
- **`settings/SettingsPanel.tsx`**: 设置面板容器（侧边滑入/标签切换）
- **`settings/ThemeSettings.tsx`**: 主题设置组件（浅色/深色/随系统模式选择）
- **`settings/SystemSettings.tsx`**: 系统设置组件（缓存管理/开发者模式/设置导出）

### File 模块（文件菜单）

- **`file/index.ts`**: 模块导出入口
- **`file/DataImportModal.tsx`**: 数据导入弹窗（拖拽上传/文件选择）
- **`file/ExportModal.tsx`**: 数据导出弹窗（PDF/Excel/CSV格式选择）
- **`file/ReportTemplatesModal.tsx`**: 报表模板弹窗（模板搜索/分类筛选/快速跳转）

### 变更记录

- **`dashboard/RenewalAnalysisPanel.tsx`**: 续保明细表格支持按年份与月份切换，并更新为月日/当日/当月/当年续保字段展示
- **`cost/components/VariableCostKpiBoard.tsx`**: 新增变动成本率KPI下钻看板（8项指标，支持分公司整体与三级机构切换）
- **`auth/RouteAccessGuard.tsx`**: 页面级路由权限守卫（按用户白名单限制访问，未授权路由重定向默认页）

## 2026-02 API-only 权威说明（新增）

以下为当前页面主链路：

- 入口路由：`src/app/App.tsx`
- 主看板：`src/features/dashboard/PremiumDashboard.tsx`
- 页面容器：`src/features/pages/*Page.tsx`
- 统一筛选：`src/components/layout/PageFilterPanel.tsx` + `src/features/filters/AdvancedFilterPanel.tsx`

历史 `Dashboard.tsx` / `FilterPanel.tsx` 相关段落视为过渡记录，不作为当前实现基线。

## 2026-02-26 新增业绩分析独立页面

### Pages 模块新增
- **`pages/PerformanceAnalysisPage.tsx`**: 业绩分析独立页面容器（`/performance-analysis`，完整筛选 preset + 独立面板）

### Dashboard 模块新增
- **`dashboard/PerformanceAnalysisPanel.tsx`**: 业绩分析主面板（险别组合业绩环比、双趋势图、达成率+增长率分布图、下钻分组、Top20业务员）
- **`dashboard/performanceStatus.ts`**: 业绩分析状态规则（达成率区间与增长率区间）
- **`dashboard/hooks/usePerformanceSummary.ts`**: 险别组合业绩环比数据 Hook
- **`dashboard/hooks/usePerformanceTrend.ts`**: 车险保费/车险件数趋势数据 Hook
- **`dashboard/hooks/usePerformanceDrilldown.ts`**: 达成率+增长率下钻分析 Hook
- **`dashboard/hooks/usePerformanceTopSalesman.ts`**: Top20 业务员业绩分析 Hook
- **`dashboard/PerformanceTrendChart.tsx`**: 业绩分析双趋势图组件（保费/件数）

## 2026-02-26 标题栏操作与 PDF 导出布局优化

### Pages 模块新增
- **`pages/PremiumDashboardPage.tsx`**: 保费分析看板页面容器（标题右侧统一操作区：`自定义看板` + `导出PDF报告`）

### Dashboard 模块调整
- **`dashboard/PremiumDashboard.tsx`**: 移除内容区顶部导出按钮卡片；`DashboardCustomizerPanel` 改为受外部开关控制，默认不占用看板首屏空间

### 导出链路调整
- **`services/PdfExportService.ts`**: 长页面导出改为按 canvas 分页切片写入 PDF，降低边界截断与重叠风险

## 2026-02-26 交叉销售页标题栏控件统一

### Pages 模块调整
- **`pages/CrossSellPage.tsx`**: 车辆类别与时间维度切换状态提升到页面层，并挂载到页面标题右侧

### Dashboard 模块调整
- **`dashboard/CrossSellAnalysisPanel.tsx`**: 新增标题栏控件组件 `CrossSellHeaderControls`（客户类别/时间维度标签+Tab）；移除内容区顶部 sticky 切换条，重置分析入口迁移到下钻导航区

## 2026-02-26 业绩分析页标题栏左右分区

### Layout/Filters 调整
- **`filters/PageHeaderBar.tsx`**: 新增标题下方左侧插槽 `bottomLeftContent` 与 chips 右对齐参数 `chipsAlign`
- **`components/layout/PageFilterPanel.tsx`**: 新增 `headerBottomLeftContent` 与 `headerChipsAlign` 透传能力

### Pages 模块调整
- **`pages/PerformanceAnalysisPage.tsx`**: 将标签选择控件移至标题下方左侧，筛选条件 chips 改为右侧对齐展示（左选右条件）

### Dashboard 模块补充
- **`dashboard/PerformanceAnalysisPanel.tsx`**: 业绩分析标题栏控件补充分组标签（客户类别/时间维度/对比方式），并改为左侧优先显示 + 横向滚动

## 2026-02-27 业务员姓名展示规则统一

- **`premium-report/hooks/usePremiumReport.ts`**: 保费报表业务员姓名统一走 `formatSalesmanName`，展示仅保留中文名。
- **`marketing-report/hooks/useMarketingReport.ts`**: 营销战报业务员明细统一走 `formatSalesmanName`。
- **`marketing-report/components/HolidayDrilldownPanel.tsx`**: 下钻业务员明细展示统一走 `formatSalesmanName`。
- **`dashboard/hooks/useRenewalDrilldown.ts`**: 续保下钻“业务员层/父级业务员名”统一展示规则。
- **`growth/hooks/useGrowthAnalysis.ts`**: 增长分析“分业务员/对比明细”维度名统一展示规则。
- **`dashboard/hooks/usePremiumDashboardData.ts`**: 保费分析看板 Top 业务员姓名统一展示规则。

## 2026-02-27 关键页面性能与体验升级（B212）

- **`dashboard/hooks/useCrossSellAnalysis.ts`**: 交叉销售主链路改为 bundle 优先（`cross-sell-bundle`），并支持 bundle 失败/关闭时自动回退旧接口组合查询。
- **`dashboard/hooks/usePerformanceBundle.ts`**: 新增业绩分析 bundle 数据 Hook（`performance-bundle`）。
- **`dashboard/hooks/useDashboardBundle.ts`**: 新增仪表盘 bundle 数据 Hook（`dashboard-bundle`）。
- **`dashboard/PerformanceAnalysisPanel.tsx`**: summary/trend/top 优先消费 bundle 预取数据，支持 `VITE_ENABLE_BUNDLE_ROUTES=false` 回退旧链路。
- **`dashboard/hooks/usePerformanceDrilldown.ts`**、**`dashboard/PerformanceAnalysisPanel.tsx`**: 下钻链路支持 bundle 预取首屏数据，避免首屏再发一次 drilldown 重复请求；用户交互后再切回按需请求。
- **`dashboard/PremiumDashboard.tsx`**: KPI/trend/排名/玫瑰图优先消费 bundle 预取数据，支持开关回退。
- **`dashboard/CrossSellSummaryKpiBoard.tsx`**、**`dashboard/CrossSellTrendChart.tsx`**、**`dashboard/CrossSellTopSalesmanBoard.tsx`**: 增加 prefetched 数据入口，消除页面内重复请求。
- **`home/DataImportPage.tsx`**: 移除重复 `refreshFiles()` 触发路径，避免进入页时双请求。

## 2026-03-03 业绩分析新增机构热力图

- **`dashboard/hooks/usePerformanceOrgHeatmap.ts`**: 新增业绩分析热力图数据 Hook（调用 `performance-org-heatmap`，返回三级机构连续15周期矩阵数据）。
- **`dashboard/PerformanceAnalysisPanel.tsx`**: 在业绩分析页面顶部新增三级机构连续15周期热力图模块，支持点击单元格后直接弹出下钻维度选择，并在下钻分析标题中动态展示已选维度。

## 2026-03-06 业绩分析热力图下钻切换修复

- **`dashboard/PerformanceAnalysisPanel.tsx`**: 修复业绩分析下钻链路在用户交互后仍被 bundle 首屏 `prefetched` 数据短路的问题；热力图/表格下钻开始后强制切回 `performance-drilldown` 实时请求。

## 2026-03-08 热力图新增分公司固定行

- **`dashboard/PerformanceAnalysisPanel.tsx`**: 业绩分析连续15周期热力图新增“分公司”汇总行，固定插入在首行之后；该行字体加粗且禁用下钻点击，避免误触发无效机构下钻。
- **`dashboard/CrossSellMetricsHeatmap.tsx`**: 驾意险推介率连续15周期热力图新增“分公司”汇总行，固定插入在首行之后；该行名称与单元格加粗，并保持机构总数展示口径不变。

## 2026-03-08 热力图分公司同比口径修正

- **`dashboard/PerformanceAnalysisPanel.tsx`**: “分公司”行调整为表头下第一行；同比/环比从“维度同比加权均值”改为“分公司总保费 ÷ 上年同期/上期总保费”重算，确保在三级机构/团队/业务员/客户类别/险别组合/能源类型/新转续七个维度一致。
- **`dashboard/hooks/usePerformanceOrgHeatmap.ts`**: 热力图行模型新增 `prevMomPremium`、`prevYoyPremium` 字段，用于分公司汇总行按分母还原统一增长率。

## 2026-03-09 指标涨跌颜色语义统一（B2xx）

- **`dashboard/CrossSellSummaryKpiBoard.tsx`**: 环比状态改为基于 `metricPolarity` 计算颜色；当前 cross-sell 指标全部标记为正向指标（涨绿跌红）。
- **`growth/components/GrowthKpiCards.tsx`**、**`growth/components/ComparisonAnalysisPanel.tsx`**、**`growth/components/GrowthComparisonSection.tsx`**、**`growth/components/GrowthDetailSection.tsx`**: 增长率/变化量颜色统一改为共享趋势语义函数，移除硬编码红绿值。

## 2026-03-10 交叉销售页 UX 骨架与长页面体验升级（B221）

- **`pages/CrossSellPage.tsx`**: 接入页面锚点导航、顶部场景快选与基础筛选常驻区。
- **`dashboard/CrossSellAnalysisPanel.tsx`**: 模块顺序重排为 KPI → AI 洞察 → 热力图 → 趋势 → 下钻 → TOP20；下钻表默认只显示核心列，支持展开险种明细，并为核心列增加数据条。
- **`dashboard/CrossSellSummaryKpiBoard.tsx`**: 驱动因子改为“整体 KPI 卡片 + 险别组合对比矩阵”双层结构。
- **`dashboard/CrossSellTrendChart.tsx`**: 整体趋势线增加最高/最低值注释点，与顶部洞察形成图文联动。
- **`dashboard/CrossSellOrgTrendChart.tsx`**: 底部 AI 主洞察降级为程序解读摘要，避免与页面顶部主洞察重复。

## 2026-03-10 长页面 UX 骨架平移与交互回归（B222）

- **`pages/PerformanceAnalysisPage.tsx`**: 复用顶部基础筛选 + 右侧锚点骨架，补充热力图/汇总/趋势/下钻/TOP20 五段锚点。
- **`pages/GrowthPage.tsx`**、**`pages/CostPage.tsx`**: 接入统一页面骨架，保持基础筛选与高级抽屉行为一致。
- **`dashboard/PerformanceAnalysisPanel.tsx`**: 为热力图、汇总、趋势、下钻、TOP20 补充锚点区块 ID，支持长页面电梯导航。
- **`dashboard/CrossSellAnalysisPanel.tsx`**: 维持管理员默认首层下钻视图，配合新 E2E 用例锁定抽屉、锚点和险种明细展开行为。

## 2026-03-10 长表体验组件化补充（B225）

- **`dashboard/CrossSellMetricsHeatmap.tsx`**: 接入统一长表滚动容器，补齐表头吸顶与首列冻结，支持热力图长宽同时滚动时保持上下文。
- **`dashboard/CrossSellAnalysisPanel.tsx`**: 下钻表改为复用统一长表滚动容器和 sticky 语义，减少页面内手写吸顶样式。
- **`dashboard/PerformanceAnalysisPanel.tsx`**: 业绩热力图与下钻表接入同一套吸顶/冻结样式规则，对齐原计划中的“热力图 + 下钻分析”长表体验。

## 2026-03-10 Code Review 回归修复（B226）

- **`dashboard/CrossSellAnalysisPanel.tsx`**: 年维度下不再把 `year` 强行传给热力图；热力图区块改为显式禁用态说明，并新增 helper 统一标题与时间粒度映射。
- **`dashboard/CrossSellAnalysisPanel.tsx`**: 热力图下钻维度选择器改为排除当前层级与已走过层级，避免 `机构 -> 团队 -> 机构` 循环路径。
- **`dashboard/CrossSellOrgTrendChart.tsx`**: 机构趋势程序解读改为按 `daily/weekly/monthly/quarterly/yearly` 动态生成“近N期口径”和“连续回落/未回落”文案。
- **`../tests/cross-sell-ux-review-fixes.test.tsx`**: 新增回归单测，锁定年维度热力图禁用、热力图下钻维度去重、程序解读动态文案与高级筛选计数基线。

## 2026-03-10 AI 图文联动与 Growth 长表平移（B227）

- **`dashboard/CrossSellAnalysisPanel.tsx`**: `buildInsightSummary()` 新增结构化注释输出，统一沉淀推介率/驾意件均的最高点与最低点。
- **`dashboard/CrossSellTrendChart.tsx`**: 新增 `CrossSellTrendAnnotation` 与 `buildCrossSellTrendMarkPointData()`，让趋势图优先使用 AI 结论生成 markPoint，建立图文联动契约。
- **`growth/components/GrowthDetailSection.tsx`**、**`growth/components/GrowthComparisonSection.tsx`**、**`growth/components/ComparisonAnalysisPanel.tsx`**: 三张核心长表接入 `StickyTableFrame + stickyTableStyles`，统一表头吸顶与首列冻结。
- **`../tests/cross-sell-trend-annotations.test.ts`**: 锁定 AI 摘要与趋势图注释使用同一批极值数据，避免后续回归为“双份计算”。

## 2026-06-10 死代码清理（dedup-remediation）

- 删除 **`pages/ComparisonPage.tsx`**、**`pages/TruckPage.tsx`**、**`pages/CrossSellPage.tsx`**（侧边栏不再挂载的孤儿页面）。
- 删除 **`growth/components/ComparisonAnalysisPanel.tsx`**（仅被已删的 ComparisonPage 引用）。
- 删除 **`dashboard/performance/PerformanceOrgHeatmap.tsx`**（v1，已标 `@deprecated`；活代码为 `dashboard/components/PerformanceOrgHeatmapSection.tsx` 与 `PerformanceOrgHeatmapV2/`，`hooks/usePerformanceOrgHeatmap.ts` 不受影响）。
- 删除 **`growth/examples/GrowthDashboardExample.tsx`** 及空目录 `growth/examples/`。
- **`pages/index.ts`**: 同步移除 `TruckPage` / `ComparisonPage` 导出。
