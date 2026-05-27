# 客户来源去向 (customer_flow) — 数据源说明

> 最后更新: 2026-05-24 · 08/09 双产物合成口径

## 1. 业务定义

- **previous_insurer**（上年承保主体）：保单上一年由哪家保险公司承保。
- **next_insurer**（次年保险公司）：保单到期后客户去了哪家保险公司。
- 一行记录 = 一张华安保单 + 它可识别的「来源」或「去向」信息。

下游仍读取固定路径：

`数据管理/warehouse/fact/customer_flow/latest.parquet`

## 2. 当前源文件

旧的 `客户来源去向` Excel 已不再产生。当前由两个 BI 产物合成原 customer_flow schema：

| 产物 | 命名 | 业务字段 | 日期逻辑 |
|---|---|---|---|
| 08_商业险续保流失公司 | `YYYYMMDD_08_商业险续保流失公司.xlsx` | `次年保险公司` -> `next_insurer` | 起始日期按规则为 2025-01-01 |
| 09_商业险转保上年公司 | `YYYYMMDD_09_商业险转保上年公司.xlsx` | `上年承保主体` -> `previous_insurer` | 起始日期按规则为 2026-01-01 |

文件名前缀 `YYYYMMDD` 使用更新年月日/批次日期，不等同于单日保险起期。

## 3. ETL 处理逻辑

入口：

`node 数据管理/daily.mjs customer_flow`

转换脚本：

`数据管理/pipelines/convert_customer_flow.py`

处理步骤：

1. 同批次加载 08、09 两个 Excel。
2. 将源字段标准化到原 schema：
   - `保单号` -> `policy_no`
   - `保险起期` -> `insurance_start_date`
   - `车架号` -> `vehicle_frame_no`
   - `上年承保主体` -> `previous_insurer`
   - `次年保险公司` -> `next_insurer`
3. 按 `(policy_no, insurance_start_date)` 合并重叠记录，保留每个非空字段的首个有效值。
4. 输出精简后的有效列：
   `policy_no`, `insurance_start_date`, `vehicle_frame_no`, `previous_insurer`, `next_insurer`。
5. 写入临时 parquet，先做候选校验，通过后再原子替换 `latest.parquet`。

## 4. 当前校验护栏

`数据管理/data-sources.json` 为 `customer_flow` 配置：

- `input_strategy`: `multi_file_input`
- `min_rows`: 180000
- `expect_dates_continuous`: true
- `require_non_null`: `previous_insurer`, `next_insurer`
- `min_date`: `2025-01-01`

这些护栏用于防止只处理单个产物、空文件、字段全空或日期断档后覆盖生产 parquet。

## 5. 20260523 批次验收基线

本批次源文件：

- `20260523_08_商业险续保流失公司.xlsx`：192,328 行
- `20260523_09_商业险转保上年公司.xlsx`：24,278 行

ETL 输出：

- 行数：185,476
- `previous_insurer` 非空：12,971
- `next_insurer` 非空：8,466
- 字段数：5
- 日期范围：2025-01-01 ~ 2026-06-22
- 日期连续：538 / 538 天，无缺口

## 6. 历史说明

2026-05-24 之前的文档描述过 `08_客户来源去向*.xlsx` 多文件历史合并和 `merge_with_history` 口径。该口径对应旧产物链路，当前不再适用。
