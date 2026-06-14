# UI 组件层 (Widgets Layer)

**职责**：提供业务无关的通用 UI 组件（图表、KPI卡片、表格）。

## 子模块

| 模块 | 路径 | 职责 | 文档 |
|------|------|------|------|
| Charts | `charts/` | ECharts 封装（柱状图、折线图、饼图） | 无独立文档 |
| KPI | `kpi/` | KPI 指标卡片组件 | 无独立文档 |
| Table | `table/` | 虚拟化表格（react-window） | 无独立文档 |
| Filters | `filters/` | 筛选器UI组件（视角切换器） | 无独立文档 |
| Tables | `tables/` | 业务员排名表格封装 | 无独立文档 |
| Alerts | `alerts/` | 预警通知组件（预警面板、徽章） | 无独立文档 |
| Export | `export/` | 导出对话框组件（PDF导出UI） | 无独立文档 |

## 关键入口文件

### Charts 模块
- **`charts/BarChart.tsx`**: 柱状图组件（支持横向/纵向）
- **`charts/LineChart.tsx`**: 折线图组件（支持多系列）
- **`charts/PieChart.tsx`**: 饼图组件（支持环形）
- **`charts/RoseChart.tsx`**: 玫瑰图组件（支持占比展示、隐藏占比数值标签与提示）
- **`charts/TonnageRoseChart.tsx`**: 吨位玫瑰图组件（支持保费/保单数指标切换）
- **`charts/OrgPremiumPieChart.tsx`**: 三级机构保费占比环形图（外置标题、中心总保费）
- **`charts/TruckDrillDownChart.tsx`**: 营业货车下钻分析图（机构堆叠柱状图→吨位分段饼图）
- **`charts/QualityBusinessChart.tsx`**: 优质业务占比趋势图
- **`charts/OrgPremiumPieChart.tsx`**: 三级机构保费占比环形图（中心总保费展示）
- **`charts/GroupedBarChart.tsx`**: 分组柱状图（多系列对比）
- **`charts/WaterfallChart.tsx`**: 瀑布图（贡献分析）
- **`charts/DualYAxisComparisonChart.tsx`**: 双Y轴对比图（保费柱状图+件数折线图，同时展示当期vs基期）

### KPI 模块
- **`kpi/KpiCard.tsx`**: KPI 卡片组件（数值、趋势、对比）
- **`kpi/EnhancedKpiCard.tsx`**: 增强型 KPI 卡片组件（环形图、占比条）
- **`kpi/RenewalKpiFunnel.tsx`**: 续保漏斗 KPI 卡片（流程图式展示：应续→报价→已续）

### Table 模块
- **`table/VirtualTable.tsx`**: 虚拟化表格组件（支持大数据量）
- **`tables/SalesmanRankingTable.tsx`**: 业务员排名表格组件（Top10双表）

### Filters 模块
- **`filters/PerspectiveSwitcher.tsx`**: 视角切换器组件（保费/商业险件数/交强险件数）

### Alerts 模块
- **`alerts/DataScopeAlert.tsx`**: 数据范围告警组件（用于 CostAnalysisPanel 等场景）
- **`alerts/index.ts`**: 预警组件统一导出

### Export 模块
- **`export/ExportDialog.tsx`**: 导出对话框组件（格式选择、配置选项、进度显示、错误提示）
- **`export/index.ts`**: 导出组件统一导出

## 组件特性

### Charts
- **数据格式**：接受 Apache Arrow Table 或普通 JavaScript 对象数组
- **响应式**：自动适配容器尺寸（ResizeObserver）
- **主题**：统一配色方案（Tailwind CSS 变量）

### KPI
- **格式化**：自动数值格式化（千分位、百分比、货币）
- **趋势指示**：上升/下降箭头、颜色变化
- **加载状态**：骨架屏、错误提示

### Table
- **虚拟滚动**：使用 react-window 优化性能
- **排序**：支持多列排序（点击表头）
- **导出**：通过 `export/ExportDialog.tsx` 支持 CSV/Excel 导出（B007 已完成，见 `开发文档/BACKLOG_ARCHIVE.md` A009）

## 设计规范

### 颜色
- **主色**：`text-blue-600`, `bg-blue-50`
- **成功**：`text-green-600`, `bg-green-50`
- **警告**：`text-yellow-600`, `bg-yellow-50`
- **错误**：`text-red-600`, `bg-red-50`

### 间距
- **卡片内边距**：`p-4` (16px)
- **卡片间距**：`gap-4` (16px)
- **组件边距**：`mb-4` (16px)

## 待开发功能

查看 [BACKLOG.md](../../BACKLOG.md) 中板块为 `Feature` 且涉及组件的待办任务。已完成项归档至 `开发文档/BACKLOG_ARCHIVE.md`（如 B007 导出功能、B008 图表下钻）。

## 链接到全局索引

- **代码索引**: [CODE_INDEX](../../开发文档/00_index/CODE_INDEX.md) - 核心模块入口
- **文档索引**: [DOC_INDEX](../../开发文档/00_index/DOC_INDEX.md) - 设计规范

---

**变更规则**：
- 新增组件：必须在此处登记。
- 修改设计规范：需同步更新此文档的"设计规范"部分。

## 变更记录

- **2026-02-01**: 新增 `kpi/RenewalKpiFunnel.tsx` 续保漏斗 KPI 卡片，聚焦件数续保率，建立红绿灯状态系统
- **`charts/TruckDrillDownChart.tsx`**: 支持视角切换的数值格式化与轴/tooltip标签动态化
- **`charts/OrgPremiumPieChart.tsx`**: 支持自定义数值格式与标题文案（保费/件数）
