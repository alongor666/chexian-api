# 图表账本（/chart-ledger）视觉重做 · 专项文件夹

> 日期：2026-07-04 · 流程：ui-redesign skill（发现 → 备料 → Claude Design → 落地 → 复盘）
> 目标页：`http://localhost:5173/#/chart-ledger` · 源码：`src/features/chart-ledger/`

## 文件索引

| 文件 | 用途 | 状态 |
|------|------|------|
| [current-page.html](./current-page.html) | 当前页 standalone 忠实还原（真实 token + 样例数据），Claude Design 的起点 | ✅ 已备好 |
| [design-brief.md](./design-brief.md) | 设计简报——整段粘进 Claude Design | ✅ 已备好 |
| [acceptance.md](./acceptance.md) | 落地后确定性验收清单（PASS/FAIL） | 落地时逐勾 |
| `claude-design-export.html` | Claude Design 导出稿——**用户导出后放回这里** | ⬜ 待用户 |
| [retro.md](./retro.md) | Phase D 复盘（自进化输入） | ⬜ 落地后填 |
| assets/ | 截图/参考图（可选） | — |

## 用户操作指引（Phase B，只有你能做）

1. 浏览器打开 **https://claude.ai/design**（需 Pro/Max/Team/Enterprise 登录态）
2. 新建项目 → **上传 `current-page.html`** 作为起点
   -（可选，提高落地保真度：链接 GitHub 仓库让它读真实组件）
3. **整段粘贴 `design-brief.md` 全文**到 Chat 作为第一条消息
4. 打磨：组件级问题用**内联批注**（点哪改哪），结构级问题用 Chat（可要 2-3 个备选方向）
5. 满意后二选一交回：
   - **A（默认）**：导出 standalone HTML，命名 `claude-design-export.html` 放回本文件夹，然后告诉我"导出稿已放回"，我接手 Phase C 落地；
   - **B**：直接 **Handoff to Claude Code**，我按同一套设计系统纪律与 acceptance.md 落地。

## 备注

- 样例数据说明：current-page.html 中的数字是**领域合理的样例值**（机构名/客群/量纲均真实），生产页数字由 10 个真实查询驱动、随全局筛选联动——设计时把数字当占位即可，量纲与格式（1 位小数率值、万元千分位）是真实约束。
- 本文件夹可随 git 提交留档（前例 performance-analysis-20260603 / renewal-ppt-20260607 均已入库）；不想入库可加 .gitignore。
- 应用壳（侧边栏 + 全局筛选条）不在重做范围，current-page.html 顶部灰条仅为占位说明。
