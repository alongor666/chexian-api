---
name: chexian-cost-analysis
description: 成本分析深度审计（满期赔付率/费用率/综合成本率/变动成本率）— 口径以 server/src/sql/cost/cost-ratios.ts 为唯一事实源
category: data-analysis
version: 2.0.0
author: "@claude"
tags: [cost, profitability, claims, expense]
scope: project
requires:
  - DuckDB
dependencies:
  - server/src/sql/cost.ts
  - server/src/sql/cost/cost-ratios.ts
  - src/features/cost/
last_updated: "2026-06-09"
---

# /chexian-cost-analysis

成本分析深度审计，涵盖满期赔付率、费用率、综合成本率、变动成本率四大核心指标。

## 使用方法

```bash
/chexian-cost-analysis                       # 完整成本分析（推荐）
/chexian-cost-analysis --claim-ratio         # 仅满期赔付率
/chexian-cost-analysis --expense-ratio       # 仅费用率
/chexian-cost-analysis --dimension 机构      # 指定维度（机构/客户类别/险别组合）
/chexian-cost-analysis --cutoff-date "2026-01-15"
```

## 口径（RED LINE）

**唯一事实源**：`server/src/sql/cost/cost-ratios.ts`（赔款 CTE 与满期口径）+ `server/src/config/metric-registry/`（指标公式）。**禁止在本命令内重写 SQL 公式**——执行前先读这两处，照实现层口径取数。

| 指标 | 定义 |
|------|------|
| 满期赔付率 | 已报告赔款（已决 + 未决）÷ 满期保费 |
| 费用率 | 费用金额 ÷ 签单保费 |
| 变动成本率 | 满期赔付率 + 费用率（**默认只看此项**，不主动算综合成本率，见 memory `feedback_default_variable_cost_only`） |
| 边际贡献率 | 1 − 变动成本率 |

**铁律**：
- 率值聚合永远 SUM(分子)/SUM(分母)，禁止对率值加权平均或二次汇总
- 满期保费公式须闰年感知（实现层已处理，禁止手写 `MIN(天数,365)/365` 近似式）
- 未决金额优先用 `reserve_amount`（memory `feedback_pending_vs_reserve_amount`）

## 执行协议

1. **取数**（二选一）：
   - API：`curl -s "localhost:3000/api/query/cost-ratios?..."`（路由见 `server/src/routes/query/`）
   - Parquet 直查：`duckdb -c "... FROM '数据管理/warehouse/fact/policy/current/*.parquet'"`，SQL 从 `cost/cost-ratios.ts` 的生成逻辑改写，字段名查 `server/src/config/field-registry/fields.json`
2. **分维度对比**：机构 / 客户类别（11 类）/ 险别组合（主全/交三/单交），每维度输出 满期保费、满期赔付率、费用率、变动成本率
3. **亮灯**：按四级亮灯体系 🟢🔵🟡🔴（阈值查 metric-registry display 配置，不要凭记忆写死）
4. **验证**：修改 SQL 后必须 Parquet 直查与 API 返回对比（CLAUDE.md §0 源数据验证红线）

## 输出骨架

结论先行：整体变动成本率 + 最差/最好维度切片 + 超阈值清单（文件:数值），随后分维度明细表（率值 1 位小数、金额万元整数，左对齐文本/右对齐数值）。

## 常见问题

- **满期保费怎么算？** 以实现层 `cost-ratios.ts` 为准（闰年感知），禁止口算近似
- **如何判断盈利？** 变动成本率 < 100% 为有边际贡献；精确盈亏需扣固定成本（`数据管理/config/fixed-cost-params.json`）
