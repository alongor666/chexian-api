# 新会话交接 · 业绩分析页设计延后任务

> **怎么用**：复制下面 `## 💬 给新会话粘贴的 prompt` 整段到主目录新开的 Claude Code 会话。
> 它会自动拉起 worktree、读完所有上下文、按顺序推进 4 项延后任务。

---

## 📋 背景速览（人类视角，新会话不必读）

**已完成**（在 main 中）：
- ✅ PR #477 `0ae8e586` — FocusStrip 今日焦点条（4 块 anomaly-first KPI）+ governance #25 Bundle 路由开关合规闸 + `performancePlanDenominator.ts` + 10 单测
- ✅ PR #478 `94c7de20` — FocusStrip 万元口径修复 + 99% 阈值守门
- ✅ 共 5 轮 codex review、5 条 P2 全部 0 残留
- ✅ Phase D 复盘已写入 `design-handoff/performance-analysis-20260603/retro.md`
- ✅ Crystallize：6 条通用经验已回写 ui-redesign skill 仓库（commit `9c2333c`）

**延后未做**（本次新会话的目标）：
1. 🟡 热力图 8 维度 Tab → 2 组分段控件（组织/业务）
2. 🟡 下钻深度徽章（"下钻 N 层" chip）
3. 🟡 HeatmapFocusPanel 改 slide-in 抽屉
4. 🟡 趋势图 ECharts SVG renderer + 智能标签（峰值/最新）

涉及 `PerformanceAnalysisPanel.tsx`（1347 行核心容器）+ `PerformanceTrendChart.tsx` + `PerformanceOrgHeatmapV2.tsx`/`HeatmapFocusPanel.tsx`，回归面比 PR #477/#478 大很多 — 建议**拆 2-3 个独立 PR**。

---

## 💬 给新会话粘贴的 prompt

```
你正在接手 chexian-api 项目业绩分析页（/#/performance-analysis）的视觉重做后续任务。前一会话已完成 PR #477 + #478 并 merged 到 main，本次继续推进 4 项延后改造。

## 强制启动流程

1. **进主目录看 PR 历史**：
   ```
   cd /Users/alongor666/Downloads/底层数据湖DUD/chexian-api
   git fetch && git pull --rebase
   gh pr view 477 --json title,mergeCommit | jq
   gh pr view 478 --json title,mergeCommit | jq
   ```

2. **开新 worktree**（项目铁律 §A worktree-setup.md — 主目录只读、按任务建独立 worktree）：
   ```
   git worktree add -b claude/perf-analysis-followup ../chexian-api-perf-followup origin/main
   cd ../chexian-api-perf-followup
   bun install --cwd $(pwd)
   bun install --cwd $(pwd)/server
   ```

3. **必读 3 份文档**（按顺序）：
   - **`design-handoff/performance-analysis-20260603/retro.md`** — 前一会话踩坑总结，特别是 §5 "下一次重做时要带的经验包"
   - **`design-handoff/performance-analysis-20260603/claude-design-export.html`** — Claude Design 原始设计交付（本次延后 4 项的视觉来源）
   - **`design-handoff/performance-analysis-20260603/claude-design-chat1.md`** — 设计师对话记录（key 决策推理）

   ⚠️ 不要从头开始 explore — retro.md 里有完整的"已发现 / 已踩坑 / 已修"清单。

4. **遵守 ui-redesign skill 的 Phase D-pre**：每条 codex review 意见走 5 步 SOP（抽 pattern / 全仓 grep / 修 / 加静态闸 / 复盘评论），具体见 `~/.claude/skills/ui-redesign/references/acceptance-criteria.md` §7。

## 4 项延后任务（按建议优先级）

### 任务 1 [低风险]：趋势图 ECharts SVG renderer + 智能标签
**源**：claude-design-export.html line 683-688 `echarts.init(..., { renderer: 'svg' })` + line 654-655 智能标签（峰值/最新值）

**做什么**：
- `src/features/dashboard/PerformanceTrendChart.tsx` 改 `echarts.init` 加 `{ renderer: 'svg' }`
- ECharts option 的 series 配置加 `markPoint`（仅峰值 1 个点）+ `endLabel`（仅最新值）
- 移除全量数据 label（如有）

**涉及文件**：`PerformanceTrendChart.tsx`（独立组件，估 ~300 行）

**验收要点**：
- 设计系统：year 色用 `getYearChartColor(year)` 不硬编码
- `splitLine: { show: false }` 保留（governance #17 ECharts splitLine 强制）
- puppeteer 截图对比

**建议**：独立 PR，低风险。

---

### 任务 2 [中风险]：热力图 8 维度 Tab → 2 组分段控件
**源**：claude-design-export.html line 193-212 分组分段控件（组织：三级机构/团队/业务员 · 业务：客户类别/险别/能源/新续转/风险评分）

**做什么**：
- 在 `PerformanceAnalysisPanel.tsx`（line 635-645 维度数组）的渲染处把 8 个平铺 Tab 改为 2 组 `inline-flex rounded-md bg-neutral-100 p-0.5` 分段控件
- 用 toggleButtonStyles 的 active/inactive 已有样式
- 保留全部 8 个维度 + 切换交互不变

**涉及文件**：`PerformanceAnalysisPanel.tsx`（修改 ~60 行）

**验收要点**：
- 8 个维度 Tab 全部可切换（不丢功能）
- dark mode 双轨（语义色自动 + 中性色 `dark:` 前缀）
- 移动端响应式（< md 退回单列）

**建议**：可与任务 3 合一个 PR（都改 Panel）。

---

### 任务 3 [中风险]：下钻深度徽章
**源**：claude-design-export.html line 215-216 `下钻 N 层` chip 在面包屑前

**做什么**：
- 在 `PerformanceAnalysisPanel.tsx` 面包屑渲染处（搜 `breadcrumb` 或 `drillPath`，约 line 928）加一个 chip：
  ```tsx
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary-bg text-primary-dark font-medium">
    下钻 <span className="font-numeric">{drillPath.length}</span> 层
  </span>
  ```
- chip 显隐：`drillPath.length > 0` 才显示

**涉及文件**：`PerformanceAnalysisPanel.tsx`（修改 ~10 行）

**建议**：可与任务 2 合并 PR。

---

### 任务 4 [高风险]：HeatmapFocusPanel slide-in 抽屉
**源**：claude-design-export.html line 242-248 `focus-panel` `translate-x-full opacity-0 pointer-events-none` 由 hover/click 触发 slide-in；line 501-525 单元格点击逻辑

**做什么**：
- 现有 `HeatmapFocusPanel`（找到组件位置：`grep -rn HeatmapFocusPanel src/`）是其他形态
- 改成右侧 slide-in 抽屉，含：当前周期/维度/值 + 当期保费/计划/件数/达成率/同比 + "下钻该XX →" 按钮
- 触发：热力图单元格点击 → 抽屉滑入；外部点击关闭；ESC 关闭

**涉及文件**：`PerformanceOrgHeatmapV2.tsx` + `HeatmapFocusPanel.tsx`（如已有）

**验收要点**：
- 单元格点击 + 高亮（`ring-2 ring-primary`）保留
- 键盘可达（ESC 关闭）
- 主面板不被覆盖（z-index 控制）

**建议**：独立 PR，高风险，最后做。

## 提交流程（项目强制）

每个 PR 都走：
```
/chexian-commit-push-pr
```
它会：
- `bun run scripts/check-write-conflict.mjs`（5 项前置检查）
- `bun run governance`（24 项治理，含 #25 Bundle 路由开关合规闸 — 不要碰）
- commit / push / gh pr create

## 红线（来自 retro.md + 前一会话踩坑）

1. **零硬编码颜色** — 严格用 `colorClasses.text.* / cardStyles.* / numericStyles.*`
2. **格式化函数单位审计** — `formatPercent(已百分比)` vs `formatAchievementRate(0-1 小数)`；`formatPremiumWan(元)` vs `formatWanAdaptive(万元)`。错一个就是又一轮 codex P2
3. **bundle 调用必须遵守 `ENABLE_BUNDLE_ROUTES`** — governance #25 会拦
4. **业务公式必须有 SSOT 镜像** — 如复制 `getPlanDenominator` 到前端必须加单测（参考 `src/features/dashboard/utils/performancePlanDenominator.ts`）
5. **大容器不动内部** — 任务 1/2/3 的 Panel 改动尽量浅层，不要 refactor 内部状态机
6. **codex 5 轮迭代是常态** — 心理预期：每 PR 预留 3-5 轮 review，每轮 5 步 SOP 处置

## 完成标志

- 4 项任务全部 merged
- 每个 PR 都跑过 5 步 SOP（review 闭环）
- 在 retro.md 加一节"延后任务完成情况"+ 新发现的通用经验
- 如有 ≥2 次重复问题 → 立即 crystallize 到 ui-redesign skill 仓库

开始吧。第一步：cd 主目录 + fetch + 看 PR #477/#478 history。
```

---

## 📎 引用资源（新会话会用到）

- 本次会话的完整 retro.md：`design-handoff/performance-analysis-20260603/retro.md`
- Claude Design 原始交付：`design-handoff/performance-analysis-20260603/claude-design-export.html`（763 行）
- 设计师 chat：`design-handoff/performance-analysis-20260603/claude-design-chat1.md`
- ui-redesign skill 最新版（含本次回写的 6 条经验）：`~/.claude/skills/ui-redesign/`
- 本次工作 worktree（可清理）：`.claude/worktrees/hopeful-hellman-7269ef`

## ⚠️ 清理本会话遗留

新会话开始前，建议在主目录跑：

```bash
cd /Users/alongor666/Downloads/底层数据湖DUD/chexian-api
git fetch
git worktree list                                          # 看所有 worktree
# 若 cleanup-worktrees skill 可用：
/cleanup-worktrees
# 或手动：
git worktree remove .claude/worktrees/hopeful-hellman-7269ef
git branch -D claude/hopeful-hellman-7269ef claude/fix-focus-strip-wan-format 2>/dev/null
```
