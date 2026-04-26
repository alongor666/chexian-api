---
name: diagnose-renewal
description: 续保诊断 — 责任模式 / 报价提前天数 / 折扣降幅 / 团队产能 / 待跟进清单
category: data-analysis
version: 1.0.0
author: "@claude"
tags: [diagnosis, renewal, salesforce, action-list]
scope: project
requires:
  - Python 3.x
  - duckdb (pip)
  - pandas (pip)
dependencies:
  - 数据管理/pipelines/diagnose_renewal.py
  - 数据管理/pipelines/diagnose_common.py
  - 数据管理/warehouse/fact/renewal/renewal_funnel_*.parquet
  - 数据管理/warehouse/fact/policy/current/*.parquet
  - 数据管理/warehouse/fact/quotes_conversion/latest.parquet
last_updated: "2026-04-26"
---

# 续保诊断（/diagnose-renewal）

> 复用项目内现有应续盘（renewal_funnel）+ 上年原单（policy/current）+ 报价（quotes_conversion）三方 JOIN，输出 7 板块 Markdown 报告 + 待跟进 CSV。所有板块只读 Parquet，不依赖企业微信表导出。

---

## 适合场景

- 「**全年/当月/未来 30 天到期**的续保盘子表现如何？」
- 「**自留 vs 兜底** 哪种责任模式续回率更高？」
- 「**报价提前 N 天** 对续回率影响有多大？」
- 「**报价折扣降幅** 多少时续回率最高？」
- 「**未报价的高价值优质客户** 是哪些（导给业务员跟进）？」
- 「**销售团队/业务员** 续保产能排名（含倒数末位预警）」

**不适合**：续保模块前端 UI 切片（用 `/api/query/renewal-tracker`）、跨年度趋势（用 `/data-trends`）、风险等级专项（用 `/diagnose-vehicle`）。

---

## 调用方式

### 默认全年应续（最常用）

```bash
python3 数据管理/pipelines/diagnose_renewal.py --year 2026
```

数据窗口：`expiry ∈ [2026-01-01, 2026-12-31]`，cutoff = today，按月切片漏斗。

### 时间视图选项（`--time-view`）

| 视图 | 含义 | 备注 |
|------|------|------|
| `ytd`（默认） | 全年应续，按月切片 | 与 `by_month` 等价 |
| `by_month` | 同 ytd | — |
| `mtd_today` | 当月应续 + cutoff=today | 看本月进度 |
| `next_to_eom` | today ~ 当月最后一天 | 月末冲刺名单 |
| `next_30_days` | today ~ today+30 | 滚动 30 天高优先级名单 |
| `custom` | `--start --end` 自定义 | 跨季 / 跨自然月 |

### 范围筛选

```bash
# 仅诊断「天府」机构
python3 数据管理/pipelines/diagnose_renewal.py --time-view ytd --year 2026 --org 天府

# 仅诊断「资阳销售一部」（模糊匹配 team_name）
python3 数据管理/pipelines/diagnose_renewal.py --time-view ytd --year 2026 --team 资阳销售一部

# 重点：本周高优先级跟进名单（未来 30 天）
python3 数据管理/pipelines/diagnose_renewal.py --time-view next_30_days
```

### 关闭待跟进 CSV（仅看报告，不落清单）

```bash
python3 数据管理/pipelines/diagnose_renewal.py --time-view ytd --year 2026 --no-action-list
```

---

## 输出

**Markdown 报告**：`数据管理/数据分析报告/续保诊断_{view_label}_{timestamp}.md`

8 个板块：

1. **续保漏斗** — 应续 / 已报价 / 报价率 / 已续回 / 续回率（按月切片 + 合计），亮灯
2. **责任模式** — 自留 vs 兜底 vs 未分类 的承接量、占比、报价率、续回率
3. **报价提前天数** — ≥30 / 21~29 / 14~20 / 7~13 / 0~6 / 已过期 / 未报价 分桶 × 续回率
4. **折扣 / 保费画像**
   - 4.1 报价折扣降幅（quote_factor − prior_factor）× 续回率
   - 4.2 报价保费 / 上年保费 比值 × 续回率
5. **团队产能** — 三级机构 / 销售团队 / 业务员 三级排名 Top N + 倒数末位 5
6. **客户结构** — 客户类别 × 险别组合 × 责任模式 三向交叉（应续 ≥ 30 才入选）
7. **电销渠道交叉** — 上年原单 × 续保单 4 类流向（自营→自营 / 自营→电销 / 电销→自营 / 电销→电销）+ 各三级机构占比 + 责任模式 × 上年渠道交叉续回率
8. **待跟进清单（重点）** — 未报价 + 上年保费 ≥ P75 + 上年自主系数 ≤ P50 的高价值优质客户

**待跟进 CSV**：`数据管理/数据分析报告/续保待跟进_{timestamp}.csv`，14 列：

```
org_level_3, team_name, salesman_name, customer_category, coverage_combination,
vehicle_frame_no, policy_no, insurance_end_date, days_to_expiry,
prior_premium, prior_factor, insurance_grade, renewal_mode, competition_level
```

---

## 业务口径锚点

| 维度 | 定义 | 字段 |
|------|------|------|
| **应续** | 落入 expiry 窗口的去重车架号 | renewal_funnel.vehicle_frame_no |
| **已报价** | 至少 1 次有效报价（任意 quote_time） | funnel.is_quoted |
| **已续回** | 续保单已签发 | funnel.is_renewed |
| **责任模式** | 自留 = 业务员跟进；兜底 = 电销坐席跟进 | funnel.renewal_mode |
| **上年保费** | 原单（排除批单）保费合计 | policy/current.premium |
| **上年自主系数** | 原单商车自主定价系数 | policy/current.commercial_pricing_factor |
| **报价提前天数** | first_quote_date → expiry_date | quote_lead_days = DATE_DIFF |

> 责任模式与续回结果**相互独立**：自留不等于必续回，兜底也不等于不续回。报告里两者交叉对比是为了评估两条产能路径的效率。

---

## 亮灯阈值

| 指标 | 关注（🔵） | 预警（🟡） | 危险（🔴） |
|------|-----------|-----------|-----------|
| 报价率 | < 90% | < 80% | < 70% |
| 续回率 | < 75% | < 65% | < 55% |

---

## 常见问题

**Q: 提示「窗口内无数据」？**
A: funnel 表是季度预计算（`renewal_funnel_2026q1.parquet` = 2026 q1 应续盘）。诊断窗口超出 funnel 覆盖范围时无数据。检查 `数据管理/warehouse/fact/renewal/` 已生成哪些季度。

**Q: 数据规模与续保模块前端不一致？**
A: 本诊断用 funnel 预计算表，前端 `/api/query/renewal-tracker` 用 `RenewalTrackerFact` view（包含字段更完整，如 used_transfer_type / fuel_category）。两者口径一致，差异仅在维度覆盖。

**Q: 待跟进清单太短/太长？**
A: 阈值 P75 + P50 是相对当前样本的分位数，自适应窗口规模。要更激进可在脚本中改 `prior_premium >= P50` 与 `prior_factor <= P75` 放宽筛选。

**Q: 责任模式只有「未分类」？**
A: funnel 表对历史保单可能未分类。看占比，超过 30% 说明 funnel ETL 需复审。

---

## 复用的项目能力

- 共享 `数据管理/pipelines/diagnose_common.py` 的亮灯 / 格式化函数（与 vehicle / agent 诊断同套范式）
- 数据源 100% 来自 `数据管理/warehouse/fact/`，与续保模块（`server/src/sql/renewal-tracker.ts`）共用底层 Parquet
- 业务口径与 `数据管理/integrations/wecom_smartsheet/sync_renewal_v2.py` 对齐（同样的 quote_window_start / 排他规则 / 业务员归属）
