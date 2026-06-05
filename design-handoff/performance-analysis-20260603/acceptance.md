# Phase C 落地确定性验收清单 · 业绩分析页

> Phase C 落地完成 = **以下所有项目机器可核 + 全绿**。任何一项 FAIL 不算完成。

---

## A. 构建 · 类型 · 治理（零容忍）

| # | 检查项 | 命令 | 通过条件 |
|---|--------|------|----------|
| A1 | Vite 构建零错 | `bun run build` | 退出码 0，无 TS error |
| A2 | TypeScript 严格 | `bun run typecheck` | 退出码 0 |
| A3 | 26 项治理 | `bun run governance` | 退出码 0（含 DC-002 / DC-003 / 字段注册表 / TS 护栏 / 任务 ID 范围） |
| A4 | 单元测试 | `bun run test` | 全绿（涉及业绩分析的 hook 测试不能退化） |
| A5 | E2E（如改了关键交互） | `bun run test:e2e` | 全绿 |

---

## B. 设计系统纪律（零硬编码 RED LINE）

逐条 `grep` 检查改动文件（PR diff），命中数必须 = 0：

| # | 禁止模式 | grep 命令（在 PR diff 文件集运行） |
|---|---------|------------------------------------|
| B1 | 裸 Tailwind 颜色类 | `grep -nE '\b(text\|bg\|border)-(red\|green\|blue\|yellow\|orange\|purple\|pink\|gray\|slate\|zinc)-[0-9]+\b' <files>` → 0 |
| B2 | 裸 hex 色值 | `grep -nE '#[0-9a-fA-F]{3,8}\b' <files>` → 0（除 ECharts option，且 option 必须从 `comprehensiveTheme / quoteChartColors / getYearChartColor` 取） |
| B3 | 虚构类名 `font-kpi text-xl` 等 | `grep -nE 'className=["\'][^"\']*font-kpi[^"\']*text-' <files>` → 0（必须用 `fontStyles.kpi` 或 `numericStyles.kpiPrimary/kpiSecondary`） |
| B4 | 手写硬编码长串卡片样式 | `grep -nE 'className=["\']bg-white[^"\']*rounded-lg[^"\']*border[^"\']*shadow' <files>` → 0（必须 `cardStyles.base/standard/spacious/compact/interactive`） |
| B5 | 硬编码格式化 | `grep -nE '/\s*10000\s*\)?\.toFixed' <files>` → 0（必须 `formatPremiumWan`） |
| B6 | 率值带 `%` 后缀 | `grep -nE '\.toFixed\(1\)\s*\+\s*["\']%' <files>` → 0（表格列头才放 `(%)`） |
| B7 | 图表带 `splitLine: { show: true }` | `grep -nE 'splitLine:\s*\{\s*show:\s*true' <files>` → 0 |
| B8 | 装饰性 emoji | 改动文件中除 🟢🔵🟡🔴 外的 emoji = 0 |

---

## C. 交互保留（30+ 条 · Phase 0 基线）

逐条勾选——任何"为了视觉好看"砍掉的交互 = FAIL：

### C.1 头部
- [ ] 客户类别下拉 6 选项可切换（全部 / 非营客 / 营客 / 营货 / 非营货 / 摩托）
- [ ] 重置按钮触发 `actions.onReset()`
- [ ] 高级筛选按钮打开 `PageFilterPanel` 侧栏，徽章显示活跃筛选数

### C.2 热力图区块
- [ ] 时间粒度 5-Tab（日/周/月/季/年）切换刷新热力图 + 趋势 + 下钻
- [ ] 增长口径 2-Tab（环比/同比）切换重算列
- [ ] 维度 8-Tab（三级机构/团队/业务员/客户类别/险别/能源/新续转/风险评分）切换重分组
- [ ] 热力图**行点击**弹出"选择下钻维度"弹层
- [ ] 下钻路径**面包屑**显示 + 点击回溯
- [ ] 热力图**单元格点击**高亮 + 右侧 HeatmapFocusPanel 抽出详情

### C.3 业绩概览
- [ ] 展开维度 4-Tab（不展开/油电/新转续/油电+新转续）
- [ ] 行展开/折叠 ▸/▾ 箭头（仅 expandDims ≠ none 且有子行）
- [ ] 子行背景 `bg-neutral-50/40` + 缩进

### C.4 趋势分析
- [ ] 保费走势 + 件数走势 双折线图按 timePeriod 粒度
- [ ] 多年对照年份色用 `getYearChartColor(year)`
- [ ] 智能标签筛选（极值/异常/均值/最新值/时间锚点）非全量
- [ ] `splitLine: { show: false }` + `containLabel: true`

### C.5 下钻分析
- [ ] 维度选择按钮弹 DimensionPicker
- [ ] 6 个列头（维度/保费/计划/件数/达成率/增长率）可排序，升降序切换，null 排最后
- [ ] 维度名右侧 `▼` DrilldownCell 弹下钻菜单
- [ ] "重置分析" 按钮仅在已下钻时显示
- [ ] 四象限分布图（X=达成率 / Y=增长率 / 气泡=件数 / 4 象限着色）

### C.6 Top20
- [ ] 列头可排序，默认达成率升序（最差排最前）

---

## D. 数值与排版铁律

| # | 检查 | 通过条件 |
|---|------|----------|
| D1 | 率值小数位 | 表格单元格所有率值 = 1 位小数 |
| D2 | 系数小数位 | 自主定价系数 = 4 位小数 |
| D3 | 金额格式 | 万元单位在列头，数字千分位整数（如 `1,256`） |
| D4 | 件数格式 | 整数 + 千分位 |
| D5 | 空值显示 | 统一 `-`，不显示 `null` / `undefined` / `NaN` |
| D6 | 数字单元格 | 右对齐 + `font-numeric tabular-nums` |
| D7 | 表格排序方向 | 达成率升序（最差排最前）/ 赔付率降序（最差排最前） |
| D8 | KPI 数字字号 | ≥ 24px（`numericStyles.kpiSecondary` 或更大） |

---

## E. Dark Mode 双模式

| # | 检查 | 命令/方法 |
|---|------|-----------|
| E1 | Dark mode 可切换 | DevTools 控制台 `document.documentElement.classList.toggle('dark')` |
| E2 | 中性色有 `dark:` 前缀 | 在改动文件 grep `text-neutral-[0-9]+(?!\s+dark:)`、`bg-white(?!\s+dark:)`，命中要求都带 dark: 配对 |
| E3 | Surface 层级 | 卡片用 `dark:bg-surface-1`，嵌套用 `dark:bg-surface-2`，hover 用 `dark:bg-surface-3` |
| E4 | 深色无阴影 | dark 模式下卡片视觉无 `box-shadow`（已被 `html.dark .shadow-sm { box-shadow: none }` 覆盖） |
| E5 | 文字对比度 | 主文本 `dark:text-neutral-100`，次要文本 `dark:text-neutral-300`，最浅 `dark:text-neutral-400`，逐项检查可读 |
| E6 | 热力图色阶 | dark 模式下 `getHeatmapColor()` 6 档色阶可读（半透明 + 高对比文字） |

---

## F. 数据通（运行时）

| # | 检查 | 命令 |
|---|------|------|
| F1 | 启动 dev server | `bun run dev:full`（必须 dev:full 不是 dev） |
| F2 | 业绩分析页路由 200 | `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/#/performance-analysis` |
| F3 | 聚合 API 非空 | `curl -s 'http://localhost:3000/api/query/performance-bundle?...' \| jq '.summary.rows \| length' > 0` |
| F4 | 5 子 API 都 200 | summary / trend / drilldown / org-heatmap / top-salesman 任一 GET 返回 200 + 非空 JSON |
| F5 | 浏览器控制台 | 0 error 0 warn（除已知第三方 deprecation） |

---

## G. 视觉对齐（与已批准 Claude Design 导出稿）

把 `claude-design-export.html` 与落地后页面（dev server 截图）并排，逐区块核：

| 区块 | 关键对齐点 |
|------|-----------|
| 头部 | 客户类别下拉位置、重置 + 高级筛选按钮顺序与样式 |
| 热力图 | 3 组 Tab 布局（时间/增长/维度）、面包屑、行高、色阶映射 |
| 业绩概览 | 展开 Tab、表头层级、展开箭头位置、子行缩进/背景 |
| 趋势 | 双图布局、Y 轴格式、年份色映射 |
| 下钻 | 维度选择按钮位置、四象限图配色、表格列头排序图标、DrilldownCell ▼ 位置 |
| Top20 | 与下钻表格视觉一致性 |

允许导出稿与落地有差异的情形：
- 真实数据列数 > 导出稿示例列数 → 落地按真实结构
- 真实 API 返回缺少某字段 → 落地显示 `-`，不能伪造

---

## H. 提交

| # | 检查 | 通过条件 |
|---|------|----------|
| H1 | 走 `/chexian-commit-push-pr` | 提交流程含 governance + 冲突检测 + codex review |
| H2 | PR 描述含本文件清单的 PASS 截图或证据 | 至少 A1-A5、B1-B8、C 全勾、D 全勾、E1-E6、F1-F5 |
| H3 | Worktree 干净 | `git status` 无遗留临时文件 |
| H4 | design-handoff 目录处理 | 已加 `.gitignore` 或显式 `git add` 入档（README 已说明） |
