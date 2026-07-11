# DESIGN.md — 车险数据分析看板设计系统

> **唯一事实源**：`src/shared/styles/index.ts` + `src/shared/utils/formatters.ts` + `src/app/index.css`
>
> **技术栈**：React + TypeScript + Tailwind CSS + ECharts · Dark Mode `class` 策略
>
> 本文件是 AI Agent 的设计入口。具体实现细节见源文件，本文件提供架构级参考和快速查询。

---

## 1. 视觉主题与氛围

### 设计哲学

这是一个**数据密集型保险经营分析看板**，不是消费级 SaaS 产品。设计服务于一个核心场景：省级保险分公司的经营管理者，在一屏之内看懂经营全貌——保费进度、赔付率走势、成本结构、团队排名。

### 三个设计原则

| 原则 | 含义 | 体现 |
|------|------|------|
| **数字即主角** | KPI 数值是视觉焦点，标题和装饰是配角 | KPI 用 30px Avenir Next，标题仅 14-18px |
| **颜色即语义** | 每种颜色都有唯一的业务含义，禁止装饰性用色 | 红=危险/下降，绿=健康/增长，蓝=主操作/信息 |
| **密度即效率** | 信息密度优先于留白美学，每个像素都要传递数据 | 表格行高紧凑，卡片内边距 p-3/p-4，禁止网格线 |

### 视觉调性

整体氛围是**克制的专业感**——白色底面上浮着轻盈的卡片，柔和的阴影暗示层级但不喧宾夺主。色彩使用高度克制，大面积的白与浅灰构成视觉基底，颜色只在传递语义时出现——这种"安静底色 + 精准语义色"的策略让用户视线自然聚焦于异常数据和关键指标。

- **专业克制**：无渐变、无阴影装饰、无动画干扰。阴影仅用于层级区分（卡片浮起）
- **中文优先排版**：默认 14px（text-sm），中文可读性最佳区间。PingFang SC / Microsoft YaHei 优先
- **Light / Dark 双模式**：浅色为主力，深色模式用 4 层 surface 递进营造深度感
- **无网格线图表**：所有 ECharts 图表禁止网格线（splitLine），美感第一、数据密度第二
- **克制的动效**：只有 hover 反馈和页面过渡，不使用弹跳、闪烁等注意力消耗型动画

---

## 2. 色板与角色

### 语义色（5 色）

| 语义 | 色值 | 角色 | Tailwind 前缀 |
|------|------|------|---------------|
| Primary | `#1890ff` | 主操作、链接、强调、信息 | `primary` (50-900) |
| Success | `#52c41a` | 正面状态、增长指标、达标 | `success` |
| Warning | `#faad14` | 警示、注意、接近阈值 | `warning` |
| Danger | `#ff4d4f` | 错误、负面状态、超标 | `danger` |
| Neutral | `#8c8c8c` (500) | 文本、边框、背景 | `neutral` (50-900) |

每个语义色提供 6 个变体：`DEFAULT` / `light` / `dark` / `solid` / `bg` / `border`。

### 扩展色（5 色）

| 色名 | 色值 | 用途 |
|------|------|------|
| Purple | `#722ed1` | 成本相关（综合分析） |
| Indigo | `#4f46e5` | 高级功能、AI 分析模块 |
| Sky | `#0284c7` | 辅助信息色 |
| Orange | `#ea580c` | 业务标签（非警告） |
| Amber | `#d97706` | 次级警告、转保相关 |

每组均含 DEFAULT / light / bg / border / solid 变体。

### 中性色阶（Neutral Gray）

静态色值，不走 CSS 变量。深色模式需手动 `dark:` 前缀。

| 色阶 | 值 | 典型用途 |
|------|-----|----------|
| 50 | `#fafafa` | 次级背景 |
| 100 | `#f5f5f5` | 交替行、禁用背景 |
| 200 | `#e8e8e8` | 边框、分割线 |
| 300 | `#d9d9d9` | 禁用边框 |
| 400 | `#bfbfbf` | 占位符文字 |
| 500 | `#8c8c8c` | 辅助文本、图标 |
| 600 | `#595959` | 次要正文 |
| 700 | `#434343` | 正文 |
| 800 | `#262626` | 标题 |
| 900 | `#1f1f1f` | 强调标题 |

### 综合分析专用色板（9 色）

```typescript
import { comprehensiveTheme } from '@/shared/styles'
```

| 语义 | 色值 | 用途 |
|------|------|------|
| premium | `#0050B3` | 保费相关 |
| claim | `#C41D7F` | 赔付相关 |
| expense | `#FA8C16` | 费用相关 |
| cost | `#531DAB` | 成本相关 |
| roi | `#08979C` | 投资回报 |
| neutral | `#8C8C8C` | 中性/分割线 |
| splitLine | `#F0F0F0` | 图表分割线 |
| success | `#389E0D` | 达标 |
| danger | `#CF1322` | 超标 |

### 图表色 token（ECharts canvas 专用 · `chartColors`）

> **为什么单独一层**：ECharts 渲染在 `<canvas>` 里，**读不到 CSS 变量与 Tailwind class**，
> 图表色必须是具体 hex 字符串。`chartColors`（`src/shared/styles/index.ts`）是所有 ECharts
> option 硬编码 hex 的唯一来源 —— 把散落在各图表组件里的裸 hex 收拢、按语义命名后复用（B247）。
>
> **两套调色板并存是既有事实**：UI 色系 `colors.*` 是 antd 色系（主蓝 `#1890ff`），面向 DOM
> className；图表历史上用 Tailwind / ECharts 色系（`#3B82F6` / `#10B981` / 经典 6 色分类板）。
> `chartColors` **如实保留图表色系、不强并入 `colors`**（并入会改变渲染颜色），仅对 hex 对齐项
> 引用 `semanticColors`（如 `series.blue = semanticColors.info.DEFAULT`）。

```typescript
import { chartColors } from '@/shared/styles'
option.color = chartColors.categorical                    // 多系列默认循环板
series: [{ itemStyle: { color: chartColors.series.emerald } }]
```

| 组 | 键 | 色值 / 内容 | 用途 |
|----|----|------------|------|
| `categorical` | [0..5] | `#5470C6` `#91CC75` `#FAC858` `#EE6666` `#73C0DE` `#9A60B4` | 无固定语义的分类维度循环（吨位 / 树图 / 地图折线） |
| `series` | blue / blueLight | `#3B82F6` / `#60A5FA` | 承保 / 主蓝线 · 渐变亮端（对齐 `semanticColors.info`） |
| `series` | emerald / amber / orange | `#10B981` / `#F59E0B` / `#fa8c16` | 转化率正向线 · 转保预警线 · 达成率阈值标记 |
| `series` | slate / slateLight | `#94a3b8` / `#e2e8f0` | 报价量柱 · 报价量柱基线 |
| `series` | teal / gold / coral / good / danger / muted | `#13C2C2` `#E8B339` `#F5615C` `#52C41A` `#F5222D` `#8C8C8C` | 图表账本语义色（主色 / 阈值线 / 离群 / 达标 / 超标 / 参照） |
| `geoRamp` | greenBlue / blue | 4~5 段渐变 | 地图 visualMap（赔付风险 绿→蓝 / 保费规模 蓝阶） |
| `mapAreaHighlight` | — | `#ffd666` | 地图选中 / 聚焦区域填充 |

**深色模式**：图表文字 / 轴 / 网格明暗切换由 `getChartTheme(isDark)`（`shared/config/chartStyles.ts`）
统一负责；`chartColors.series` 色值在明 / 暗两态背景上均可读，故不按 token 分明暗。

**诚实边界（本层不收拢什么）**：① 各图表里 `isDark ? '#a3a3a3' : '#595959'` 之类**文字 / 轴色**属
`getChartTheme` 主题层，非调色板 token，统一迁移是独立行为性重构，另行登记；② 色块上的固定深色墨字
（如 `#10161f`）是 canvas 必需对比色，就地保留。

### 报价转化专用色（6 色）

> 派生自 `chartColors.series`（B247 起不再裸 hex），语义映射保持不变。

```typescript
import { quoteChartColors } from '@/shared/styles'
```

| 语义 | 色值 | 用途 |
|------|------|------|
| quoteBar | `#94a3b8` | 报价量柱（灰） |
| quoteBarLight | `#e2e8f0` | 报价量柱-浅（时间趋势） |
| insuredBar | `#3B82F6` | 承保量柱（蓝） |
| conversionLine | `#10B981` | 转化率线（绿） |
| renewalLine | `#3B82F6` | 续保转化率线（蓝） |
| switchLine | `#F59E0B` | 转保转化率线（琥珀） |

### 图表年份色（6 年）

```typescript
import { getYearChartColor } from '@/shared/styles'
// 用法：getYearChartColor(2026) → '#3B82F6'
```

| 年份 | 色值 | 色系 |
|------|------|------|
| 2023 | `#6366F1` | indigo-500 |
| 2024 | `#F97316` | orange-500 |
| 2025 | `#10B981` | emerald-500 |
| 2026 | `#3B82F6` | blue-500 |
| 2027 | `#EC4899` | pink-500 |
| 2028 | `#A855F7` | purple-500 |

### 热力图色阶

转化率 → 背景色渐变，使用 `getHeatmapColor(rate)` 函数：

| 转化率区间 | 色彩 | 文字色 |
|-----------|------|--------|
| ≥15% | 成功色实心 (success-solid) | 白色 |
| ≥10% | 成功色边框 (success-border) | 深色文字 |
| ≥7% | 成功色背景 (success-bg) | 深色文字 |
| ≥4% | 琥珀色背景 (amber-bg) | 深色文字 |
| ≥1% | 危险色背景 (danger-bg) | 深色文字 |
| <1% | 危险色边框 (danger-border) | 深色文字 |

### 趋势色逻辑

趋势颜色不是简单的"涨绿跌红"，而是根据**指标方向**（polarity）决定：

- **正向指标**（保费、件数、达成率）：涨 = 绿，跌 = 红
- **反向指标**（赔付率、费用率、出险率）：涨 = 红，跌 = 绿
- **中性**（零变化）：灰色 (`neutral-400`)

使用 `getTrendColorClass(value, polarity)` 函数，禁止手动判断。

### Dark Mode 双轨机制

这是本项目 dark mode 的**关键架构决策**，直接影响每一行样式代码的写法：

| 颜色类别 | 机制 | `dark:` 前缀 | 示例 |
|----------|------|-------------|------|
| **语义色** (primary/success/warning/danger/purple/indigo/sky/orange/amber) | CSS 变量自动切换 | **不需要** | `text-primary`（自动适配深色） |
| **中性色** (neutral 50-900) | 静态色阶 | **必须手动写** | `text-neutral-900 dark:text-neutral-100` |

**深色表面层级**（从深到浅递进）：

| 层级 | 变量 | 色值 | 用途 |
|------|------|------|------|
| surface-0 | `--surface-0` | `#0f0f10` | 页面底色 |
| surface-1 | `--surface-1` | `#161618` | 卡片/面板 |
| surface-2 | `--surface-2` | `#1c1c1f` | 嵌套容器/表头 |
| surface-3 | `--surface-3` | `#232326` | hover/交替行 |

边框变量：`--border-subtle: rgba(255,255,255,0.06)` / `--border-default: rgba(255,255,255,0.10)`

### 语义化颜色类（colorClasses）

```typescript
import { colorClasses } from '@/shared/styles'
```

**禁止硬编码 Tailwind 颜色类**，必须使用 `colorClasses.*`：

| 硬编码（禁止） | 语义常量（使用） | 用途 |
|----------------|-----------------|------|
| `text-red-800` | `colorClasses.text.danger` | 错误/负面 |
| `text-green-600` | `colorClasses.text.success` | 成功/增长 |
| `bg-red-50` | `colorClasses.bg.danger` | 错误背景 |
| `bg-gray-50` | `colorClasses.bg.neutral` | 中性背景 |
| `border-red-*` | `colorClasses.border.danger` | 错误边框 |
| `text-gray-900` | `colorClasses.text.neutralBlack` | 主文本 |
| `text-gray-600` | `colorClasses.text.neutral` | 次要文本 |
| `text-gray-400` | `colorClasses.text.neutralMuted` | 辅助/标签 |

---

## 3. 排版规则

### 字体族（4 套）

| 用途 | CSS 类 | 字体栈 | 性格 |
|------|--------|--------|------|
| **正文**（默认） | `font-sans` | -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ... | 清晰中性，适合长时间阅读 |
| **KPI 大数字** | `.font-kpi` | "Avenir Next", "Century Gothic", "SF Pro Display", ... | 几何感强、笔画均匀的展示型字体 |
| **数据数字** | `.font-numeric` | "SF Pro Text", "Helvetica Neue", ... + `tabular-nums` | 等宽数字，表格列对齐 |
| **等宽/代码** | `font-mono` | SFMono-Regular, Consolas, Menlo, monospace | 技术信息 |

### 字号层级

| 令牌 | 尺寸 | 行高 | 用途 |
|------|------|------|------|
| `text-xs` | 12px | 1rem | 辅助标签、表格注脚、图表轴标签 |
| `text-sm` | 14px | 1.25rem | **正文默认**、表格内容、表单标签 |
| `text-base` | 16px | 1.5rem | 标准正文、对话框内容 |
| `text-lg` | 18px | 1.75rem | 小标题、卡片标题 |
| `text-xl` | 20px | 1.75rem | 中标题、区域标题 |
| `text-2xl` | 24px | 2rem | KPI 次级数字、页面大标题 |
| `text-3xl` | 30px | 2.25rem | KPI 主数字、最高层级标题 |
| `text-4xl` | 36px | 2.5rem | 极少使用，仅全屏焦点数字 |

### 数字分层样式

| 层级 | 常量 | 类名组合 | 场景 |
|------|------|----------|------|
| **KPI 主数字** | `numericStyles.kpiPrimary` | `font-kpi text-3xl tracking-tight font-bold leading-none` | 看板顶部核心 KPI（30px） |
| **KPI 次级数字** | `numericStyles.kpiSecondary` | `font-kpi text-2xl tracking-tight font-bold leading-none` | 次级 KPI、对比数字（24px） |
| **表格数值** | `numericStyles.tableValue` | `font-numeric tabular-nums text-sm text-neutral-900` | 表格中的主数字 |
| **表格次要数值** | `numericStyles.tableSecondary` | `font-numeric tabular-nums text-sm text-neutral-500` | 表格中的辅助数字 |
| **小号数值** | `numericStyles.captionValue` | `font-numeric tabular-nums text-xs` | 标签、统计摘要 |

### 文本预设

| 预设 | 常量 | 类名 |
|------|------|------|
| 大标题 | `textStyles.titleLarge` | `text-2xl font-bold text-neutral-900` |
| 中标题 | `textStyles.titleMedium` | `text-lg font-semibold text-neutral-800` |
| 小标题 | `textStyles.titleSmall` | `text-base font-medium text-neutral-700` |
| 正文 | `textStyles.body` | `text-sm text-neutral-700` |
| 辅助文本 | `textStyles.caption` | `text-xs text-neutral-500` |
| 标签 | `textStyles.label` | `text-sm font-medium text-neutral-700` |
| 数值 | `textStyles.numeric` | `font-numeric tabular-nums` |

---

## 4. 组件样式

### 卡片（Card）

| 变体 | 常量 | 视觉特征 | 使用场景 |
|------|------|----------|----------|
| **Default** | `cardStyles.base` | 白底 + neutral-200 边框 + shadow-sm | 95% 的卡片 |
| **Interactive** | `cardStyles.interactive` | Default + hover 阴影加深 | 可点击的下钻卡片 |
| **Compact** | `cardStyles.compact` | Default + p-3 | 紧凑型小卡片 |
| **Standard** | `cardStyles.standard` | Default + p-4 | 标准卡片 |
| **Spacious** | `cardStyles.spacious` | Default + p-6 | 宽松卡片、首屏模块 |

深色模式：`bg-surface-1` + `border-subtle` + 无阴影（用边框替代层级感）。

**StatCard（KPI 统计卡）**：标题 14px 灰色在上，数字 24px 粗体在下，趋势箭头和变化值在底部。可选图标区域使用 primary-bg 圆角背景。

### 按钮（Button）

| 变体 | 常量 | 视觉特征 |
|------|------|----------|
| **Primary** | `buttonStyles.primary` | 蓝底白字，hover 变亮，active 变深 |
| **Secondary** | `buttonStyles.secondary` | 浅灰底 + 边框，hover 加深 |
| **Ghost** | `buttonStyles.ghost` | 透明底，hover 出现浅灰背景 |
| **Danger** | `buttonStyles.danger` | 红底白字 |
| **Link** | `buttonStyles.link` | 蓝色文字，hover 下划线 |

基础样式：`inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:ring-2 focus:ring-offset-2`。
尺寸：Small `px-3 py-1.5 text-sm` · Medium `px-4 py-2 text-sm` · Large `px-6 py-3 text-base`。

### 切换按钮（Toggle Button）

用于维度/粒度切换（日/周/月、保费/件数视角）：

| 状态 | 样式 |
|------|------|
| **选中** | 深灰底 (neutral-800) + 白字 |
| **未选中** | 浅灰底 (neutral-100) + 灰字 + hover 加深 |

### 徽章（Badge）

药丸形状（rounded-full），12px 字号，font-medium。

| 状态 | 背景 | 文字 |
|------|------|------|
| Default | neutral-100 | neutral-700 |
| Primary | primary-bg | primary-dark |
| Success | success-bg | success-dark |
| Warning | warning-bg | warning-dark |
| Danger | danger-bg | danger-dark |

背景与文字之间至少跨 3 级色阶，确保对比度。

### 输入框（Input）

白底 + neutral-300 边框 + 圆角 lg + 聚焦时蓝色环。错误态红色边框 + 红色聚焦环。禁用态灰色背景 + 禁止光标。

### 表格（Table）

| 部位 | 样式 |
|------|------|
| **容器** | 白底 + rounded-lg + 边框 + shadow-sm |
| **表头** | neutral-50 背景 + 底边框 + 12px 大写 + font-semibold |
| **表头单元格** | `px-3 py-2 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider` |
| **行** | 底边框 + hover 浅灰背景 + transition-colors |
| **单元格** | `px-3 py-2 text-sm text-neutral-700` |
| **数值单元格** | 右对齐 + `font-numeric tabular-nums` |

### 吸顶表格（Sticky Table）

长数据表使用吸顶表头 + 冻结首列：

- **滚动容器**：`overflow-auto overscroll-contain` + 圆角 + 边框
- **吸顶表头**：`sticky top-0 z-20` + 底部 inset shadow 分割线
- **冻结首列**：`sticky left-0` + 右侧 inset shadow 分割线
- **交叉单元格**（首列 + 表头）：`sticky left-0 top-0 z-30` + 双方向 shadow

---

## 5. 布局原则

### 页面结构

```
┌─────────────────────────────────────────────┐
│  顶部导航栏 (h-14, 固定)                      │
├──────┬──────────────────────────────────────┤
│      │                                      │
│ 侧边栏 │  主内容区 (flex-1, 可滚动)            │
│ 240px │  max-w-7xl mx-auto px-4~px-8       │
│ 可折叠 │                                     │
│ →64px │  ┌─ KPI 网格 (4列) ────────────┐    │
│      │  └──────────────────────────────┘    │
│      │  ┌─ 趋势图表 (全宽) ─────────────┐   │
│      │  └──────────────────────────────┘    │
│      │  ┌─ 明细表格 (全宽) ─────────────┐   │
│      │  └──────────────────────────────┘    │
└──────┴──────────────────────────────────────┘
```

移动端（<768px）：侧边栏变为覆盖层，汉堡按钮切换。锚点导航浮于右侧，快速跳转分析模块。

### 网格系统

| 布局 | 类名 | 响应式 |
|------|------|--------|
| 2 列 | `grid grid-cols-1 sm:grid-cols-2 gap-4` | 手机单列 |
| 3 列 | `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4` | 平板两列 |
| 4 列（KPI） | `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4` | KPI 网格 |

### 间距比例

基于 4px 基准网格：

| 令牌 | 值 | 典型用途 |
|------|------|----------|
| `xs` | 4px | 紧凑间隙（徽章内边距、图标与文字） |
| `sm` | 8px | 小间距（列表项、按钮组） |
| `md` | 16px | 标准间距（卡片内边距、段落） |
| `lg` | 24px | 大间距（区域间距、卡片间距） |
| `xl` | 32px | 模块间距 |
| `2xl` | 48px | 页面级间距 |
| `3xl` | 64px | 极大间距（极少使用） |

### 留白规则

- 模块间 `space-y-4` (16px) 垂直堆叠
- 卡片标题与内容 `mb-4` (16px)
- 紧凑区域（筛选器按钮组）`gap-2` (8px)

---

## 6. 深度与层级

### 阴影系统

阴影极其克制——大多数元素只用最轻的阴影，避免视觉噪音。

| 令牌 | CSS 值 | 用途 |
|------|--------|------|
| **shadow-sm** | `0 1px 2px rgba(0,0,0,0.05)` | 默认卡片——几乎看不到但能感知 |
| **shadow-card** | `0 2px 8px rgba(0,0,0,0.09)` | elevated 变体卡片 |
| **shadow-md** | `0 4px 6px rgba(0,0,0,0.1)` | hover 浮起 |
| **shadow-dropdown** | `0 3px 6px -4px rgba(0,0,0,0.12), 0 6px 16px rgba(0,0,0,0.08)` | 下拉菜单、弹出层 |
| **shadow-lg** | `0 10px 15px rgba(0,0,0,0.1)` | 模态框 |

深色模式下阴影全部消失（`box-shadow: none`），改用 surface 明度递进和半透明边框传达层级。

### 圆角系统

| 令牌 | 值 | 用途 |
|------|------|------|
| `rounded-sm` | 2px | 微妙圆角 |
| `rounded-md` | 6px | 输入框、小按钮 |
| `rounded-lg` | 8px | **卡片、按钮**（最常用） |
| `rounded-xl` | 12px | 大容器、模态框 |
| `rounded-2xl` | 16px | 特殊强调容器 |
| `rounded-full` | 9999px | 徽章、药丸按钮 |

---

## 7. 图表规范

### 设计哲学

图表是看板的视觉中心——用视觉语言讲述经营故事，不是数据的机械映射。

- **美感第一**，数据密度第二——宁可少一个系列，也不让图表拥挤
- **背景透明**，无多余装饰元素
- **坐标轴极简**——尽量隐藏或极细淡色
- **精确数值交给 tooltip**，图表只传达趋势和对比

### ECharts 默认配置

所有图表必须包含：

```typescript
grid: { containLabel: true },
xAxis: { splitLine: { show: false } },
yAxis: { splitLine: { show: false } },
```

### 标签智能显示

动态标签禁止全量显示，按优先级筛选：

| 优先级 | 类型 | 说明 |
|--------|------|------|
| 1 | 极值 | 最高值/最低值必须标注 |
| 2 | 异常值 | 偏离均值 ≥2σ 或超阈值 |
| 3 | 均值 | 参考基准线标注 |
| 4 | 最新值 | 时间序列最右端点 |
| 5 | 时间锚点 | 每月1日、季度首日 |

通过 `label.formatter` 或 `series.data[i].label.show` 逐点控制，而非全局 `label.show: true`。

### 常用图表类型

| 类型 | 用途 | 配置要点 |
|------|------|----------|
| **折线图** | 时间趋势（保费/件数走势） | 圆点标记、平滑曲线、多系列 |
| **柱+线组合** | 双指标对比（保费柱+达成率线） | 双 Y 轴，左柱右线 |
| **饼/环形图** | 构成分析（险种占比、车型分布） | 标注百分比 |
| **热力图** | 区域×时间绩效矩阵 | 颜色强度=指标值 |
| **散点/四象限图** | 业务员绩效分层 | X=件数, Y=件均保费 |

### 走势图 X 轴日期

- 日维度：每月1日显示 `{M月1日}` 并加粗（11px），其余只显示日数字
- 使用 `formatTrendDailyXAxis()` + `TREND_DAILY_XAXIS_RICH`

---

## 8. 数值格式化

### 率值指标

| 指标类型 | 小数位 | 显示方式 | 函数 | 示例 |
|----------|--------|----------|------|------|
| 赔付率、费用率、出险率（表格） | **1 位** | 列头标注 `(%)`，数字不带 `%` | `value.toFixed(1)` | 列头 `赔付率(%)` 值 `68.5` |
| 赔付率等（tooltip/卡片） | **1 位** | 带 `%` 后缀 | `formatPercent` | `68.5%` |
| 达成率（小数输入） | **1 位** | 带 `%` | `formatAchievementRate` | `85.0%` |
| 自主定价系数 | **4 位** | 无单位 | `formatCoefficient` | `0.8523` |

> **注意**：`formatPercent` 返回带 `%` 的字符串（如 `68.5%`），适用于 tooltip、卡片、独立展示。表格列头已标注 `(%)` 时，单元格应使用 `value.toFixed(1)` 纯数字，避免重复标注。

### 绝对值指标

| 指标类型 | 单位 | 小数位 | 函数 | 示例 |
|----------|------|--------|------|------|
| 保费、赔款、费用 | **万元** | **取整** | `formatPremiumWan` | 列头 `保费(万元)` 值 `1,256` |
| 案均赔款、件均保费 | **元** | **1位** | `formatAverage` | `8,432.5` |
| 件数 | **件** | **整数** | `formatCount` | `1,234` |
| 图表 Y 轴保费 | 万元 | 整数 | `formatChartValue` | `1235`（无千分位） |

### 格式化铁律

- 率值数字**不带** `%` 后缀，`%` 只出现在列头/标签
- 金额使用**千分位**（`1,256`），万元单位在列头标注
- 图表 Y 轴紧凑纯数字（无千分位、无单位）
- 空值/异常值统一显示 `-`

### 排序规范

**表格行排序**（必须排序，禁止无序）：

| 优先级 | 规则 | 示例 |
|--------|------|------|
| 1 | 主题指标**从差到好** | 赔付率分析 → 赔付率降序 |
| 2 | 无好坏标准，**从小到大** | 保费规模 → 升序 |
| 3 | 多维度时，主题指标为第一键 | 成本 → 综合成本率降序为主 |

**表格列排序**：最左=维度标签 → 主题核心指标 → 辅助指标

**文字叙述**：多实体并列时，**表现最差的排最前**。

---

## 9. 做与不做

### 必须做

- 使用 `colorClasses.*` / `cardStyles.*` / `buttonStyles.*` / `numericStyles.*` 常量
- 导入格式化函数：`formatPremiumWan` / `formatPercent` / `formatCount` 等
- 年份色用 `getYearChartColor(year)`，趋势色用 `getTrendColorClass(value, polarity)`
- 背景与文字跨 3+ 级色阶确保对比度
- KPI 数字用 `numericStyles.kpiPrimary/kpiSecondary`
- 表格数字右对齐 + `font-numeric tabular-nums`
- DuckDB 返回字段做空值防护（`?? ''` 再操作）
- ECharts 图表包含 `splitLine: { show: false }`

### 禁止做

- ❌ 硬编码 Tailwind 颜色（`text-red-500`、`bg-blue-600`）
- ❌ 虚构类名（`className="font-kpi text-xl"` → 用 `fontStyles.kpi`）
- ❌ 手写长串卡片/按钮 Tailwind（用预设常量）
- ❌ 硬编码年份/趋势颜色判断逻辑
- ❌ 率值数字后跟 `%`（`68.5%` → 应为 `68.5`，`%` 在列头）
- ❌ 率值 2+ 位小数（统一 1 位，系数除外 4 位）
- ❌ 金额用"元"显示大数（→ 万元取整 `1,256`）
- ❌ 图表网格线（`splitLine: { show: false }`）
- ❌ 图表全量标签（必须智能筛选）
- ❌ 已废弃的 `font-chart-number` / `fontStyles.chart`（用 `font-numeric`）
- ❌ 硬编码格式化（`(premium / 10000).toFixed(2)` → 用 `formatPremiumWan`）

---

## 10. 响应式行为

### 断点

| 断点 | 宽度 | 用途 |
|------|------|------|
| `xs` | 375px | 小屏手机 |
| `sm` | 640px | 手机 |
| `md` | 768px | 平板 |
| `lg` | 1024px | 桌面 |
| `xl` | 1280px | 大桌面 |
| `2xl` | 1536px | 超大屏 |

### 适配策略

| 组件 | 桌面 (≥1024px) | 平板 (768~1023px) | 手机 (<768px) |
|------|---------------|-------------------|---------------|
| 侧边栏 | 展开 240px | 折叠 64px | 覆盖层 + 汉堡 |
| KPI 网格 | 4 列 | 2 列 | 1 列 |
| 数据表格 | 全列 | 横向滚动 | 滚动 + 冻结首列 |
| 容器内边距 | `px-8` | `px-6` | `px-4` |

### 动画

| 令牌 | 时长 | 用途 |
|------|------|------|
| `transition.fast` | 0.15s | 按钮 hover/active |
| `transition.normal` | 0.2s | 卡片 hover、侧边栏 |
| `transition.slow` | 0.3s | 模态框、页面切换 |
| `animate-pulse-slow` | 3s | 加载等待脉冲 |
| `animate-shimmer` | 2s | 骨架屏闪烁 |

### 业务阈值

| 指标 | 阈值 | 含义 |
|------|------|------|
| 保费进度 | 99% | 低于 = 落后计划 |
| 综合成本率 | 91% | 高于 = 亏损风险 |
| 赔付率 | 70% | 高于 = 赔付偏高 |
| 费用率 | 16% | 高于 = 费用超标 |
| 费用预算 | 14% | 内控预警线 |

---

## 11. Agent 快速参考

### 必记色值（5 个）

| 色值 | 语义 | 场景 |
|------|------|------|
| `#1890ff` | Primary | 主操作、链接、强调 |
| `#52c41a` | Success | 增长、达标、正面 |
| `#ff4d4f` | Danger | 下降、超标、负面 |
| `#faad14` | Warning | 警示、接近阈值 |
| `#8c8c8c` | Neutral-500 | 次要文本、辅助信息 |

### 必记字体（3 套）

| 类名 | 场景 |
|------|------|
| `font-sans`（默认） | 所有正文、标题、标签 |
| `font-kpi` | KPI 大数字（30px / 24px） |
| `font-numeric` | 表格数字、图表标签（tabular-nums 等宽） |

### 必记导入

```typescript
// 样式系统（所有 UI 代码必须导入）
import {
  cardStyles, buttonStyles, badgeStyles, tableStyles, stickyTableStyles,
  inputStyles, toggleButtonStyles, layoutStyles, stateStyles,
  textStyles, numericStyles, fontStyles,
  colorClasses, colors, semanticColors, comprehensiveTheme, quoteChartColors,
  cn, conditionalStyle,
  getTrendColorClass, getTrendColorClassByPolarity, getTrendDirection,
  getStatusColorClass, getStatusBgClass,
  getYearChartColor, getHeatmapColor,
} from '@/shared/styles'

// 格式化工具（所有数据展示必须导入）
import {
  formatCount, formatAverage, formatPremiumWan, formatPercent,
  formatCoefficient, formatChartValue, formatAchievementRate,
  formatWanAdaptive, formatSalesmanName, formatTeamName,
  formatTrendDailyXAxis, TREND_DAILY_XAXIS_RICH,
} from '@/shared/utils/formatters'
```

### 工具函数速查

| 函数 | 用途 | 示例 |
|------|------|------|
| `cn('a', cond && 'b')` | 合并 className | `cn(cardStyles.base, 'p-4')` |
| `conditionalStyle(bool, 'a', 'b')` | 条件样式 | true → `'a'`, false → `'b'` |
| `getTrendColorClass(value)` | 趋势色（涨绿跌红） | `5.2` → `'text-success'` |
| `getTrendColorClass(value, true)` | 反转趋势色（涨红跌绿） | `5.2` → `'text-danger'` |
| `getTrendDirection(value)` | 趋势方向 | `5.2` → `'up'`, `0` → `'flat'` |
| `getStatusColorClass('danger')` | 状态文字色 | → `'text-danger'` |
| `getStatusBgClass('success')` | 状态背景色 | → `'bg-success-bg'` |
| `getYearChartColor(2026)` | 年份图表色 | → `'#3B82F6'` |
| `getHeatmapColor(12.5)` | 热力图色阶 | → `'bg-success-border ...'` |

### 典型组件提示

**KPI 卡片**：`<StatCard title="保费" value={formatPremiumWan(premium)} trend="up" trendValue="+5.2%" metricPolarity="positive" />`

**数据表格**：容器 `tableStyles.container`，表头 `tableStyles.header` + `headerCell`，行 `tableStyles.row`，文字 `tableStyles.cell`，数字 `tableStyles.cellNumeric`。

**趋势图表**：ECharts option 含 `grid: { containLabel: true }, splitLine: { show: false }`。年份色 `getYearChartColor(year)`，Y 轴 `formatChartValue`。

**趋势颜色**：`className={getTrendColorClass(changeValue, 'positive')}` 正向指标（涨绿跌红），`'negative'` 反向指标（涨红跌绿）。

### UI 审查评分基准（供 /chexian-ui-review 命令参照）

评分维度共 6 项：视觉设计 / 交互设计 / 布局与结构 / 响应式设计 / 可访问性 / 性能与体验。

| 等级 | 分数范围 | 含义 |
|------|---------|------|
| 优秀 | 90-100 分 | 符合设计规范，视觉统一，无明显问题 |
| 良好 | 75-89 分 | 大部分符合，有少量不一致 |
| 需改进 | 60-74 分 | 存在明显的视觉或交互问题 |
| 不合格 | < 60 分 | 严重违反设计原则，必须修复后才能上线 |

间距体系（来源：`src/shared/styles/index.ts` `spacing` 对象，4px 基准网格）：

| 名称 | 值 | 典型用途 |
|------|-----|---------|
| xs | 4px (0.25rem) | 徽章内边距、图标与文字间隙 |
| sm | 8px (0.5rem) | 列表项、按钮组 |
| md | 16px (1rem) | 卡片内边距、标准间距（注：chexian-ui-review 旧文档写 12px 为三档，实际 index.ts 无独立 12px 档位） |
| lg | 24px (1.5rem) | 区域间距、卡片间距 |
| xl | 32px (2rem) | 模块间距 |

---

> **文件关系**：`DESIGN.md`（本文件）是 AI Agent 设计入口 → `src/shared/styles/index.ts` 是运行时唯一事实源 → `src/app/index.css` 是 CSS 变量定义 → `.claude/rules/design-tokens.md` 已废弃，由本文件替代。
