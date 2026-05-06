---
name: diagnose-cohort-comparison
description: 双 cutoff cohort 发展对比诊断 — 双因素分解 + 归一速度 + 自动打灯
category: data-analysis
version: 1.0.0
author: "@claude"
tags: [diagnosis, cohort, dual-cutoff, factor-decomposition, claims-heatmap]
scope: project
requires:
  - Python 3.x
  - duckdb (pip)
dependencies:
  - 数据管理/pipelines/diagnose_cohort_comparison.py
  - 数据管理/warehouse/fact/policy/current/*.parquet
  - 数据管理/warehouse/fact/claims_detail/claims_*.parquet
related:
  - server/src/sql/claims-heatmap.ts (口径同源 + customCutoffs API 等价)
last_updated: "2026-05-06"
---

# 双 cutoff cohort 发展对比（/diagnose-cohort-comparison）

> 对**同一年度起保**的保单 cohort，在两个 cutoff 之间做发展对比 + 同比对照。回答"4 月相对 3 月哪个客户类别拖后腿"、"今年发展节奏比去年快还是慢"等诊断问题。

---

## 诊断路由边界（先判定）

执行前先按 `/diagnose-router` 分流；本命令只处理**同一 policy-year cohort 的双 cutoff 变化**。

必须让路：
- 单 cutoff 细分经营 / 90/180/270/满期四桩 → `/diagnose-segment`
- 机构 / 经代整体经营三问 → `/diagnose-agent`
- 续保、报价、续回 → `/diagnose-renewal`
- 摩托车真实盈亏线 → `/diagnose-motorcycle`
- 过户车出险地异常 → `/diagnose-transfer-location`

## 使用场景

- 「2026 年保单截至 4-30 vs 截至 3-31，各客户类别如何变化」
- 「某机构某险种在月度估值之间的赔付率是 cohort 自然发展还是真异常」
- 「拆开摩托车 vs 非摩托车看影响度」

**不适合**：单 cutoff 切片（用 `/diagnose-segment`）、机构维度（用 `/diagnose-agent`）、续保口径（用 `/diagnose-renewal`）。

---

## 调用方式

### 标准调用（指定双 cutoff + 同比偏移）

```bash
python3 数据管理/pipelines/diagnose_cohort_comparison.py \
  --policy-year 2026 \
  --cutoffs 2026-03-31,2026-04-30 \
  --yoy-offset 1 \
  --isolate-category 摩托车 \
  --claims-date-field accident_time
```

### 自定义异常阈值

```bash
python3 数据管理/pipelines/diagnose_cohort_comparison.py \
  --cutoffs 2026-03-31,2026-04-30 \
  --abnormal-pp 80 \
  --yoy-deteriorate-pp 20 \
  --min-claim-count 10 \
  --output both
```

### 加 WHERE 过滤（如某机构 / 某能源类型）

```bash
python3 数据管理/pipelines/diagnose_cohort_comparison.py \
  --cutoffs 2026-03-31,2026-04-30 \
  --where "org_level_3='天府' AND is_nev=true"
```

### 等价的 API 调用（前端复用）

`/api/query/claims-detail/heatmap` 已支持 `customCutoffs` 参数：

```
GET /api/query/claims-detail/heatmap?
  dimension=customer_category&
  policyYear=2026&
  customCutoffs=2026-03-31,2026-04-30&
  claimsDateField=accident_time
```

返回 list 中每行 `period_label` 直接是 cutoff 日期字符串（cutoff_type='custom'）。

---

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--cutoffs` | （必填） | 逗号分隔 ISO 日期，至少 2 个；自动按时序排序 |
| `--policy-year` | cutoff_b 的年份 | YEAR(insurance_start_date) cohort |
| `--yoy-offset` | 1 | 同比偏移年数；2 = 与前年对比 |
| `--isolate-category` | 摩托车 | 顶层独立切出某类别；空字符串关闭 |
| `--split-dim` | customer_category | 二级拆分维度（预留） |
| `--claims-date-field` | accident_time | accident_time \| report_time |
| `--where` | — | 额外 WHERE，如 `org_level_3='天府'` |
| `--min-claim-count` | 5 | 件数低于此数打 ⚪ 样本不足 |
| `--abnormal-pp` | 100 | 赔付率绝对水位 pp，超过 + 同比恶化 → 🔴 双暴涨 |
| `--yoy-deteriorate-pp` | 30 | 同比恶化 pp 阈值 |
| `--output` | console | console \| md \| both |
| `--out-dir` | 数据分析报告/ | md 落盘目录 |

---

## 输出结构

```
# Cohort 发展对比诊断报告

## 一、顶层三段对照
（整体 / isolate / 其他 × 6 指标 × 环比+同比 8 列）

## 二、影响度分解（对整体满期赔付率变化）
（11 类 × 结构pp/赔付pp/二阶pp/合计pp/占整体% + 自动打灯）

## 三、归一发展速度
（该类 lr 增速 ÷ 整体 lr 增速；> 1.5 🟡, < 0.7 🔵）

## 四、cutoff_b vs YoY_b 客户类别对照
（保费同比/赔付率Δpp/赔款同比/频度Δpp）
```

---

## 业务口径

- **起保口径**：`YEAR(insurance_start_date) = policy_year`
- **满期保费**：闰年感知，按 cutoff 结算
- **已报告赔款**：已决 + 未决
- **赔案纳入**：默认 `accident_time ≤ cutoff`（也可改为 report_time）
- **cohort 隔离**：分子分母同 cohort，避免跨年度污染
- **同比基准**：YEAR-1 起保保单在 cutoff-1 年同位累计

口径与 `server/src/sql/claims-heatmap.ts` 一致（同一套 earned 公式）。

---

## 自动打灯规则

| 条件 | 灯 | 含义 |
|---|---|---|
| `claim_count < min_claim_count` | ⚪ 样本不足 | 件数太少，赔付率波动大不可信 |
| `lr_b > abnormal_pp 且 yoy_pp_delta > yoy_pp` | 🔴 双暴涨 | 绝对水位破阈值 + 同比恶化双确认 |
| `velocity > 1.5` | 🟡 快于大盘 | 归一速度 1.5 倍于整体 |
| `velocity < 0.7` | 🔵 慢于大盘 | 比大盘改善快 |
| `yoy_pp_delta > yoy_pp` 且非上述 | 🟡 同比恶化 | 单边异常 |
| 其他 | 🟢 跟随 | 跟随整体节奏 |

---

## 与现有诊断工具的关系

| 工具 | 适用 | 关键特征 |
|---|---|---|
| `/diagnose-segment` | 单时点 + 多维下钻 | WHERE 任意 + 4 桩发展 |
| `/diagnose-agent` | 机构维度 | 机构间对标 + 满期/全口径 |
| `/diagnose-motorcycle` | 摩托车专项 | A/B 类成本模型 + 真实盈亏 |
| **`/diagnose-cohort-comparison`** | **双 cutoff 对比** | **因素分解 + 归一速度 + 自动打灯** |

新工具填补"两时点对比 + 因素分解"空白，与三个老工具正交。

---

## 验证

```bash
# 与 claims-heatmap API 对账：
curl -s "http://localhost:3000/api/query/claims-detail/heatmap?dimension=customer_category&policyYear=2026&customCutoffs=2026-03-31,2026-04-30&claimsDateField=accident_time" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | select(.period_label=="2026-04-30") | {dimension_value, earned_premium_wan, total_claims_wan, loss_ratio_pct}'

# vs Python 脚本输出（应严格相等）
```
