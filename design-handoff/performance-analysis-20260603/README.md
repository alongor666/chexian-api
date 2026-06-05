# 业绩分析页 视觉重做 · 交接包

> 日期：2026-06-03
> 目标页：`https://chexian.cretvalu.com/#/performance-analysis`
> 项目：chexian-api（React 19 + TS + Vite + Tailwind 3.4 + ECharts 5）

## 这个文件夹是什么

按 `ui-redesign` skill 跑出的 **Phase A 备料**——把当前页"业绩分析"的现状、设计系统约束、必保交互、验收口子全部沉淀成可上传给 **Claude Design**（`claude.ai/design`）的材料。Claude Design 由你本人在浏览器操作，AI 无法代为驱动（egress 限制 + 登录态要求）。

## 文件清单

| 文件 | 作用 | 谁用 |
|------|------|------|
| `README.md` | 本文件——总索引 + 操作指引 | 你 |
| `current-page.html` | 当前业绩分析页的 **standalone 忠实还原**（Tailwind CDN + 真实业务样例数据） | 上传给 Claude Design 当起点 |
| `design-brief.md` | **设计简报**——粘进 Claude Design 的 Chat 框，告诉它要什么、不要什么 | 粘贴给 Claude Design |
| `acceptance.md` | **Phase C 落地后的确定性验收清单**——逐条 PASS/FAIL 不打折 | AI 落地完跑这个 |
| `retro.md` | **Phase D 复盘模板**——做完回写，沉淀进 skill 自进化 | 落地后 AI 填，你审 |
| `assets/` | 截图/参考图（按需放） | 可选 |

## 三步操作（你来做）

### Step 1 · 打开 Claude Design
浏览器访问 https://claude.ai/design（需 Pro/Max/Team/Enterprise 账号 + 登录态）。

### Step 2 · 上传当前页 + 粘贴简报
1. 把本文件夹的 `current-page.html` **上传**作为设计起点
2. 把 `design-brief.md` 的全部内容**粘贴进 Chat 框**作为第一条消息
3.（推荐）在 Claude Design 里链接代码仓库 + 勾选"继承组织设计系统"——它能直接读你项目里 `src/shared/styles/index.ts` 真实 token，落地保真度更高

### Step 3 · 设计 + 导出
- 内联批注：组件级精改（"这个 KPI 卡数字字号太小"）
- Chat 对话：结构级改 + 要 2-3 备选（"试两种热力图布局"）
- 旋钮：密度/圆角/阴影/字号微调
- 满意后选其一：
  - **A. 导出 standalone HTML** → 存回本文件夹，命名 `claude-design-export.html`，告诉 AI 走 Phase C 落地（**默认推荐**）
  - **B. Handoff to Claude Code** → 直接把设计交接给 Claude Code，AI 按本文件夹的 `acceptance.md` 落地

## Phase C / D 是 AI 做的

- **Phase C 落地**：AI 改 `src/features/pages/PerformanceAnalysisPage.tsx` + `src/features/dashboard/PerformanceAnalysisPanel.tsx` 等真实文件，严格用项目已有 `colorClasses.* / cardStyles.* / numericStyles.*` 常量（**禁止硬编码颜色**），保留 30+ 交互的每一项，跑 `acceptance.md` 全绿，走 `/chexian-commit-push-pr` 提 PR。
- **Phase D 复盘**：AI 填写 `retro.md`，把通用经验回写到 ui-redesign skill 仓库（自进化）。

## Git 处理

本文件夹**默认不需要进 git**——它是交接产物，留在磁盘便于重新上传/重做。如要存档：
```
echo "design-handoff/" >> .gitignore   # 推荐
# 或
git add design-handoff/performance-analysis-20260603/
```

## 当前页代码定位（落地阶段参考）

- 路由：`src/app/App.tsx:188-197`
- 顶层 Page：`src/features/pages/PerformanceAnalysisPage.tsx`（65 行）
- 主容器：`src/features/dashboard/PerformanceAnalysisPanel.tsx`（含 5 区块逻辑）
- 子组件：`src/features/dashboard/performance/PerformanceOrgHeatmapV2.tsx`、`src/features/dashboard/PerformanceTrendChart.tsx`、`src/shared/ui/DrilldownCell.tsx`
- API：`/api/query/performance-bundle`（聚合）+ summary/trend/drilldown/org-heatmap/top-salesman 五个分端点
- 设计系统 SSOT：`DESIGN.md` + `src/shared/styles/index.ts` + `src/app/index.css` + `tailwind.config.js`
