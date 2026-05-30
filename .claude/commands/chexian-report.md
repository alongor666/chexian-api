---
name: chexian-report
description: 报告命令总路由 — 按周期类型（weekly/monthly/custom）路由到对应子命令，并显式定死与全局 skill diagnose-org-weekly 的分工边界
category: reporting
version: 1.0.0
author: "@claude"
tags: [report, router, weekly, monthly, custom, weekly-report, diagnose-org-weekly]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - .claude/commands/chexian-report-weekly.md
  - .claude/commands/chexian-report-monthly.md
  - .claude/commands/chexian-report-custom.md
last_updated: "2026-05-30"
---

# 报告命令总路由（/chexian-report）

> 先分流，再执行。报告命令不得平铺混用；周期类型决定子命令；"周报"歧义必须先按下方「重叠处理」章节裁决，再执行。

---

## 固定路由顺序（RED LINE）

按以下顺序判断，命中后立即转交对应命令：

| 优先级 | 用户问题信号 | 使用命令 | 边界 |
|---|---|---|---|
| 0 | "机构经营诊断周报"、"跑一份 X 的周报"（含机构名）、"10 板块"、"SPA 下钻"、"三级机构"、"经营复盘" | 全局 `diagnose-org-weekly` | 机构经营诊断，Python + DuckDB 生成 780KB 单文件 HTML，不在本项目命令体系内 |
| 1 | "周报"（不含机构名）、"本周数据"、"董事会周报"、"业务周报"、"KPI 周报" | `/chexian-report-weekly` | 业务型周报，14 章 Markdown，含业务员四象限 + 赔付率亮灯 |
| 2 | "月报"、"本月"、"月度报告"、"同比月"、"--month" | `/chexian-report-monthly` | 自然月口径，同比环比 |
| 3 | 自定义起止日期、"灵活时间"、"--start / --end"、跨月、季度、半年 | `/chexian-report-custom` | 任意时间范围 + 多维度 |

若同时命中多个信号，按优先级高者先执行；不确定时问用户"是董事会级业务周报，还是某个机构的经营诊断周报？"再路由。

---

## 重叠处理

### `/chexian-report-weekly` vs 全局 `diagnose-org-weekly`（最高优先级裁决）

这是本路由器最关键的分工边界，**必须在任何执行前先裁决**。

| 维度 | `/chexian-report-weekly` | 全局 `diagnose-org-weekly` |
|------|--------------------------|---------------------------|
| **受众** | 董事会 / 高管层 | 机构经营管理层 |
| **内容** | 全公司级业务洞察（KPI / 成本 / 趋势 / 业务员四象限 / 风险预警）| 单个三级机构经营诊断（10 板块 + 22 SPA 下钻子页）|
| **输出格式** | GitHub Flavored Markdown（14 章，约 5-20KB 文本）| 单文件 HTML（~780KB，内嵌 ECharts SPA）|
| **时间口径** | 自然周 / 任意范围 | 年度 YTD（参数 `--year`）|
| **数据源** | 本项目 `PolicyFact` 视图 + DuckDB via `server/src/sql/` | `~/.claude/skills/diagnose-org-weekly/` 独立 Python CLI |
| **生成入口** | `/chexian-report-weekly` 命令 | `python3 ~/.claude/skills/diagnose-org-weekly/cli.py --org "<机构>" --year 2026` |
| **产物路径** | 当前会话输出（Markdown 文本）| `/tmp/<机构>_<year>_经营诊断周报.html` |

**裁决规则**（按顺序匹配）：

1. 用户说"**X 机构**的周报"或含机构名 → 优先级 0，转 `diagnose-org-weekly`
2. 用户说"经营诊断"、"10 板块"、"SPA 下钻"、"三级机构复盘" → 优先级 0，转 `diagnose-org-weekly`
3. 用户说"跑一份 X 的周报"（X = 机构名，如"泸州"、"自贡"） → 优先级 0，转 `diagnose-org-weekly`
4. 用户说"**业务**周报"、"**董事会**周报"、"**KPI** 周报"、"本周数据" → 优先级 1，转 `/chexian-report-weekly`
5. 用户仅说"周报"（无其他上下文）→ **主动询问**："是全公司董事会级业务周报，还是某个机构的三级机构经营诊断周报？"

**禁止**：
- ❌ 用 `/chexian-report-weekly` 生成机构经营诊断（缺少 10 板块 / SPA 下钻 / 机构三维分析）
- ❌ 用 `diagnose-org-weekly` 生成董事会级全量业务周报（口径是单机构 YTD，无业务员四象限）
- ❌ 在歧义未解消前贸然执行任何一个

### `/chexian-report-weekly` vs `/chexian-report-monthly`

- 用自然周边界（`date_trunc('week', ...)`）或"本周"、"第 N 周" → `/chexian-report-weekly`
- 用自然月边界或"2025-12"、"--month" → `/chexian-report-monthly`
- `/chexian-report-weekly` 虽支持 `--period month` 参数，但新需求优先走专属的 `/chexian-report-monthly`（口径更精确）

### `/chexian-report-monthly` vs `/chexian-report-custom`

- 标准自然月 → `/chexian-report-monthly`
- 跨自然月（如 Q1/Q2/半年度）或需要非标维度（多机构 JOIN / 险类拆分）→ `/chexian-report-custom`

### `/chexian-report-custom` vs `/chexian-report-weekly`

- 用户提供明确 `--start / --end` 且跨多周 → `/chexian-report-custom`
- 用户提供 `--start / --end` 但等于一个自然周 → `/chexian-report-weekly`（语义更清晰）

---

## 执行协议

1. 用本路由裁决唯一子命令（或确认转 `diagnose-org-weekly`）。
2. 打开目标子命令文档，按其 pre-flight 和验证要求执行。
3. 对于 `diagnose-org-weekly`，使用其标准 CLI：
   ```bash
   python3 ~/.claude/skills/diagnose-org-weekly/cli.py --org "<机构名>" --year 2026
   ```
   产物在 `/tmp/<机构>_2026_经营诊断周报.html`，之后可用 `/chexian-push-wecom` 分发。
4. 对于 `/chexian-report-weekly`，可选参数：
   ```bash
   /chexian-report-weekly                            # 默认最近一周
   /chexian-report-weekly --period week --number 50  # 指定第 50 周
   /chexian-report-weekly --start 2026-05-01 --end 2026-05-07
   ```
5. 不确定时只问最少确认项（机构名 or 时间范围），不要一次性抛出多方案。

---

ARGUMENTS: {用户的自然语言报告需求，如"出一份本周的周报"或"跑一份泸州的周报"}
