# 第1阶段 数据同步 ETL 状态报告

日期: 2026-03-28

## 执行范围

- 检查最新 Excel 数据日期
- 执行本地 `policy daily ETL`
- 验证同步状态

## 关键结论

1. 最新 policy Excel 仅到 `2026-03-26`：`数据管理/每日数据_20260326-20260326.xlsx`
2. 本地执行 `node 数据管理/etl.mjs premium` 后，`policy/daily` 最新分区补齐到 `2026-03-26`
3. 无法如实补齐 `2026-03-28` 分区，原因是源 Excel 尚未提供 `2026-03-27` / `2026-03-28` 数据
4. 当前 `policy/current` 最新快照为 `数据管理/warehouse/fact/policy/current/每日数据_20231201-20260326.parquet`
5. 相对目标日期 `2026-03-28`，仍缺分区 `2026-03-27`、`2026-03-28`，整体落后 `2` 天；但相对最新 Excel 并不落后（`0` 天）

## 执行命令

```bash
find 数据管理 -type f \( -iname '*.xlsx' -o -iname '*.xls' -o -iname '*.xlsm' \) | sort
find 数据管理/warehouse/fact/policy -maxdepth 3 -type f | sort | tail -n 200
node 数据管理/etl.mjs premium
```

## 证据

### 1) 最新 Excel

- `数据管理/每日数据_20260326-20260326.xlsx`
- 最新 Excel 结束日期：`2026-03-26`

### 2) ETL 执行结果

执行 `node 数据管理/etl.mjs premium` 时，脚本使用的源文件为：

- `每日数据_20260326-20260326.xlsx`

ETL 输出到：

- `数据管理/warehouse/fact/policy/daily/2026-03-26.parquet`

这说明当前 ETL 只能基于现有源数据补齐到 `2026-03-26`，不能伪造 `2026-03-28` 分区。

### 3) 同步状态核验

- `policy/current` 最新快照：`每日数据_20231201-20260326.parquet`
- `policy/daily` 最新分区：`2026-03-26`
- `policy/daily` 已有分区范围：`2023-12-01` ～ `2026-03-26`
- 现有范围内缺失分区：`0`
- 对目标日期 `2026-03-28` 尚缺分区：
  - `2026-03-27`
  - `2026-03-28`

## JSON 摘要

```json
{
  "latest_excel_file": "每日数据_20260326-20260326.xlsx",
  "latest_excel_end": "2026-03-26",
  "latest_daily_partition": "2026-03-26",
  "latest_current_snapshot": "每日数据_20231201-20260326.parquet",
  "missing_within_existing_range": [],
  "missing_to_target_2026_03_28": ["2026-03-27", "2026-03-28"],
  "days_behind_vs_excel": 0,
  "days_behind_vs_target": 2
}
```

## 结论

本地 premium 域 ETL 已正常执行并验证成功，但受限于最新源 Excel 仅到 `2026-03-26`，本次无法完成 `2026-03-28` 分区补齐。当前状态应定义为：**ETL 运行成功，目标分区补齐失败（源数据缺失导致阻塞）**。
