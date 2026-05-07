---
name: diagnose-forecast-claim
description: 满期赔付率推演与赔款空间反推 — 任意维度筛选下，给定目标赔付率求新增赔款空间 Δ；或给定 Δ 求赔付率
category: data-analysis
version: 1.0.0
author: "@claude"
tags: [forecast, loss-ratio, claim-space, projection, what-if]
scope: project
requires:
  - Python 3.x
  - duckdb (pip)
dependencies:
  - 数据管理/pipelines/diagnose_forecast_claim.py
  - 数据管理/warehouse/fact/policy/current/*.parquet
  - 数据管理/warehouse/fact/claims_detail/claims_*.parquet
last_updated: "2026-05-06"
---

# 满期赔付率推演与赔款空间反推（v1.0）

> 给定基础期实际数据 + 日均保费外推到评估日，反推「为达到目标满期赔付率，剩余 projection 期可新增多少已报告赔款」。
> 也支持正向：给定 Δ 增量赔款，预测评估日的满期赔付率。

---

## 适用场景

- 经营推演：本年保单到 H1/H2 末期，目标 X% 赔付率下还能"承受"多少新增赔款
- What-if 分析：若 Q3 集中爆发 N 万赔款，年末赔付率会到多少
- 跨机构 / 跨客户类别风险预算：在多个 cohort 上批量算赔款空间
- 续保定价决策支持：剩余期间赔款空间反推保费定价上限

---

## 核心模型

```
1. 基础期实际：[base_start, base_end] 已签保单的签单保费 + 满期保费 + 已报告赔款
2. Projection 期外推：日均签单保费 × 剩余天数 = projected signed premium
3. Projected 满期保费：
   - cohort_by=start_date: D / (2 × 平均 term) 起期均匀分布积分
   - cohort_by=policy_date: 按基础期 lead 分布加权积分
4. 合计满期保费 = 已签 earned at eval + projected earned
5. 反向求解 Δ = 合计满期 × 目标率 − 当前已报告赔款
6. 正向求解：implied_ratio = (reported + Δ) / 合计满期
```

---

## CLI 参数

### 必填

| 参数 | 说明 | 示例 |
|------|------|------|
| `--base-start` | 基础期起 (YYYY-MM-DD, inclusive) | `2026-01-01` |
| `--base-end` | 基础期止 (YYYY-MM-DD, inclusive) | `2026-05-04` |
| `--eval-date` | 评估日 (YYYY-MM-DD, inclusive) | `2026-06-30` |

### 维度筛选（均可选，默认 ALL）

| 参数 | 字段 | 取值（逗号分隔多选）|
|------|------|---------|
| `--org` | `org_level_3` | `天府`/`宜宾,泸州`/`all` |
| `--customer-category` | `customer_category` | `摩托车`/`非营业个人客车,营业货车`/`all` |
| `--insurance-type` | `insurance_type` | `交强险`/`商业险`/`all` |
| `--coverage` | `coverage_combination` | `主全`/`三者`/`all` |
| `--is-nev` | `is_nev` | `是`/`否`/`all` |
| `--is-renewal` | `is_renewal` | `续保`/`新单`/`all` |
| `--is-new-car` | `is_new_car` | `新车`/`旧车`/`all` |

### 求解模式（二选一，互斥）

| 参数 | 模式 | 默认 |
|------|------|------|
| `--targets 115,120,125,130,135,150` | **反向**（默认）：多档目标率求 Δ | ✓ |
| `--reverse-delta 500000` | **正向**：给定 Δ（元）求赔付率 | — |

### Cohort 与高级

| 参数 | 选项 | 默认 |
|------|------|------|
| `--cohort-by` | `start_date` (chexian 标准) / `policy_date` (签单口径) | `start_date` |
| `--simple-ratio` | 手动覆盖 projection earned ratio（如 0.06 简化算）| 严格积分 |
| `--no-yoy` | 禁用 YoY 同期对比 | 启用 YoY |
| `--output` | `markdown` / `json` | `markdown` |

---

## 输出结构（Markdown）

1. **元信息**：筛选条件、基础期、评估日、cohort 主备口径
2. **Cohort 概览**：保单数 / 签单 / 满期 / 赔款 + YoY 同期对比列
3. **求解结果**：
   - 反向：6 档目标率的 Δ + 与当前 reported 倍数
   - 正向：implied 满期赔付率
4. **Sensitivity 备口径对比**：主口径与备口径（policy_date vs start_date）的差异
5. **关键说明**：公式、ratio、未决占比预警

---

## 使用示例

### 1. 四川全口径摩托交强 5/5–6/30 赔款空间

```bash
python3 数据管理/pipelines/diagnose_forecast_claim.py \
  --base-start 2026-01-01 --base-end 2026-05-04 --eval-date 2026-06-30 \
  --customer-category 摩托车 --insurance-type 交强险
```

### 2. 仅天府 + 自定义档位 + 禁用 YoY

```bash
python3 数据管理/pipelines/diagnose_forecast_claim.py \
  --base-start 2026-01-01 --base-end 2026-05-04 --eval-date 2026-06-30 \
  --org 天府 --customer-category 摩托车 \
  --targets 100,110,115,120,130 \
  --no-yoy
```

### 3. 正向求解：天府新增 20 万赔款 → 6/30 赔付率

```bash
python3 数据管理/pipelines/diagnose_forecast_claim.py \
  --base-start 2026-01-01 --base-end 2026-05-04 --eval-date 2026-06-30 \
  --org 天府 --customer-category 摩托车 \
  --reverse-delta 200000
```

### 4. 多机构对比 + JSON 输出（用于二次处理）

```bash
python3 数据管理/pipelines/diagnose_forecast_claim.py \
  --base-start 2026-01-01 --base-end 2026-05-04 --eval-date 2026-06-30 \
  --org "天府,宜宾,泸州,自贡" --customer-category 摩托车 \
  --output json | jq '.solve.scenarios'
```

### 5. 全年口径（基础期=年初至今，评估日=年末）

```bash
python3 数据管理/pipelines/diagnose_forecast_claim.py \
  --base-start 2026-01-01 --base-end 2026-05-04 --eval-date 2026-12-31 \
  --customer-category 非营业个人客车 --insurance-type 商业险 \
  --is-renewal 续保
```

---

## 计算口径（RED LINE）

| 口径 | 公式 / 规则 |
|------|------------|
| 净签单保费 | `SUM(premium) GROUP BY policy_no, HAVING > 0`（去原单+批改副本）|
| 满期保费 | `signed × max(0, min(end, eval) - start) / (end - start)` |
| Projection 满期（start_date）| `D / (2 × 平均 term)`，D = projection 天数 |
| Projection 满期（policy_date）| `Σ premium × max(0, (D-L)²) / (2×D×term) / Σ premium` |
| 已报告赔款 | `SUM(COALESCE(settled,0) + COALESCE(pending,0))` JOIN policy_no（NULL safe）|
| 满期赔付率 | reported / 合计满期保费 |
| 当前赔付率 | reported_at_base_end / earned_at_base_end |
| 自然演进赔付率 | reported_at_base_end / 合计满期保费（零新增情景）|

---

## 已知差异 / 边界

| 场景 | 主口径 | 备口径 | 差异来源 |
|------|--------|--------|----------|
| 2026 H1 摩托交强 | start_date | policy_date | 含/不含 2025 跨年起保保单 |
| 历史年份（< 2024）| 自动加载 21-23 全量 parquet | — | — |
| 多客户类别 | 自动 union 限摩+剔摩 | — | — |

**注意**：cohort_by 切换后，cohort 的边界会变（如 2025 跨年保单是否纳入），sensitivity 行始终展示对方口径数字便于对照。

---

## 回归基线（v1.0 锁定）

> 用于脚本升级/重构时的回归测试。

```
四川全口径摩托交强 (start_date 默认):
  合计满期 352.90 万 / reported 354.12 万 / 自然赔付率 100.34%
  Δ@115% = 51.72 万

天府摩托交强 (start_date 默认):
  合计满期 88.71 万 / reported 103.06 万 / 自然赔付率 116.17%
  Δ@115% = -1.04 万 (赤字)

天府摩托交强 (policy_date sensitivity):
  合计满期 80.65 万 / reported 82.35 万
  Δ@115% = 10.39 万
```

---

## 相关命令

- `/diagnose-vehicle` 单类别全维度经营诊断（v5.0）
- `/diagnose-agent` 经营两阶段诊断（含 Phase 3 毒性）
- `/diagnose-cohort-comparison` 两个 cutoff 间 cohort 时间发展
- `/diagnose-motorcycle` 摩托车专项 + 人身险捆绑成本模型

ARGUMENTS: {筛选条件 + 基础期 + 评估日 + 目标率档位}
