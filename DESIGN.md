# DESIGN.md — 车险数据分析看板设计系统

> **唯一事实源**：`src/shared/styles/index.ts` + `src/shared/utils/formatters.ts` + `src/app/index.css`
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

- **专业克制**：无渐变、无阴影装饰、无动画干扰。阴影仅用于层级区分（卡片浮起）
- **中文优先排版**：默认 14px（text-sm），中文可读性最佳区间。PingFang SC / Microsoft YaHei 优先
- **Light / Dark 双模式**：浅色为主力，深色模式用 4 层 surface 递进营造深度感

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
| Indigo | `#4f46e5` | 2023 年份标识 |
| Sky | `#0284c7` | 辅助信息色 |
| Orange | `#ea580c` | 业务标签（非警告） |
| Amber | `#d97706` | 转保转化率线 |

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

### 报价转化专用色（6 色）

```typescript
import { quoteChartColors } from '@/shared/styles'
```

| 语义 | 色值 | 用途 |
|------|------|------|
| quoteBar | `#94a3b8` | 报价量柱（灰） |
| quoteBarLight | `#e2e8f0` | 报价量柱-浅（时间趋势） |
| insuredBar | `#3b82f6` | 承保量柱（蓝） |
| conversionLine | `#10b981` | 转化率线（绿） |
| renewalLine | `#3b82f6` | 续保转化率线（蓝） |
| switchLine | `#f59e0b` | 转保转化率线（琥珀） |

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
| `border-red-200` | `colorClasses.border.danger` | 错误边框 |
| `text-gray-900` | `colorClasses.text.neutralBlack` | 主文本 |
| `text-gray-600` | `colorClasses.text.neutral` | 次要文本 |
| `text-gray-400` | `colorClasses.text.neutralMuted` | 辅助/标签 |

---

## 3. 排版规则

### 字体栈（4 套）

| 用途 | CSS 类 / 变量 | 字体栈 |
|------|--------------|--------|
| 正文（默认） | `font-sans` | -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif |
| KPI 大数字 | `font-kpi` / `var(--font-kpi)` | "Avenir Next", Avenir, "Century Gothic", "SF Pro Display", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", system-ui, sans-serif |
| 数字（图表+表格） | `font-numeric` / `var(--font-numeric)` | "SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", -apple-system, system-ui, sans-serif + `tabular-nums` |
| 代码/等宽 | `font-mono` | SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace |

> `font-chart-number` 和 `font-tabular` 是废弃别名，统一使用 `font-numeric`。

### 字号层级（8 级）

| 令牌 | 尺寸 | 行高 | 用途 |
|------|------|------|------|
| `text-xs` | 12px | 1rem | 辅助信息、标签、表格注脚 |
| `text-sm` | 14px | 1.25rem | **正文默认**、表格内容 |
| `text-base` | 16px | 1.5rem | 标准正文 |
| `text-lg` | 18px | 1.75rem | 小标题 |
| `text-xl` | 20px | 1.75rem | 中标题 |
| `text-2xl` | 24px | 2rem | KPI 数值、大标题 |
| `text-3xl` | 30px | 2.25rem | 页面标题、KPI 主数字 |
| `text-4xl` | 36px | 2.5rem | 大号标题（极少用） |

### 数字分层样式（numericStyles）

```typescript
import { numericStyles } from '@/shared/styles'
```

| 常量 | 类名 | 用途 |
|------|------|------|
| `numericStyles.kpiPrimary` | `font-kpi text-3xl tracking-tight font-bold leading-none` | KPI 主数字 (30px) |
| `numericStyles.kpiSecondary` | `font-kpi text-2xl tracking-tight font-bold leading-none` | KPI 次级数字 (24px) |
| `numericStyles.tableValue` | `font-numeric tabular-nums text-sm text-neutral-900 dark:text-neutral-100` | 表格数字 |
| `numericStyles.tableSecondary` | `font-numeric tabular-nums text-sm text-neutral-500 dark:text-neutral-400` | 表格次要数字 |
| `numericStyles.captionValue` | `font-numeric tabular-nums text-xs` | 小号数字/统计 |

### 文本预设（textStyles，9 个）

```typescript
import { textStyles } from '@/shared/styles'
```

| 常量 | 样式 | 用途 |
|------|------|------|
| `textStyles.titleLarge` | `text-2xl font-bold text-neutral-900 dark:text-neutral-100` | 页面大标题 |
| `textStyles.titleMedium` | `text-lg font-semibold text-neutral-800 dark:text-neutral-200` | 区块标题 |
| `textStyles.titleSmall` | `text-base font-medium text-neutral-700 dark:text-neutral-300` | 小标题 |
| `textStyles.body` | `text-sm text-neutral-700 dark:text-neutral-300` | 正文 |
| `textStyles.caption` | `text-xs text-neutral-500 dark:text-neutral-400` | 辅助文本 |
| `textStyles.label` | `text-sm font-medium text-neutral-700 dark:text-neutral-300` | 表单标签 |
| `textStyles.link` | `text-primary hover:text-primary-light cursor-pointer` | 链接 |
| `textStyles.emphasis` | `font-semibold` | 强调 |
| `textStyles.numeric` | `font-numeric tabular-nums` | 等宽数字 |

---

## 4. 组件样式

所有组件样式从 `src/shared/styles/index.ts` 导入，**禁止重写长串 Tailwind 类**。

### 卡片（cardStyles，5 变体）

```typescript
import { cardStyles } from '@/shared/styles'
```

| 变体 | 特征 | 内边距 |
|------|------|--------|
| `base` | 白底 + rounded-lg + neutral-200 边框 + shadow-sm | 无（自行添加） |
| `interactive` | base + hover 阴影 + transition | 无 |
| `compact` | base + 紧凑间距 | p-3 |
| `standard` | base + 标准间距 | p-4 |
| `spacious` | base + 宽松间距 | p-6 |

### 按钮（buttonStyles，7 变体 + 3 尺寸）

```typescript
import { buttonStyles } from '@/shared/styles'
// 用法：className={`${buttonStyles.base} ${buttonStyles.primary} ${buttonStyles.sizeMedium}`}
```

| 变体 | 外观 |
|------|------|
| `base` | 通用基础（flex 居中 + 圆角 + transition + disabled） |
| `primary` | 蓝底白字 |
| `secondary` | 浅灰底 + 边框 |
| `ghost` | 透明 + hover 灰底 |
| `danger` | 红底白字 |
| `success` | 绿底白字 |
| `link` | 文字链接样式（下划线） |

| 尺寸 | 规格 |
|------|------|
| `sizeSmall` | px-3 py-1.5 text-sm |
| `sizeMedium` | px-4 py-2 text-sm |
| `sizeLarge` | px-6 py-3 text-base |

### 徽章（badgeStyles，8 项）

```typescript
import { badgeStyles } from '@/shared/styles'
```

| 项 | 用途 |
|------|------|
| `base` | 通用基础（pill 形状 + text-xs + font-medium） |
| `default` | 中性灰 |
| `primary` | 蓝色 |
| `success` | 绿色 |
| `warning` | 橙色 |
| `danger` | 红色 |
| `outline` | 透明底 + 边框 |
| `dot` | 圆点指示器（w-2 h-2） |

### 表格（tableStyles，6 部分）

```typescript
import { tableStyles } from '@/shared/styles'
```

| 部分 | 样式 |
|------|------|
| `container` | 白底 + rounded-lg + 边框 + shadow-sm + overflow-hidden |
| `header` | neutral-50 背景 + 底边框 |
| `headerCell` | text-xs + font-semibold + uppercase + tracking-wider |
| `row` | 底边框 + hover 灰底 + transition |
| `cell` | text-sm + text-neutral-700 |
| `cellNumeric` | text-sm + **text-right** + font-numeric + tabular-nums |

### 吸顶表格（stickyTableStyles，4 部分）

```typescript
import { stickyTableStyles } from '@/shared/styles'
```

| 部分 | 功能 |
|------|------|
| `scrollFrame` | 滚动容器 + 圆角 + 半透明背景 |
| `header` | sticky top-0 z-20（吸顶表头） |
| `firstColumn` | sticky left-0（冻结首列） |
| `firstColumnHeader` | sticky left-0 top-0 z-30（首列表头交叉单元格） |

### 输入框（inputStyles，4 项）

```typescript
import { inputStyles } from '@/shared/styles'
```

| 项 | 状态 |
|------|------|
| `base` | 通用基础（w-full + rounded-lg + focus ring） |
| `default` | 正常状态 |
| `error` | 错误状态（红色边框 + focus ring） |
| `disabled` | 禁用状态（灰底 + cursor-not-allowed） |

### 切换按钮（toggleButtonStyles，2 状态）

```typescript
import { toggleButtonStyles } from '@/shared/styles'
```

| 状态 | 外观 |
|------|------|
| `active` | neutral-800 底 + 白字 |
| `inactive` | neutral-100 底 + neutral-600 字 + hover 加深 |

### 布局预设（layoutStyles，9 预设）

```typescript
import { layoutStyles } from '@/shared/styles'
```

| 预设 | 用途 |
|------|------|
| `container` | 居中容器（max-w-7xl + 响应式 px） |
| `flexCenter` | flex 居中 |
| `flexBetween` | flex 两端对齐 |
| `flexVertical` | flex 垂直排列 |
| `grid2` | 响应式 2 列网格 |
| `grid3` | 响应式 3 列网格 |
| `grid4` | 响应式 4 列网格 |
| `stack` | 垂直间距容器（space-y-4） |
| `row` | 水平间距容器（flex + gap-4） |

### 状态样式（stateStyles，4 项）

```typescript
import { stateStyles } from '@/shared/styles'
```

| 项 | 用途 |
|------|------|
| `loadingOverlay` | 加载中覆盖层（白色半透明 + 居中 + z-10） |
| `disabledMask` | 禁用遮罩（opacity-50 + pointer-events-none） |
| `errorBorder` | 错误边框（danger + ring-2） |
| `focusRing` | 聚焦环（ring-2 + primary-400 + offset-2） |

---

## 5. 图表规范

### 简洁原则

**禁止网格线** — 所有 ECharts 图表必须设置 `splitLine: { show: false }`，x/y 轴均不显示网格。美感第一，数据密度第二。

```typescript
// 所有图表必须包含的默认配置
const baseOption = {
  grid: { containLabel: true },
  xAxis: { splitLine: { show: false } },
  yAxis: { splitLine: { show: false } },
}
```

### 标签密度控制

图表中多个动态标签时，**禁止全量显示**，必须按优先级智能筛选：

| 优先级 | 标签类型 | 说明 |
|--------|----------|------|
| 1 | 最高值 / 最低值 | 极值必须标注 |
| 2 | 异常值 | 偏离均值 >= 2 sigma 或超阈值 |
| 3 | 均值 | 参考基准线 |
| 4 | 最新值 | 时间序列最右端 |
| 5 | 重要节点值 | 每月 1 日、季度首日等锚点 |

其余数据点不显示标签，由 tooltip 悬停提供精确数值。实现方式：通过 ECharts `label.formatter` 或 `series.data[i].label.show` 逐点控制。

### 年份色板

```typescript
import { getYearChartColor } from '@/shared/styles'
// getYearChartColor(2026) → '#3B82F6'
// 未注册年份 → 回退到 primary (#1890ff)
```

### 热力图色阶

```typescript
import { getHeatmapColor } from '@/shared/styles'
// 返回 Tailwind 类名（背景 + 文字色）
```

| 转化率 | 返回的类名 |
|--------|-----------|
| >= 15% | `bg-success-solid text-white` |
| >= 10% | `bg-success-border text-neutral-900 dark:text-neutral-100` |
| >= 7% | `bg-success-bg text-neutral-800 dark:text-neutral-100` |
| >= 4% | `bg-amber-bg text-neutral-800 dark:text-neutral-100` |
| >= 1% | `bg-danger-bg text-neutral-800 dark:text-neutral-100` |
| < 1% | `bg-danger-border text-neutral-800 dark:text-neutral-100` |

### 漏斗层级色

```typescript
import { funnelLevelColors } from '@/shared/styles'
// ['bg-primary-600', 'bg-primary-400', 'bg-success-light', 'bg-success']
```

### 阈值配置

```typescript
import { comprehensiveTheme } from '@/shared/styles'
```

| 指标 | 警戒值 | 字段 |
|------|--------|------|
| 保费进度 | 99% | `threshold.premiumProgressWarn` |
| 综合成本率 | 91% | `threshold.costRateWarn` |
| 赔付率 | 70% | `threshold.lossRateWarn` |
| 费用率 | 16% | `threshold.expenseRateWarn` |
| 费用预算 | 14% | `threshold.expenseBudget` |

---

## 6. 数值格式化

### 格式化规范

```typescript
import { formatCount, formatPremiumWan, formatPercent, formatCoefficient } from '@/shared/utils/formatters'
```

| 指标类型 | 函数 | 小数位 | 单位标注位置 | 示例输入 → 输出 |
|----------|------|--------|-------------|-----------------|
| 件数 | `formatCount` | 0 | 无 | `1234` → `"1,234"` |
| 均值 | `formatAverage` | 1 | 列头标注"(元)" | `1234.56` → `"1,234.6"` |
| 保费 | `formatPremiumWan` | 0 | 列头标注"(万元)" | `12345678` → `"1,235"` |
| 率值 | `formatPercent` | 1 | 列头标注"(%)" | `68.5` → `"68.5%"` |
| 自主系数 | `formatCoefficient` | 4 | 无 | `0.85234` → `"0.8523"` |
| 图表 Y 轴 | `formatChartValue` | 0 | 无（纯数字） | `12345678` → `"1235"` |
| 达成率 | `formatAchievementRate` | 1 | 无 | `1.115` → `"111.5%"` |
| 天数 | `formatDays` | 1 | 内含"天" | `30.5` → `"30.5天"` |
| 金额(2位) | `formatCurrency` | 2 | 按需 | `1234.5` → `"1,234.50"` |

**关键规则**：
- 表格中率值数字**不带** `%` 后缀，`%` 只出现在列头单位标注中，如"赔付率(%)"。此场景用 `value.toFixed(1)` 输出纯数字。`formatPercent` 返回带 `%` 的字符串（如 `"68.5%"`），适用于独立展示场景（tooltip、卡片、描述文本）
- 金额统一**万元取整**，千分位分隔符
- 所有格式化函数对 `null`/`undefined`/非有限数返回 `"-"`

### 全量函数清单（19 函数 + 1 常量）

**推荐函数（12 个）**

| 函数 | 用途 | 示例 |
|------|------|------|
| `formatCount(v)` | 件数（整数，千分位） | `1234` → `"1,234"` |
| `formatAverage(v)` | 均值（1 位小数，千分位） | `1234.56` → `"1,234.6"` |
| `formatPremiumWan(v)` | 保费（除以万，取整） | `12345678` → `"1,235"` |
| `formatDriverPremiumWan(v)` | 驾意险保费（万元，>=1 万 1 位小数，<1 万 2 位） | `15000` → `"1.5"`; `5000` → `"0.50"` |
| `formatWanDirect(v)` | 已是万元单位的保费（取整） | `1234.56` → `"1,235"` |
| `formatWanAdaptive(v)` | 已是万元单位（自适应小数） | `1.28` → `"1.3"`; `0.58` → `"0.58"` |
| `formatChartValue(v)` | 图表 Y 轴（万元，纯数字） | `12345678` → `"1235"` |
| `formatCoefficient(v)` | 自主系数（4 位小数） | `0.85234` → `"0.8523"` |
| `formatPercent(v, d?)` | 百分比（默认 1 位小数） | `68.5` → `"68.5%"` |
| `formatDays(v)` | 天数（1 位小数 + "天"） | `30.5` → `"30.5天"` |
| `formatAchievementRate(v, d?)` | 达成率（小数形式，1 位） | `1.115` → `"111.5%"` |
| `formatCurrency(v)` | 金额（2 位小数，千分位） | `1234.5` → `"1,234.50"` |

**业务字段专用（3 个）**

| 函数 | 用途 | 示例 |
|------|------|------|
| `formatSalesmanName(s)` | 业务员名称（提取中文，admin→"直接个代"） | `"210000461周鑫磊"` → `"周鑫磊"` |
| `formatTeamName(s)` | 团队名缩写（"XX 业务 N 部"→"XXN 部"） | `"天府业务二部"` → `"天府二部"` |
| `formatTrendDailyXAxis(s)` | 走势图日维度 X 轴日期 | `"2026-01-01"` → `"{startOfMonth\|1月1日}"` |

**图表配置常量（1 个）**：`TREND_DAILY_XAXIS_RICH` — 走势图日维度 ECharts rich 配置

**通用工具（1 个）**：`formatRate(v)` — 率值格式化（自动检测小数/百分比形式）

**已废弃（2 个）**：`formatPremium`（用 `formatPremiumWan`）/ `formatNumber`（用 `formatCount`）

**遗留兼容（1 个）**：`yAxisPremiumFormatter` = `formatChartValue` 别名

---

## 7. 做与不做

### 禁止（Don'ts）

| # | 禁止 | 正确做法 |
|---|------|----------|
| 1 | 硬编码 Tailwind 颜色类（`text-red-500`） | `colorClasses.text.danger` |
| 2 | 虚构 CSS 类名（`className="font-kpi text-xl"`） | `fontStyles.kpi` 或 `numericStyles.*` |
| 3 | 手写卡片/按钮长串 Tailwind | `cardStyles.*` / `buttonStyles.*` |
| 4 | 硬编码年份颜色 | `getYearChartColor(year)` |
| 5 | 硬编码趋势颜色判断 | `getTrendColorClass(value)` |
| 6 | KPI 数字使用任意字号 | `numericStyles.kpiPrimary` / `kpiSecondary` |
| 7 | 使用废弃的 `font-chart-number` / `font-tabular` | `font-numeric` / `fontStyles.numeric` |
| 8 | 率值数字后跟 `%`（如 `68.5%`） | `%` 只标注在列头单位中 |
| 9 | 率值保留 2+ 位小数（如 `68.52%`） | 统一 1 位小数（系数除外 4 位） |
| 10 | 金额用"元"显示大数 | 万元取整 + 千分位 |
| 11 | 图表使用网格线 | `splitLine: { show: false }` |
| 12 | 图表标签全量显示 | 智能筛选（极值 > 异常 > 均值 > 最新 > 锚点） |
| 13 | 浅色文字 + 浅色背景 | 背景与文字至少跨 3 级色阶 |
| 14 | 表格输出无排序 | 按主题指标从差到好排序 |

### 必须做（Do's）

| # | 规则 |
|---|------|
| 1 | 数字列必须**右对齐**（`tableStyles.cellNumeric` 或 `text-right`） |
| 2 | 数字列必须用**等宽字体**（`font-numeric tabular-nums`） |
| 3 | 语义色使用 `colorClasses.*`，不用原生 Tailwind 色 |
| 4 | 组件样式使用预设常量（`cardStyles` / `buttonStyles` 等） |
| 5 | Dark mode 语义色不加 `dark:` 前缀；中性色必须加 |
| 6 | 所有格式化使用 `formatters.ts` 中的函数，不手写 `.toFixed()` |

### 排序规范

**表格行排序**（必须排序，禁止无序输出）：

| 优先级 | 规则 | 示例 |
|--------|------|------|
| 1 | 按主题关联度最高的指标，**从差到好** | 赔付率分析 → 赔付率从高到低 |
| 2 | 无好坏标准的指标，**从小到大** | 保费规模从小到大 |
| 3 | 多维度时主题指标为第一排序键 | 成本分析 → 综合成本率降序为主 |

**表格列排序**：最左列 = 维度标签，紧接主题核心指标，最右为辅助指标。

**文字叙述**：多个机构被同时点名时，**表现最差排最前**。

---

## 8. Agent 快速参考

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
  formatSalesmanName, formatTeamName,
} from '@/shared/utils/formatters'
```

### 工具函数速查

| 函数 | 用途 | 示例 |
|------|------|------|
| `cn('a', cond && 'b')` | 合并 className | `cn(cardStyles.base, 'p-4')` |
| `conditionalStyle(bool, 'a', 'b')` | 条件样式 | true → `'a'`, false → `'b'` |
| `getTrendColorClass(value)` | 趋势色（涨绿跌红） | `5.2` → `'text-success'` |
| `getTrendColorClass(value, true)` | 反转趋势色（涨红跌绿，如赔付率） | `5.2` → `'text-danger'` |
| `getTrendDirection(value)` | 趋势方向 | `5.2` → `'up'`, `0` → `'flat'` |
| `getStatusColorClass('danger')` | 状态文字色 | → `'text-danger'` |
| `getStatusBgClass('success')` | 状态背景色 | → `'bg-success-bg'` |
| `getYearChartColor(2026)` | 年份图表色 | → `'#3B82F6'` |
| `getHeatmapColor(12.5)` | 热力图色阶 | → `'bg-success-border ...'` |

### 间距速查

| 令牌 | 值 | 常见用途 |
|------|------|---------|
| `xs` | 4px | 图标与文字间距 |
| `sm` | 8px | 紧凑元素间距 |
| `md` | 16px | 标准间距 |
| `lg` | 24px | 区块间距 |
| `xl` | 32px | 大区块间距 |

### 响应式断点

| 断点 | 宽度 | 用途 |
|------|------|------|
| `sm` | 640px | 手机 |
| `md` | 768px | 平板 |
| `lg` | 1024px | 桌面 |
| `xl` | 1280px | 大桌面 |
| `2xl` | 1536px | 超大屏 |

---

> **文件关系**：`DESIGN.md`（本文件）是 AI Agent 设计入口 → `src/shared/styles/index.ts` 是运行时唯一事实源 → `src/app/index.css` 是 CSS 变量定义 → `.claude/rules/design-tokens.md` 已废弃，由本文件替代。

