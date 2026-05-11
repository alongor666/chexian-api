---
name: diagnose-lr-projection
description: 车险整体满期赔付率 burning-cost 平移预测 — 用历史 N 年 4 维 cell LR 平移到预测年起保业务结构，输出全年预期 LR + 264 cell 矩阵 + Markdown 报告
category: data-analysis
version: 1.0.0
author: "@claude"
tags: [loss-ratio, projection, burning-cost, year-end, cell-matrix, fallback, override]
scope: project
requires:
  - Python 3.x
  - duckdb (pip)
  - pandas (pip)
dependencies:
  - 数据管理/pipelines/diagnose_lr_2026_projection.py
  - 数据管理/pipelines/diagnose_common.py
  - 数据管理/warehouse/fact/policy/current/*.parquet
  - 数据管理/warehouse/fact/claims_detail/claims_*.parquet
last_updated: "2026-05-11"
---

# 车险整体满期赔付率 burning-cost 平移预测（v1.0）

> 用历史 N 年保单的 4 维 cell 满期赔付率，平移到预测年起保保单的对应 cell，再用预测年的业务结构加权得到全年预期车险整体满期赔付率。

---

## 适用场景

- 年度经营预测：预测年保单未到期，无法直接观测最终 LR，用历史 cell-level LR 作基准 × 预测年业务结构得"结构性预期值"
- 风险结构监测：4 维 cell 矩阵直接看到 264 个细分单元哪些异常高/低
- 业务结构变化影响测算：预测 LR ≠ 历史 LR 时，差异自动归因到"业务结构变化"（cell 内 LR 沿用历史）
- 业务介入预测：通过 `lr_projection_overrides.csv` 提供 cell 级 expected_lr，强制覆盖 fallback

> **与 `/diagnose-forecast-claim` 的边界**：本命令做"结构性平移→全年 LR"；forecast-claim 做"目标 LR 反推赔款空间 Δ"。两者正交互补。

---

## 核心模型

```
1. 历史窗口 N 年：每个 (客户类别 × is_nev × 标准四分类 × 险别组合) cell
     hist_LR = Σ(已报告赔款) / Σ(满期保费)    ← 多年合计先 SUM 分子分母再除

2. Fallback：cell 满期保费 < 阈值 OR 车辆数 < 阈值 → 逐级降维
     4d → 3d (去险别) → 2d (去四分类) → 1d (去能源) → 整体
     每层都用同阈值判断，避免极端值

3. Override：用户 CSV (4 维完整 + expected_lr) 强制覆盖 fallback

4. 预测年外推：
     scale_factor = 12 / 已签月数
     预测年全年满期保费 = 已签 earned_premium × scale_factor

5. 预测赔款 = 满期保费 × applied_LR
6. 整体预期 LR = Σ 预测赔款 / Σ 预测满期保费
```

---

## CLI 参数

### 默认就能跑（无参 = 2023-2025 → 2026）

```bash
python3 数据管理/pipelines/diagnose_lr_2026_projection.py
```

### 全参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--hist-years` | 历史窗口，`2023-2025` 或 `2022,2023,2024` | `2023-2025` |
| `--proj-year` | 预测年份 | `2026` |
| `--as-of` | 历史保单满期截止日 | 今日 |
| `--threshold-premium-wan` | 小样本阈值-满期保费（万元） | `500` |
| `--threshold-vehicle` | 小样本阈值-车辆台数 | `5000` |
| `--overrides` | 用户 override CSV 路径（4 维 + expected_lr） | 无 |
| `--output-dir` | 输出目录 | `数据管理/数据分析报告/{proj_year}_LR_平移预测_{date}/` |

---

## 输出产物（Markdown 报告 10 板块）

输出目录：`数据管理/数据分析报告/{proj_year}_LR_平移预测_{date}/`

1. **方法论**：4 维定义 + Fallback 规则 + Override 应用情况
2. **整体预测**（结论先行）：预测年全年预期 LR（含/不含 override 双口径 + 与历史对比）
3. **按客户类别 11 行**（含四级亮灯 🟢🔵🟡🔴）
4. **按能源类型 2 行**（燃油/新能源）
5. **按标准四分类 4 行**（新车/旧车过户/旧车非过户续保/旧车非过户转保）
6. **按险别组合 3 行**（主全/交三/单交）
7. **Top 10 高赔付率 cell**（最大风险点，预测年满期保费 ≥ 50 万）
8. **Top 10 低赔付率 cell**（机会点，预测年满期保费 ≥ 50 万）
9. **Fallback 兜底情况统计**（4d_original / 3d/2d/1d_fallback / overall / override 计数与保费占比）
10. **方法论局限性**与使用建议

辅助 CSV 产物：
- `{proj_year}_LR_cells_detail.csv` — 138 cell 明细（4 维 + 各级 LR + fallback_level + 预测保费/赔款）
- `{proj_year}_LR_summary_by_dim.csv` — 4 张维度汇总表合并

---

## 使用示例

### 1. 默认跑（2023-2025 → 2026）

```bash
python3 数据管理/pipelines/diagnose_lr_2026_projection.py
```

### 2. 带 override（业务介入异常 cell）

```bash
python3 数据管理/pipelines/diagnose_lr_2026_projection.py \
  --overrides 数据管理/pipelines/lr_projection_overrides.csv
```

### 3. 跨年度复用（2027 预测）

```bash
python3 数据管理/pipelines/diagnose_lr_2026_projection.py \
  --hist-years 2024-2026 --proj-year 2027
```

### 4. 放宽小样本阈值（中小机构）

```bash
python3 数据管理/pipelines/diagnose_lr_2026_projection.py \
  --threshold-premium-wan 300 --threshold-vehicle 3000
```

### 5. 4 年历史窗口（含 2022）

```bash
python3 数据管理/pipelines/diagnose_lr_2026_projection.py \
  --hist-years 2022-2025 --proj-year 2026
```

---

## Override CSV 格式

`数据管理/pipelines/lr_projection_overrides.csv` 模板：

```csv
customer_category,is_nev,vehicle_type_4,coverage_combination,expected_lr,note
营业出租租赁,False,旧车非过户转保,主全,0.7280,武侯70.3%×65% + 非武侯29.7%×91.2%
营业出租租赁,False,旧车过户,主全,0.6500,武侯100% × 65%
```

**规则**：
- 4 维必须精确匹配（否则警告但不中断）
- `is_nev` 必须是 `True` / `False`（大小写敏感）
- `vehicle_type_4` 取值：`新车` / `旧车过户` / `旧车非过户续保` / `旧车非过户转保`
- `coverage_combination` 取值：`主全` / `交三` / `单交`
- `expected_lr` 为小数（0.65 = 65%）
- `#` 开头行视为注释

**机构定向 override**：如某客户类别仅某机构异常，需先用 DuckDB 算出该 cell 内"机构 × 期望 LR + 其他 × 当前 fallback LR"的加权值，再写入 expected_lr（不要直接写 0.65 把全省都改成 65%）。

---

## 标准四分类（RED LINE）

判定优先级（SQL CASE WHEN 顺序敏感）：**新车 > 旧车过户 > 旧车非过户续保 > 旧车非过户转保**

```sql
CASE
  WHEN COALESCE(is_new_car, FALSE) THEN '新车'
  WHEN COALESCE(is_transfer, FALSE) THEN '旧车过户'
  WHEN COALESCE(is_renewal, FALSE) THEN '旧车非过户续保'
  ELSE '旧车非过户转保'
END
```

详见 memory `project_vehicle_type_classification.md`。

---

## 计算口径（RED LINE）

| 口径 | 公式 / 规则 |
|------|------------|
| 满期天数（闰年感知）| `DATE_DIFF('day', insurance_start_date, insurance_start_date + INTERVAL 1 YEAR)` |
| 历史满期保费 | `premium × LEAST(GREATEST(DATEDIFF('day', start, as_of), 0), policy_term) / policy_term` |
| 预测年满期保费 | 同上，as_of 替换为 `{proj_year}-12-31` |
| 已报告赔款 | `SUM(COALESCE(settled_amount, 0) + COALESCE(pending_amount, 0))` JOIN policy_no |
| 赔案去重 | `SELECT DISTINCT ON (claim_no) ... ORDER BY claim_no`（防批改副本双倍） |
| 车辆台数 | `COUNT(DISTINCT COALESCE(NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''), policy_no))` |
| cell LR | `SUM(hist_claims) / NULLIF(SUM(hist_earned_premium), 0)` —— 禁加权平均 |
| 全年外推系数 | `12 / ((MAX(insurance_start_date) - {proj_year}-01-01) / 30.4)` —— 按起保日累计 |
| 险别过滤 | `coverage_combination IN ('主全','交三','单交')` —— 排除 '未知'/'其他' |

---

## 业务铁律

1. **多年合计先 SUM 再除**：禁止逐年算 LR 再取均值（违反 memory `feedback_multi_year_aggregate_not_avg.md`）
2. **每级 fallback 都判阈值**：避免某个小样本 cell 因 4d 不达标 fallback 到同样不达标的 3d 后被采用
3. **insurance_start_date 而非 policy_date**：已赚保费按起保日累计，外推基准必须同口径
4. **机构定向 override 要做加权**：CSV 里写最终加权后的 expected_lr，不要把"局部异常"扩大成"全省覆盖"
5. **结果是结构性预期，不是精算预测**：不含通胀、法规、产品费率变化影响（详见报告板块 10）

---

## 回归基线（v1.0 锁定，2026-05-11 跑出）

> 用于脚本升级/重构时的回归测试

```
默认参数（hist=2023-2025, proj=2026, threshold=500万/5000台, as-of=2026-05-11）:
  4d cells: 180 / 3d: 73 / 2d: 21 / 1d: 11
  历史整体 LR: 73.18% (2023-2025 三年合计)
  2026 已签 cells: 138, 最晚起保日 2026-08-03, scale_factor 1.705
  不含 override：2026 全年预期 LR ≈ 72.9%
  含 11 行武侯 override：2026 全年预期 LR = 72.44%
  Fallback 分布：4d 37 / 3d 10 / 2d 38 / 1d 20 / overall 22 / override 11
```

---

## 相关命令

- `/diagnose-forecast-claim` 给定目标 LR 反推赔款空间 Δ（短期口径，单 cohort）
- `/diagnose-segment` 任意 WHERE 细分的 cohort 时间发展
- `/diagnose-cohort-comparison` 两个 cutoff 间 cohort 发展对比
- `/diagnose-router` 诊断命令总路由

ARGUMENTS: {历史窗口 + 预测年 + 小样本阈值 + override CSV 路径}
