---
name: diagnose-agent
description: 全维度经营诊断（经代公司 or 车型/客户类别，7板块：整体→新转续过户→能源→风险评分→季度趋势→险类→总结）
category: data-analysis
version: 3.0.0
author: "@claude"
tags: [diagnosis, vehicle, agent-company, kpi, duckdb, parquet, earned-premium, margin]
scope: project
requires:
  - Python 3.x
  - duckdb (pip)
dependencies:
  - 数据管理/pipelines/diagnose_vehicle.py
  - 数据管理/pipelines/diagnose_agent.py
  - 数据管理/warehouse/fact/policy/current/*.parquet
last_updated: "2026-03-31"
---

# 全维度经营诊断

两个脚本，按场景选择：

## 1. 车型/客户类别诊断（diagnose_vehicle.py，7 板块）

```bash
# 牵引车
python3 数据管理/pipelines/diagnose_vehicle.py --filter "厂牌车型 LIKE '%牵引%'" --title 牵引车

# 营业货车
python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'" --title 营业货车

# 某机构
python3 数据管理/pipelines/diagnose_vehicle.py --filter "三级机构 = '天府'" --title 天府机构
```

**7 板块结构**：
1. 整体经营概况（按年份展开）
2. 新转续过户维度（新车/旧车续保/旧车转保/旧车过户）
3. 能源类型（非新-燃/非新-天/新能源，天然气预留）
4. 风险评分（A-X + 无评分，智能识别客户类别对应字段）
5. 季度趋势（最长 24 季 + 7 个条形图）
6. 险类（商业险/交强险）
7. 诊断总结 + 关键发现 + 更多维度建议

## 2. 经代公司诊断（diagnose_agent.py）

```bash
python3 数据管理/pipelines/diagnose_agent.py --org 天府 --agent "北京银河"
```

## 指标体系

| 指标 | registry id | 公式 |
|------|------------|------|
| 满期边际贡献额 | earned_margin_amount | 满期保费 × (1 - 赔付率 - 费用率) |
| 预估边际贡献额 | projected_margin_amount | 签单保费 × (1 - 赔付率 - 费用率) |
| 变动成本率 | variable_cost_ratio | 满期赔付率 + 费用率 |
| 边际贡献率 | - | 100% - 变动成本率 |
| 满期赔付率 | earned_claim_ratio | 已报告赔款 / 满期保费 |
| 费用率 | expense_ratio | 费用金额 / 签单保费 |
| 满期出险率 | earned_loss_frequency | 有赔案保单数 / 总保单数 |
| 案均赔款 | avg_claim_amount | 已报告赔款 / 赔案件数 |
| 商车定价系数 | - | AVG(商车自主定价系数) |

## 亮灯规则

| 指标 | 🟢正常 | 🔵关注 | 🟡预警 | 🔴危险 |
|------|--------|--------|--------|--------|
| 变动成本率 | ≤85% | 85-91% | 91-94% | >94% |
| 边际贡献率 | ≥15% | 9-15% | 6-9% | <6% |
| 满期赔付率 | ≤60% | 60-70% | 70-75% | >75% |
| 满期出险率 | ≤8% | 8-10% | 10-12% | >12% |
| 案均赔款(货车) | ≤8000 | 8000-10000 | 10000-12000 | >12000 |

## 排版规则

- 文字列左对齐（`:---`），数字列右对齐（`---:`）
- 金额单位万元，在报告备注说明；案均赔款/件均保费用元，标 `†`
- 列头不含单位
- 文件名含最新签单日期（截至 YYYY-MM-DD）

## 风险评分智能识别

脚本自动检测客户类别对应的评分字段：
- 非营业客车 → 车险风险等级
- 小货车 → 小货车评分
- 大货车 → 大货车评分
- 混合 → COALESCE(覆盖率最高的字段优先)
