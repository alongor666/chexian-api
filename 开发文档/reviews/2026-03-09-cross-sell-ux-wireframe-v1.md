# 车险经营管理系统交叉销售页 UX 线框规格 V1

日期：2026-03-09
适用页面：`/cross-sell`
目标：先冻结页面骨架、交互分层与组件契约，再进入实现阶段，避免在高信息密度 B 端页面中反复返工。

## 1. 设计原则

1. 先上下文，后数据：标题、时间维度、核心筛选必须始终可见。
2. 先总览，后深挖：KPI 与 AI 洞察上移，下钻表格延后。
3. 先降噪，后展开：默认只给核心字段，细节按需披露。
4. 结构复用优先：页面骨架、筛选容器、锚点导航、洞察卡应沉淀为通用组件。
5. 可扩展优先：后续可平移到 `performance-analysis`、`growth`、`cost` 等长页面。

## 2. 桌面端低保真线框

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Sidebar                                                                                                    │
│ ┌────────────────┐ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Logo / Menu    │ │ Sticky Layer 1: Page Header                                                         │ │
│ │ 首页           │ │ 标题：四川分公司非营业客车交叉销售分析                                              │ │
│ │ 数据分析       │ │ 时间维度：[日][周][月][季][年]   快捷场景：[转保][可续][重置]                       │ │
│ │ 工具           │ ├──────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ 管理           │ │ Sticky Layer 2: Basic Filters                                                      │ │
│ │                │ │ 起保日期 | 三级机构 | 险别组合 | 渠道 | [高级筛选] [导出]                          │ │
│ │ Avatar / 设置  │ ├──────────────────────────────────────────────────────┬───────────────────────────────┤ │
│ │ 退出           │ │ KPI Cards Row                                        │ Anchor Nav                    │ │
│ └────────────────┘ │ [驾意保费][推介率][驾意件均][达成率][环比摘要]       │ 热力图                        │ │
│                    ├──────────────────────────────────────────────────────┤ 驱动因子                      │ │
│                    │ AI Insight Card                                      │ 下钻分析                      │ │
│                    │ 结论 / 原因 / 建议动作                               │ AI 解读                       │ │
│                    ├──────────────────────────────────────────────────────┤ TOP20                         │ │
│                    │ 15周期热力图                                         │                               │ │
│                    │ 首列机构冻结 + 日期表头吸顶                          │                               │ │
│                    ├──────────────────────────────────────────────────────┤                               │ │
│                    │ 推介率/驾意件均趋势图                                │                               │ │
│                    │ 最高/最低值注释高亮                                  │                               │ │
│                    ├──────────────────────────────────────────────────────┤                               │ │
│                    │ 下钻分析表                                            │                               │ │
│                    │ 默认核心列 + “展开险种明细”                           │                               │ │
│                    ├──────────────────────────────────────────────────────┤                               │ │
│                    │ TOP20 业务员 / 机构排行                              │                               │ │
│                    └──────────────────────────────────────────────────────┴───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. 页面骨架分层

### 3.1 固定区

1. `SidebarNavigation`
2. `StickyPageHeader`
3. `BasicFilterBar`
4. `AnchorNav`

### 3.2 滚动区

1. `KpiSummarySection`
2. `InsightSection`
3. `HeatmapSection`
4. `TrendSection`
5. `DrilldownSection`
6. `TopRankSection`

### 3.3 弹出层

1. `AdvancedFilterDrawer`
2. `DimensionPickerPopover`
3. `CollapsedSidebarTooltip`
4. `CollapsedSidebarSubmenuPopover`

## 4. 可复用组件契约

以下不是立即新增全部代码，而是实现阶段的组件拆分边界。

### 4.1 页面级骨架

```ts
interface DashboardPageShellProps {
  title: string;
  stickyHeader: React.ReactNode;
  basicFilters: React.ReactNode;
  anchorSections: DashboardAnchorSection[];
  children: React.ReactNode;
  sidebarMode?: 'expanded' | 'collapsed';
}
```

用途：替代当前页面各自拼接的长页结构，统一吸顶、滚动区与锚点导航。

### 4.2 锚点导航

```ts
interface DashboardAnchorSection {
  id: string;
  label: string;
  shortLabel?: string;
  order: number;
}
```

用途：跨页面复用，适用于 `cross-sell`、`performance-analysis`、`growth`。

### 4.3 基础筛选条

```ts
interface BasicFilterBarProps {
  preset: string;
  visibleFields: string[];
  quickActions?: React.ReactNode;
  onOpenAdvanced: () => void;
}
```

用途：顶部仅保留高频筛选；其余维度统一进入抽屉。

### 4.4 高级筛选抽屉

```ts
interface AdvancedFilterDrawerProps {
  preset: string;
  isOpen: boolean;
  onClose: () => void;
  filterState: unknown;
  onChange: (next: unknown) => void;
}
```

用途：取代桌面端右侧常驻大筛选栏，避免压缩主内容横向空间。

### 4.5 洞察卡

```ts
interface InsightCardProps {
  title: string;
  summary: string;
  bullets: string[];
  metricRefs?: Array<{ seriesKey: string; pointKey: string; label: string }>;
}
```

用途：统一 AI 解读、规则解读、系统建议的呈现方式。

### 4.6 渐进式表格

```ts
interface ProgressiveTableProps<T> {
  columns: Array<unknown>;
  detailColumns?: Array<unknown>;
  defaultExpanded?: boolean;
  stickyHeader?: boolean;
  data: T[];
}
```

用途：默认降噪，按需展开险别细项列组。

## 5. cross-sell 页面专属映射

### 5.1 顶部标题区

保留当前页面语义，但重排为：

1. 主标题：`四川分公司非营业客车交叉销售分析`
2. 副上下文：客户类别、保额口径、已选机构
3. 时间维度：日 / 周 / 月 / 季 / 年
4. 快捷筛选：转保、可续、重置

### 5.2 KPI 行

默认卡片顺序：

1. 驾意保费
2. 推介率
3. 驾意件均
4. 达成率
5. 环比摘要

约束：

1. 指标涨跌语义沿用已实现的 `metricPolarity`
2. 正向指标默认 `positive`
3. 卡片支持后续横向扩展而不改布局骨架

### 5.3 AI 洞察区

由当前图表中部的散落文案，提升为独立主模块：

1. 第一行给出结论
2. 第二行解释原因
3. 第三行给出动作建议
4. 若存在最高/最低/异常点，必须映射到趋势图注释节点

### 5.4 热力图区

约束：

1. 首列机构固定
2. 日期表头 sticky
3. 右侧仅在容器内部横向滚动，不影响整页布局
4. 状态色板走统一低饱和设计令牌，不在页面内硬编码

### 5.5 下钻分析区

默认列：

1. 维度
2. 车险件数
3. 驾意件数
4. 综合推介率
5. 驾意件均

二级展开列组：

1. 单交
2. 交三
3. 主全

扩展规则：

1. 新险别列组以后只追加到 `detailColumns`
2. 默认核心列不随险别扩展而膨胀

## 6. 交互状态模型

### 6.1 侧边栏

1. `expanded`
2. `collapsed`
3. `collapsed + tooltip`
4. `collapsed + submenu popover`

### 6.2 筛选器

1. `basic-only`
2. `advanced-open`
3. `advanced-dirty`
4. `advanced-resetting`

### 6.3 下钻表格

1. `summary`
2. `detail-expanded`
3. `sorting`
4. `loading`

### 6.4 锚点导航

1. `idle`
2. `active-section-tracking`
3. `smooth-scrolling`

## 7. 现有代码落点

以下文件是后续实现的主要承载点：

1. `src/components/layout/PageFilterPanel.tsx`
2. `src/components/layout/SidebarNavigation.tsx`
3. `src/features/filters/FilterLayoutV2.tsx`
4. `src/features/pages/CrossSellPage.tsx`
5. `src/features/dashboard/CrossSellAnalysisPanel.tsx`
6. `src/features/dashboard/CrossSellSummaryKpiBoard.tsx`
7. `src/features/dashboard/CrossSellTrendChart.tsx`
8. `src/features/dashboard/CrossSellMetricsHeatmap.tsx`
9. `src/features/dashboard/CrossSellOrgTrendChart.tsx`

## 8. 实施顺序建议

### Phase 1：全局容器

1. `PageFilterPanel` 改成顶部基础筛选 + 高级抽屉
2. 主内容区加入统一滚动容器与锚点挂载位
3. `SidebarNavigation` 补 Tooltip 与收起态语义

### Phase 2：cross-sell 重构

1. 抽出 `AnchorNav`
2. 重排 KPI 与 AI 洞察模块
3. 热力图 sticky 体验收口
4. 下钻分析做列组展开

### Phase 3：全站推广

1. `performance-analysis`
2. `growth`
3. `cost`

## 9. 验收标准

1. 用户滚到页面底部时仍能看到当前标题、时间维度和基础筛选。
2. 锚点点击后 1 次滚动直达对应模块。
3. 高级筛选不再长期挤占桌面端主视图区。
4. 热力图与下钻表头都具备 sticky 行为。
5. 新页面复用骨架时，不需要复制吸顶、锚点、抽屉逻辑。

## 10. 结论

本版草图不是视觉稿，而是实现级线框规格。它冻结了：

1. 信息架构
2. 模块顺序
3. 状态边界
4. 组件拆分
5. 全站复用方式

后续进入代码阶段时，应先做页面骨架与通用组件，不应直接从单页局部样式开始改。
