# 续保 PPT 重做 · 交接包（renewal-ppt-20260607）

把现有「中国国家地理风」的续保诊断 16:9 演示稿，重做成**现代经营仪表盘风**（关键表转图表、全表降附录、~11 页）。

> 本文件夹可加入 `.gitignore`（设计中间料），但**文件请留在磁盘**以便随时重新上传 / 复盘。

## 文件清单

| 文件 | 用途 |
|---|---|
| `design-brief.md` | **粘进 Claude Design 的设计简报**（含视觉方向、~11 页结构、红线） |
| `current-page.html` | 当前 15 页全量 standalone 稿（内联全部 CSS/JS + 真实数据），作 Claude Design 起点 |
| `acceptance.md` | 落地后逐条确定性验收标准 |
| `assets/before-cover.png` | 改前封面参考图 |
| `retro.md` | Phase D 复盘（review 清零后填，喂自进化） |

## 你的操作（Phase B · Claude Design）

> Claude Design = `https://claude.ai/design`，是 Anthropic 独立网页产品，需 Pro/Max/Team/Enterprise 登录态，**只能你本人在浏览器操作**，我无法代驱动。

1. 打开 `https://claude.ai/design`。
2. **上传** 本文件夹的 `current-page.html`（作为重做起点，它已含全部真实数据与现有版式）。
3. 把 `design-brief.md` **整段粘进 Chat**。
4. 打磨：
   - **内联批注**：在某个组件上精改（如"这张机构条形图换成横向、按续保率排序、亮灯着色"）。
   - **Chat**：结构级改 / 要 2–3 个备选风格对比。
   - 旋钮调色板、字号、密度。
   - 盯紧简报 §4 红线：**数据零篡改、四级亮灯四档可辨、全中文、16:9 画幅与翻页**。
5. 交回（二选一）：
   - **A（默认）**：导出 standalone HTML → 命名 `claude-design-export.html` 存回**本文件夹** → 告诉我"导出好了"，我做 Phase C 落地 + 验收。
   - **B**：Handoff to Claude Code 直接交接，我按简报红线落地。

## 之后（我来做 · Phase C/D）

- 对照导出稿落地为最终 16:9 deck（沿用 `deck-16x9.js` 翻页机制），跑 `driver.mjs` 验收到全 PASS，逐条核 `acceptance.md`。
- 导出 16:9 PDF，放回 `数据管理/数据分析报告/续保PPT_2026年06月/`。
- 填 `retro.md` 复盘：简报哪段 Claude Design 没理解、下次该补什么 context。

## 备选：不走 Claude Design

如果你不想走 `claude.ai/design` 手动闭环，直接说一声——我可以**按本简报方向直接迭代** `续保分公司视角_2026年06月.html` 的设计（自己出 2–3 版仪表盘风让你选），省掉上传/导出。两条路产物一致，只是出图主体不同。
