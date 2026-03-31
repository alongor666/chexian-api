---
name: diagnose-agent
description: 全维度经营诊断（经代公司 or 车型/客户类别，7板块：整体→新转续过户→能源→风险评分→季度趋势→险类→总结）
category: data-analysis
version: 4.0.0
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

## Pre-flight 确认协议（RED LINE）

**每次运行前必须确认以下 4 项**，模糊时主动让用户选择：

| # | 确认项 | 说明 | 默认 |
|---|--------|------|------|
| 1 | **分析对象** | 机构？经代？车型？客户类别？组合筛选？ | 必须明确 |
| 2 | **年份范围** | 哪几年？含不含 2021？ | 最近 5 年 |
| 3 | **对比口径** | 同期对比(ytd) 还是全年(full)？最新年不完整时必须问 | ytd（推荐） |
| 4 | **输出目的** | 看全貌？聚焦某个问题？给谁看？ | 全貌 |

**场景判定**：用户需求 → 脚本选择

```
"XX经代/代理公司"        → diagnose_agent.py
"XX机构"                 → diagnose_vehicle.py --filter "三级机构 = 'XX'"
"XX车型/厂牌"            → diagnose_vehicle.py --filter "厂牌车型 LIKE '%XX%'"
"XX客户类别"             → diagnose_vehicle.py --filter "客户类别 = 'XX'"
"XX机构的XX客户类别"     → diagnose_vehicle.py --filter "三级机构 = 'XX' AND 客户类别 IN (...)"
"对比 A 和 B"            → 分别运行两次，后续可用 --diff 对比
```

## 1. 车型/客户类别诊断（diagnose_vehicle.py，7 板块）

```bash
# 基础用法
python3 数据管理/pipelines/diagnose_vehicle.py --filter "三级机构 = '天府'" --title 天府机构

# 指定年份 + 同期对比（推荐）
python3 数据管理/pipelines/diagnose_vehicle.py --filter "三级机构 = '天府'" --title 天府 --years 2022 2023 2024 2025 2026 --compare ytd

# 全年对比
python3 数据管理/pipelines/diagnose_vehicle.py --filter "三级机构 = '天府'" --title 天府 --years 2022 2023 2024 2025 2026 --compare full

# 交互模式（不指定 --compare，脚本自动检测最新年是否不完整并提示选择）
python3 数据管理/pipelines/diagnose_vehicle.py --filter "三级机构 = '天府'" --title 天府

# 组合筛选
python3 数据管理/pipelines/diagnose_vehicle.py \
  --filter "三级机构 = '天府' AND 客户类别 IN ('非营业个人客车','非营业企业客车','非营业机关客车')" \
  --title "天府非营业客车" --compare ytd

# 跳过自动总结（后续用圆桌会议或 LLM 解读）
python3 数据管理/pipelines/diagnose_vehicle.py --filter "..." --title "..." --no-summary
```

**参数说明**：

| 参数 | 说明 |
|------|------|
| `--filter` | SQL WHERE 条件（必填） |
| `--title` | 报告标题 |
| `--years` | 年份范围，如 2022-2026 |
| `--compare` | `ytd`=同期对比，`full`=全年对比。不指定则交互提示 |
| `--no-summary` | 跳过诊断总结板块 |
| `--output` | 输出目录（默认 数据分析报告/） |

**7 板块结构**：
1. 整体经营概况（按年份展开 + YoY 增长率）
2. 新转续过户维度（新车/旧车续保/旧车转保/旧车过户）
3. 能源类型（非新-燃/非新-天/新能源，天然气预留）
4. 风险评分（A-X + 无评分，智能识别客户类别对应字段）
5. 季度趋势（最长 24 季 + 7 个 ASCII 条形图）
6. 险类（商业险/交强险）+ 险别组合
7. 客户类别 + 吨位分段（货车类自动展开）
8. 诊断总结 + 关键发现 + 建议下一步

## 2. 经代公司诊断（diagnose_agent.py）

```bash
# 基础用法
python3 数据管理/pipelines/diagnose_agent.py --org 天府 --agent "北京银河"

# 指定年份 + 同期对比
python3 数据管理/pipelines/diagnose_agent.py --org 天府 --agent "北京银河" --years 2023 2024 2025 2026 --compare ytd

# 全年对比
python3 数据管理/pipelines/diagnose_agent.py --org 天府 --agent "北京银河" --compare full
```

**参数说明**：

| 参数 | 说明 |
|------|------|
| `--org` | 三级机构名称（必填） |
| `--agent` | 经代公司名称，支持模糊匹配（必填） |
| `--years` | 分析年份列表（默认 2025 2026） |
| `--compare` | `ytd`=同期对比，`full`=全年对比。不指定则交互提示 |
| `--precise-earned` | 使用精确满期保费（含费用率+险类系数） |

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
| 商车定价系数 | - | AVG(商车自主定价系数)，仅商业险 |

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

## 口径选择指南

| 场景 | 推荐口径 | 原因 |
|------|---------|------|
| 看增长趋势、YoY 变化 | **同期(ytd)** | 避免全年 vs 季度的不可比 |
| 看绝对规模、利润总额 | **全年(full)** | 保费/赔款等绝对值更完整 |
| 最新年 ≥11月 | **全年** | 数据基本完整，同期意义不大 |
| 最新年 ≤Q1 | **同期** | 必须同期，否则 YoY 全是-70%+ 假象 |

## 报告生成后的建议下一步

| 报告发现 | 建议动作 |
|---------|---------|
| 转保占比过高(>50%) | 按经代拆分：哪些经代贡献了最多转保？ |
| 某风险等级亏损 | 按等级×年度下钻：是持续亏损还是突发？ |
| 新能源亏损 | 单独出新能源诊断：按品牌/车型细分 |
| 续保流失 | 续保分析：流失去向、竞对报价对比 |
| 费用率波动大 | 按渠道/经代拆分费用：谁在烧钱？ |
| 某年度异常 | 该年度按季度拆分：定位异常季度 |
