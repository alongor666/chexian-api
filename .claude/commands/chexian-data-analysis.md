---
name: chexian-data-analysis
description: 车险数据分析总路由 — 先判定用户意图，再转交具体子命令；当用户要求"数据分析"而未指定维度时触发
category: data-analysis
version: 3.0.0
author: "@claude"
tags: [insurance, analysis, router, command-selection, kpi, trends, cost, flow]
scope: project
requires:
  - 阅读目标子命令
dependencies:
  - .claude/commands/chexian-data-kpi.md
  - .claude/commands/chexian-data-trends.md
  - .claude/commands/chexian-data-profile.md
  - .claude/commands/chexian-cost-analysis.md
  - .claude/commands/chexian-flow-analysis.md
last_updated: "2026-05-30"
---

# 车险数据分析总路由（/chexian-data-analysis）

> 先分流，再执行。数据分析命令不得平铺混用；专项子命令优先，组合分析时按"专项先行、汇总居后"顺序。

---

## 固定路由顺序（RED LINE）

按以下顺序判断用户意图，命中后转交对应子命令：

| 优先级 | 用户问题信号 | 使用命令 | 边界 |
|---|---|---|---|
| 1 | 赔付率、费用率、综合成本率、变动成本率、亏在哪 | `/chexian-cost-analysis` | 成本结构专项，含满期赔付 + 费用分拆；不用 kpi 替代 |
| 1 | 客户来源去向、过户流入、转保流失、业务员离司、NCD 流向 | `/chexian-flow-analysis` | 存量变动专项，不是趋势线分析 |
| 2 | 业绩排名、机构对比、业务员 Top30、四象限、人均产能 | `/chexian-data-kpi` | KPI/排名专项，不含时间趋势 |
| 2 | 月度/周度趋势、环比增长、异常检测、时间序列波动 | `/chexian-data-trends` | 时间趋势专项，不含业绩排名 |
| 3 | 数据概览、字段完整性、保费分布、记录数统计 | `/chexian-data-profile` | 概览与质量检查，分析前置步骤 |

若同时命中多个信号，按优先级高者先执行；需要组合分析时，先跑专项命令，再汇总结论，不得反向覆盖专项口径。

---

## 重叠处理

### `/chexian-cost-analysis` vs `/chexian-data-kpi`

- 问"这个机构赔付率多少、成本结构如何" → `/chexian-cost-analysis`
- 问"这个机构保费排第几、业务员产能如何" → `/chexian-data-kpi`
- 成本分析侧重**赔付与费用拆解**；KPI 侧重**规模与排名**；两者不互代

### `/chexian-flow-analysis` vs `/chexian-data-trends`

- 问"客户从哪来、续保流失了多少、新车来源结构" → `/chexian-flow-analysis`
- 问"月度保费趋势如何、环比上涨还是下滑" → `/chexian-data-trends`
- flow-analysis 关注**存量来源/去向截面**；trends 关注**时间轴变化曲线**

### `/chexian-data-kpi` vs `/chexian-data-trends`

- 问"当前谁排第一、哪个机构保费最多" → `/chexian-data-kpi`（快照排名）
- 问"过去 12 周/月保费如何变化、哪段异常" → `/chexian-data-trends`（时间变化）
- KPI 是**横截面排名**；trends 是**纵向时序**；问题同时涉及两者时，先跑 trends 再叠 kpi

### `/chexian-data-profile` vs 其他子命令

- `/chexian-data-profile` 是**前置质量检查**，不含业务分析；
- 若用户说"先看看数据情况"或"数据质量"→ profile 优先；
- 其余意图明确的分析直接转交对应专项

### 需组合分析时的执行顺序

```
1. [可选] /chexian-data-profile  →  确认数据质量无严重缺失
2. [专项] /chexian-cost-analysis 或 /chexian-flow-analysis（优先级 1 专项）
3. [专项] /chexian-data-kpi 或 /chexian-data-trends（优先级 2 专项）
4. [汇总] 在最终报告中标明：主命令 · 辅助命令 · 各自口径 · 结论归属
```

禁止将步骤 4 的汇总结论反向修改专项口径（专项口径由各子命令自身定义，路由器不覆盖）。

---

## 执行协议

1. 先用本路由判断唯一主命令。
2. 打开目标子命令文档，按子命令的数据源和验证要求执行。
3. 若需要组合诊断，按上方"执行顺序"逐步执行，在最终报告显式标明各命令及口径。
4. 不确定时只问最少确认项，不要一次性抛出多命令方案。

---

## 参考资料

- `server/src/sql/` — 50 个 SQL 模块：各子命令的实现层
- `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md` — 字段定义
- `数据管理/knowledge/rules/车险数据业务规则字典.md` — 业务口径唯一事实源
- `.claude/agents/business-intelligence.md` — BI 分析 Agent

---

ARGUMENTS: {用户的自然语言数据分析需求}
