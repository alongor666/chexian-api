---
name: 率值指标禁止加权平均
description: 所有率值指标（赔付率/出险率/费用率等）必须基于绝对值聚合重算，禁止加权平均
type: feedback
---

任何率值指标（赔付率、出险率、费用率、变动成本率、边际贡献率等）在跨维度/跨年度汇总时，**必须基于分子分母绝对值的聚合重算**，绝对不能用加权平均。

**正确**：`汇总出险率 = SUM(赔案保单数) / SUM(保单数) × 100`
**错误**：`汇总出险率 = SUM(各维度出险率 × 各维度保单数) / SUM(保单数)`

**Why:** 加权平均会引入已经过非线性变换（如年化因子）的中间值，导致汇总结果与直接从原始数据聚合的结果不一致。率值指标的本质是比率，汇总时必须回到分子分母。

**How to apply:**
- `diagnose_common.py:sum_kpi_dicts()` — 所有率值从绝对值重算
- 任何新增的汇总函数 — 同一原则
- SQL 层面已正确（`kpi_select()` 直接 SUM/COUNT 聚合）
- 涉及的率指标：loss_ratio, expense_ratio, incident_rate, 以及从它们派生的 earned_margin, projected_margin
