# UI 组件层 (Widgets Layer)

**职责**：提供业务无关的通用 UI 组件（图表、KPI 卡片、表格、筛选器、告警）。属 L1 共享层（分层权威见根目录 `ARCHITECTURE.md §2.2`），**禁止依赖 `src/features/**`**（governance「分层依赖边界」闸自动拦截）。

> **唯一实现红线**：每类可视化能力在本层只允许一个实现，新增组件前先 `grep` 本层与 `src/shared/ui/` 确认不存在同功能组件。详见 `开发文档/架构设计/前端极简架构规划_2026-07-07.md`。

## 当前组件清单（与代码一致，历史变更见 git log）

### Charts（`charts/`，ECharts 封装）

| 组件 | 职责 |
|------|------|
| `BarChart.tsx` | 柱状图（横向/纵向） |
| `LineChart.tsx` | 折线图（多系列） |
| `RoseChart.tsx` | 玫瑰图（占比展示） |
| `TonnageRoseChart.tsx` | 吨位玫瑰图（保费/保单数切换） |
| `OrgPremiumPieChart.tsx` | 三级机构保费占比环形图（中心总保费） |
| `TruckDrillDownChart.tsx` | 营业货车下钻图（机构堆叠柱状图→吨位分段饼图） |
| `QualityBusinessChart.tsx` | 优质业务占比趋势图 |
| `WaterfallChart.tsx` | 瀑布图（贡献分析） |
| `DualYAxisComparisonChart.tsx` | 双 Y 轴对比图（保费柱状+件数折线，当期 vs 基期） |
| `YoyComboChart.tsx` | 同比组合图 |

### KPI（`kpi/`）

- **`kpi/EnhancedKpiCard/`**：增强型 KPI 卡片（目录入口 `index.tsx`，拆为 `types` / `utils` / `LegacyRatioParts` / `HeroReferenceParts` / `StatusAtoms` 5 子文件）— hero/standard 双变体 + value/donut/bar 三类型 + 完整参照系（progress/ring/segments + threshold + delta + sparkline + status rail）。详见 [kpi/INDEX.md](./kpi/INDEX.md)。**KPI 卡以本组件为唯一基座**，特性层各自实现的 KPI 卡属待收敛存量（见架构规划 follow-up）。

### Table（`table/` + `tables/`）

- **`table/VirtualTable.tsx`**：虚拟化表格（react-window，大数据量）
- **`tables/SalesmanRankingTable.tsx`**：业务员排名表格（Top10 双表）

### Filters（`filters/`）

- **`filters/PerspectiveSwitcher.tsx`**：视角切换器（保费/商业险件数/交强险件数）

### Alerts（`alerts/`）

- **`alerts/DataScopeAlert.tsx`**：数据范围告警（CostAnalysisPanel 等场景）

## 设计规范

样式唯一事实源：`src/shared/styles/index.ts`（`colorClasses` / `cardStyles` / `fontStyles` 等），**禁止硬编码离散 Tailwind 颜色类**。规范全文见 `DESIGN.md` 与 `.claude/rules/frontend.md`。

## 链接到全局索引

- **代码索引**: [CODE_INDEX](../../开发文档/00_index/CODE_INDEX.md)
- **文档索引**: [DOC_INDEX](../../开发文档/00_index/DOC_INDEX.md)

---

**变更规则**：新增/删除组件必须同步本清单；本文件只保留当前态映射，禁止流水账式追加变更记录（历史由 git 承载）。
