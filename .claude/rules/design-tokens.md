# 设计令牌规则（Design Tokens）

> 唯一事实源：`src/shared/styles/index.ts` + `tailwind.config.js` + `src/app/index.css`

## 字体系统

### 字体栈（font-family）

| 用途 | CSS 变量 / Tailwind 类 | 字体栈 |
|------|----------------------|--------|
| 正文（默认） | `font-sans` | -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif |
| KPI 大数字 | `.font-kpi` / `var(--font-kpi)` | "Avenir Next", Avenir, "Century Gothic", "SF Pro Display", ... |
| 数字（图表+表格统一） | `.font-numeric` / `var(--font-numeric)` | "SF Pro Text", "SF Pro Display", "Helvetica Neue", ... + `tabular-nums` |
| 代码/等宽 | `font-mono` | SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace |

> **已合并**：原 `font-chart-number` 和 `font-tabular` 字体栈完全相同，合并为统一的 `font-numeric`。

### 字号系统（font-size）

| 令牌 | 尺寸 | 行高 | 用途 |
|------|------|------|------|
| `text-xs` | 12px (0.75rem) | 1rem | 辅助信息、标签、表格注脚 |
| `text-sm` | 14px (0.875rem) | 1.25rem | **正文默认**、表格内容 |
| `text-base` | 16px (1rem) | 1.5rem | 标准正文 |
| `text-lg` | 18px (1.125rem) | 1.75rem | 小标题 |
| `text-xl` | 20px (1.25rem) | 1.75rem | 中标题 |
| `text-2xl` | 24px (1.5rem) | 2rem | KPI 数值、大标题 |
| `text-3xl` | 30px (1.875rem) | 2.25rem | 页面标题 |
| `text-4xl` | 36px (2.25rem) | 2.5rem | 大号标题（极少用） |

### 数字分层样式（numericStyles）

| 常量 | 类名 | 用途 |
|------|------|------|
| `numericStyles.kpiPrimary` | `font-kpi text-3xl tracking-tight font-bold leading-none` | KPI 主数字 (30px) |
| `numericStyles.kpiSecondary` | `font-kpi text-2xl tracking-tight font-bold leading-none` | KPI 次级数字 (24px) |
| `numericStyles.tableValue` | `font-tabular tabular-nums text-sm text-neutral-900` | 表格数字单元格 |
| `numericStyles.tableSecondary` | `font-tabular tabular-nums text-sm text-neutral-500` | 表格次要数字 |
| `numericStyles.captionValue` | `font-tabular tabular-nums text-xs` | 小号数字/统计 |

## 颜色系统

### 主色调

| 语义 | 色值 | Tailwind 类前缀 |
|------|------|-----------------|
| 主色 (Primary) | `#1890ff` | `primary` (50~900 共10级) |
| 成功 (Success) | `#52c41a` | `success` (DEFAULT/light/dark/bg/border) |
| 警告 (Warning) | `#faad14` | `warning` (DEFAULT/light/dark/bg/border) |
| 危险 (Danger) | `#ff4d4f` | `danger` (DEFAULT/light/dark/bg/border) |
| 中性 (Neutral) | `#8c8c8c` | `neutral` (50~900 共10级) |

### 语义化颜色（semanticColors）

| 语义 | 色值 | 用途 |
|------|------|------|
| info | `#3B82F6` (blue-500) | 信息/主要提示 |

> **已删除**：`positive`/`negative` 子色板（与 `colors.success/danger` 重复且从未使用）。统一用 `colorClasses.text.success/danger`。

### 图表年份颜色（semanticColors.chart）

| 年份 | 色值 |
|------|------|
| 2024 | `#FF6B6B` |
| 2025 | `#4ECDC4` |
| 2026 | `#95E1D3` |
| 2027 | `#F38181` |
| 2028 | `#AA96DA` |

使用：`getYearChartColor(year)` 函数，禁止硬编码。

### 综合分析专用色板（comprehensiveTheme.palette）

| 语义 | 色值 | 用途 |
|------|------|------|
| premium | `#0050B3` | 保费相关 |
| claim | `#C41D7F` | 赔付相关 |
| expense | `#FA8C16` | 费用相关 |
| cost | `#531DAB` | 成本相关 |
| roi | `#08979C` | 投资回报 |
| neutral | `#8C8C8C` | 中性/分割线 |
| success | `#389E0D` | 达标 |
| danger | `#CF1322` | 超标 |

### 报价转化专用色（quoteChartColors）

| 语义 | 色值 |
|------|------|
| 报价量柱 | `#94a3b8` (灰) |
| 承保量柱 | `#3b82f6` (蓝) |
| 转化率线 | `#10b981` (绿) |
| 续保转化率线 | `#3b82f6` (蓝) |
| 转保转化率线 | `#f59e0b` (琥珀) |

### colorClasses 语义映射（Tailwind 类名常量）

**文本颜色** (`colorClasses.text.*`)：
| 常量 | 用途 | 替代的硬编码 |
|------|------|-------------|
| `.danger` | 错误/负面 | ~~text-red-800~~ |
| `.success` | 成功/增长 | ~~text-green-600~~ |
| `.positive` | 正面增长率 | ~~text-emerald-600~~ |
| `.warning` | 警告 | ~~text-yellow-600~~ |
| `.primary` | 主色调 | ~~text-blue-600~~ |
| `.neutralBlack` | 主文本 | ~~text-gray-900~~ |
| `.neutral` | 次要文本 | ~~text-gray-600~~ |
| `.neutralMuted` | 辅助/标签 | ~~text-gray-400~~ |

**背景颜色** (`colorClasses.bg.*`)：
| 常量 | 用途 | 替代的硬编码 |
|------|------|-------------|
| `.danger` | 错误背景 | ~~bg-red-50~~ |
| `.success` | 成功背景 | ~~bg-green-50~~ |
| `.warning` | 警告背景 | ~~bg-yellow-50~~ |
| `.primary` | 主色背景 | ~~bg-blue-50~~ |
| `.neutral` | 中性背景 | ~~bg-gray-50~~ |

**边框颜色** (`colorClasses.border.*`)：同理 `.danger/.success/.warning/.primary/.neutral`

### 趋势色函数

```typescript
// 根据数值+指标方向返回颜色类名
getTrendColorClass(value, inverse?)       // value>0 绿, <0 红; inverse=true 反转
getTrendColorClassByPolarity(direction, polarity)  // 更精确的控制
getStatusColorClass('success'|'warning'|'danger'|'default'|'primary')
getStatusBgClass('success'|'warning'|'danger'|'default'|'primary')
```

### 热力图色阶（getHeatmapColor）

| 转化率 | 颜色 |
|--------|------|
| ≥15% | emerald-500 白字 |
| ≥10% | emerald-300 深字 |
| ≥7% | emerald-100 深字 |
| ≥4% | amber-100 深字 |
| ≥1% | red-100 深字 |
| <1% | red-200 深字 |

## 间距系统

| 令牌 | 值 |
|------|------|
| xs | 4px (0.25rem) |
| sm | 8px (0.5rem) |
| md | 16px (1rem) |
| lg | 24px (1.5rem) |
| xl | 32px (2rem) |
| 2xl | 48px (3rem) |
| 3xl | 64px (4rem) |

## 圆角系统

| 令牌 | 值 |
|------|------|
| sm | 2px |
| md | 6px |
| lg | 8px |
| xl | 12px |
| 2xl | 16px |
| full | 9999px |

## 阴影系统

| 令牌 | 用途 |
|------|------|
| `shadow-sm` | 轻微浮起 |
| `shadow-md` | 标准卡片 |
| `shadow-lg` | 弹出层 |
| `shadow-card` | 卡片专用（`0 2px 8px rgba(0,0,0,0.09)`） |
| `shadow-dropdown` | 下拉菜单专用 |

## 组件预设样式

### 卡片（cardStyles）
- `base`: 白底 + 圆角lg + neutral-200边框 + shadow-sm
- `interactive`: base + hover阴影
- `compact/standard/spacious`: base + p-3/p-4/p-6

### 按钮（buttonStyles）
- `primary`: 蓝底白字
- `secondary`: 浅灰底 + 边框
- `ghost`: 透明 + hover灰底
- `danger`: 红底白字
- 尺寸：`sizeSmall`(px-3 py-1.5) / `sizeMedium`(px-4 py-2) / `sizeLarge`(px-6 py-3)

### 徽章（badgeStyles）
- `base`: 圆角full + text-xs + font-medium
- 状态：`default/primary/success/warning/danger`

### 表格（tableStyles）
- `container`: 白底 + 圆角lg + 边框 + shadow-sm
- `header`: neutral-50背景 + 底边框
- `headerCell`: text-xs + font-semibold + uppercase
- `cell`: text-sm + text-neutral-700
- `cellNumeric`: 右对齐 + font-tabular

### 吸顶表格（stickyTableStyles）
- `scrollFrame`: 滚动容器 + 圆角 + 半透明背景
- `header`: sticky top-0 z-20
- `firstColumn`: sticky left-0（冻结首列）

### 文本预设（textStyles）
- `titleLarge`: text-2xl + font-bold
- `titleMedium`: text-lg + font-semibold
- `titleSmall`: text-base + font-medium
- `body`: text-sm + neutral-700
- `caption`: text-xs + neutral-500
- `numeric`: font-tabular + tabular-nums

### 切换按钮（toggleButtonStyles）
- `active`: neutral-800底 + 白字
- `inactive`: neutral-100底 + neutral-600字

## 响应式断点

| 断点 | 宽度 | 用途 |
|------|------|------|
| xs | 375px | 小屏手机 |
| sm | 640px | 手机 |
| md | 768px | 平板 |
| lg | 1024px | 桌面 |
| xl | 1280px | 大桌面 |
| 2xl | 1536px | 超大屏 |

## 动画

| 令牌 | 用途 |
|------|------|
| `transition.fast` | 0.15s ease-in-out |
| `transition.normal` | 0.2s ease-in-out |
| `transition.slow` | 0.3s ease-in-out |
| `animate-pulse-slow` | 3s 慢脉冲 |
| `animate-shimmer` | 2s 骨架屏闪烁 |

## 阈值配置（comprehensiveTheme.threshold）

| 指标 | 警戒值 |
|------|--------|
| 保费进度 | 99% |
| 综合成本率 | 91% |
| 赔付率 | 70% |
| 费用率 | 16% |
| 费用预算 | 14% |

## 数值格式化规范

### 率值指标（百分比类）

| 指标类型 | 小数位 | 单位标注 | 示例 |
|----------|--------|----------|------|
| 赔付率、费用率、出险率、达成率等 | **1 位小数** | `%` 作为单位标注在列头/标签中，不跟在数字后 | 列头 `赔付率(%)` 值 `68.5` |
| 自主定价系数 | **4 位小数** | 无单位 | `0.8523` |

### 绝对值指标

| 指标类型 | 单位 | 小数位 | 示例 |
|----------|------|--------|------|
| 保费、赔款、费用等金额 | **万元** | **取整（0 位小数）** | 列头 `保费(万元)` 值 `1,256` |
| 案均赔款、件均保费等均值 | **元** | **取整（0 位小数）** | 列头 `案均赔款(元)` 值 `8,432` |

### 格式化规则

- 率值：数字不带 `%` 后缀，`%` 只出现在列头/标签的单位标注中，如 `赔付率(%)`
- 金额：使用千分位分隔符（`1,256`），万元单位在列头/标签中标注
- 均值：使用千分位分隔符，元为单位在列头/标签中标注

## 图表规范

### 简洁原则

- ❌ **禁止网格线**（gridLine）— 所有 ECharts 图表 `splitLine.show: false`，x/y 轴均不显示网格
- 美感第一，数据密度第二
- 图表背景透明，无多余装饰元素
- 坐标轴线尽量简化（`axisLine.show: false` 或极细淡色）
- tooltip 提供精确数值，图表本身只传达趋势和对比

### 数据标签智能显示（label density control）

图表中多个动态标签时，**禁止全量显示**，必须智能筛选：

| 优先级 | 标签类型 | 说明 |
|--------|----------|------|
| 1 | 最高值 / 最低值 | 极值必须标注 |
| 2 | 异常值 | 偏离均值 ≥2σ 或超阈值的点 |
| 3 | 均值 | 参考基准线上的标注 |
| 4 | 最新值 | 时间序列的最右端点 |
| 5 | 重要节点值 | 每月1日、季度首日等时间锚点 |

其余数据点**不显示标签**，由 tooltip 悬停提供精确数值。

实现方式：通过 ECharts `label.formatter` 或 `series.data[i].label.show` 逐点控制，而非全局 `label.show: true`。

### ECharts 默认配置

```typescript
// 所有图表必须包含
grid: { containLabel: true },
xAxis: { splitLine: { show: false } },
yAxis: { splitLine: { show: false } },
```

## 排序规范

### 表格行排序（必须排序，禁止无序输出）

| 优先级 | 规则 | 示例 |
|--------|------|------|
| 1 | 按主题关联度最高的指标，**从差到好**排序 | 赔付率分析 → 赔付率从高到低；达成率分析 → 达成率从低到高 |
| 2 | 无好坏标准的指标，**从小到大**排序 | 保费规模 → 从小到大 |
| 3 | 多维度排序时，主题指标为第一排序键 | 成本分析 → 综合成本率降序为主，保费规模为辅 |

### 表格列排序（多指标并列时）

- 按指标与主题的关联度**从左到右**排列
- 最左列 = 维度标签（机构名/业务员名等），紧接着是主题核心指标，最右是辅助指标
- 示例：赔付率分析表 → `机构 | 赔付率 | 出险率 | 案均赔款 | 保费规模`

### 文字叙述排序

- 多个机构/业务员被同时点名（批评或表扬），**表现最差的排最前面**
- 示例：`乐山中支（赔付率 89.2%）、天府中支（85.1%）、遂宁中支（82.3%）赔付率偏高`

## 文字与背景对比度规范

- 有背景色的文字必须保证**足够的色彩差异度**，背景越深文字越亮，背景越浅文字越深
- 禁止浅色文字配浅色背景（如浅灰字 + 白底）、深色文字配深色背景（如深灰字 + 深蓝底）
- 标签/徽章/芯片：背景色与文字色至少跨 3 级色阶（如 `bg-red-50` + `text-red-700`，而非 `bg-red-100` + `text-red-300`）
- 表格高亮行/单元格：背景色要能明显区分于相邻行，文字颜色同步调整确保可读
- 图表中的数据标签（dataLabel）：若叠在柱体/区域上，必须用对比色或加描边/阴影确保可读

## 禁止事项

- ❌ 硬编码 Tailwind 颜色类（如 `text-red-500`、`bg-blue-600`）→ 用 `colorClasses.*`
- ❌ 使用虚构类名（如 `className="font-kpi text-xl"`）→ 用 `fontStyles.kpi` 或 `numericStyles.*`
- ❌ 手写卡片/按钮长串 Tailwind → 用 `cardStyles.*` / `buttonStyles.*`
- ❌ 硬编码年份颜色 → 用 `getYearChartColor(year)`
- ❌ 硬编码趋势颜色判断 → 用 `getTrendColorClass(value)`
- ❌ KPI 数字使用任意字号（`text-[Npx]`）→ 必须用 `numericStyles.kpiPrimary/kpiSecondary`
- ❌ 使用已废弃的 `font-chart-number` / `fontStyles.chart` → 用 `font-numeric` / `fontStyles.numeric`
- ❌ 率值数字后跟 `%` 符号（如 `68.5%`）→ `%` 只标注在列头/标签单位中，数字本身不带
- ❌ 率值保留 2+ 位小数（如 `68.52%`）→ 统一 1 位小数（`68.5`），自主系数除外（4 位）
- ❌ 金额用"元"为单位显示大数（如 `12,560,000`）→ 统一万元取整（`1,256`）
- ❌ 图表使用网格线（gridLine / splitLine）→ `splitLine: { show: false }`，简洁美感第一
