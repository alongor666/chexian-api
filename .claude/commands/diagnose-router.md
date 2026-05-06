---
name: diagnose-router
description: 诊断命令总路由 — 先判定业务域、时间口径和专属模型，再转交具体 diagnose 命令
category: data-analysis
version: 1.0.0
author: "@codex"
tags: [diagnosis, router, command-selection, cohort, renewal, motorcycle, fraud]
scope: project
requires:
  - 阅读目标 diagnose 命令
dependencies:
  - .claude/commands/diagnose-agent.md
  - .claude/commands/diagnose-segment.md
  - .claude/commands/diagnose-cohort-comparison.md
  - .claude/commands/diagnose-renewal.md
  - .claude/commands/diagnose-motorcycle.md
  - .claude/commands/diagnose-transfer-location.md
last_updated: "2026-05-06"
---

# 诊断命令总路由（/diagnose-router）

> 先分流，再执行。诊断命令不得平铺混用；专项命令优先，`/diagnose-agent` 只做经营诊断兜底。

---

## 固定路由顺序（RED LINE）

按以下顺序判断，命中后转交对应命令：

| 优先级 | 用户问题信号 | 使用命令 | 边界 |
|---|---|---|---|
| 1 | 续保、应续、已报价、续回、责任模式、报价提前、待跟进名单 | `/diagnose-renewal` | 续保 funnel 专属，不用经营诊断替代 |
| 1 | 摩托车、交强 120 元、人身险捆绑、A/B 类机构、真实盈亏线 | `/diagnose-motorcycle` | 摩托车必须用专属成本模型 |
| 1 | 过户车、车牌归属地、出险地、异地出险、挂靠/假资料 | `/diagnose-transfer-location` | 风控/欺诈专项，不是普通事故地点下钻 |
| 2 | 两个 cutoff、3-31 vs 4-30、月末估值对比、同比发展、影响度分解 | `/diagnose-cohort-comparison` | 双 cutoff cohort 专项 |
| 3 | 任意车型/客户类别/能源/吨位/WHERE 细分，90/180/270/满期发展 | `/diagnose-segment` | 细分 cohort 专项 |
| 4 | 机构、经代、经营单元、赚不赚、亏在哪、要不要继续 | `/diagnose-agent` | 总控型经营诊断兜底 |

若同时命中多个信号，按优先级高者先执行；需要组合分析时，先跑专项，再用经营诊断汇总，不得反向覆盖专项口径。

---

## 重叠处理

### `/diagnose-agent` vs `/diagnose-segment`

- 问“机构/经代/经营单元赚不赚、亏在哪、是否继续” → `/diagnose-agent`
- 问“某类车/某个 WHERE 细分 cohort 的赔付发展和事故原因” → `/diagnose-segment`

### `/diagnose-agent` vs `/diagnose-motorcycle`

- 只要出现“摩托车”且问题涉及经营/盈亏/赔付 → `/diagnose-motorcycle`
- `/diagnose-agent` 不得用普通车险综合成本率替代摩托车捆绑模型

### `/diagnose-segment` vs `/diagnose-cohort-comparison`

- 90/180/270/满期四桩发展 → `/diagnose-segment`
- 同一 policy-year cohort 在两个 cutoff 之间变化 → `/diagnose-cohort-comparison`

### `/diagnose-segment` vs `/diagnose-transfer-location`

- 普通事故地点/事故原因下钻 → `/diagnose-segment`
- 过户车 + 车牌归属地 vs 实际出险地异常 → `/diagnose-transfer-location`

---

## 执行协议

1. 先用本路由判断唯一主命令。
2. 打开目标命令文档，按目标命令的 pre-flight 和验证要求执行。
3. 若需要组合诊断，在最终报告中显式标明：
   - 主命令
   - 辅助命令
   - 各自口径
   - 哪个结论来自哪个命令
4. 不确定时只问最少确认项，不要一次性抛出多命令方案。

---

ARGUMENTS: {用户的自然语言诊断需求}
