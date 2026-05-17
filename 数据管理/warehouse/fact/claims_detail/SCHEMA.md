# claims_detail — 赔案明细域 Schema 说明

> **唯一赔付数据源**。按保险起期年度（`insurance_year`）分区，文件命名 `claims_YYYY.parquet`。
> 服务端读取时使用 `read_parquet([...], union_by_name=true)`，跨年度分区 schema 漂移由 DuckDB 自动对齐。

---

## 1. Schema 演进时间线

| 日期 | 变更 | 影响范围 |
|------|------|----------|
| 2026-04-18 | 源 `02_理赔明细_*.xlsx` 移除 `已决费用`、新增 `标的汽修厂` | 2025+ 分区（`claims_2025.parquet` / `claims_2026.parquet` 及后续） |

## 2. 新旧 Schema 对照

| 字段（中） | 字段（英） | 2021-2024 旧源 | 2025+ 新源 | 说明 |
|-----------|-----------|:-------------:|:---------:|------|
| 已决费用 | `settled_fee` | ✅ 有值 | ❌ 无此列（ETL 补 NULL） | **已废弃**：用户 2026-04-18 确认此字段本就包含在 `已决金额` 内，历史数据为冗余。总赔付公式已移除此项（避免 2021-2024 数据 ~1-2.5% 双重计数） |
| 标的汽修厂 | `subject_repair` | ❌ 无此列（ETL 补 NULL） | ✅ 有值 | 标的车送修的合作维修厂 |
| 三者汽修厂 | `third_party_repair` | ✅ | ✅ | 三者车送修的合作维修厂 |

其余 32 个字段两代 schema 一致，参见 `pipelines/convert_claims_detail.py` 的 `CN_TO_EN` 映射。

## 3. ETL 兼容性保障

1. **ETL 出参对齐**：`convert_claims_detail.py` 无论源是哪代，输出 parquet 必然同时包含 `settled_fee` 和 `subject_repair` 两列（缺失列补 `pd.NA`）。
2. **CDC 分区合并**：`claims_partition_manager.py do_update` 使用 `UNION ALL BY NAME` 处理新输入与旧分区的 schema 漂移。
3. **服务端读取**：`server/src/services/duckdb-parquet-loader.ts` 使用 `read_parquet([...], union_by_name=true)` 兼容各年度分区列差异。
4. **下游 SQL**：总赔款统一按结案状态二选一，已结案取 `settled_amount`，未结案取 `reserve_amount`，新分区缺失的废弃字段不再参与赔款计算。

## 4. 业务口径：总赔付金额

**正确公式**：`CASE WHEN settlement_time IS NOT NULL THEN settled_amount ELSE reserve_amount END`（已决/未决二选一，不相加）。

旧公式曾包含 `+ settled_fee`，但用户确认 `已决费用` 本就包含在 `已决金额` 内，历史数据为冗余字段；后续又统一收敛为已结案取 `settled_amount`、未结案取 `reserve_amount`。2025+ 源已直接移除 `settled_fee` 列。

## 5. 分区列表（截至 2026-04-18）

| 分区 | 行数 | 冻结 | 备注 |
|------|------|------|------|
| claims_2019.parquet | 17 | 🧊 | 历史数据 |
| claims_2020.parquet | 24,493 | 🔥 | 历史数据 |
| claims_2021.parquet | 47,814 | 🔥 | 旧 schema（有 settled_fee，无 subject_repair） |
| claims_2022.parquet | 49,150 | 🔥 | 同上 |
| claims_2023.parquet | 56,769 | 🔥 | 同上 |
| claims_2024.parquet | 53,257 | 🔥 | 混合 schema（CDC 合入的 2025+ 报案赔案带 subject_repair） |
| claims_2025.parquet | 45,552 | 🔥 | 新 schema |
| claims_2026.parquet | 3,189 | 🔥 | 新 schema |

合计 **280,241** 行（`_partition_meta.json` 为事实源）。
