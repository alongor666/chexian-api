# 品牌车型维度知识库 (Brand Dimension Knowledge)

**更新时间**: 2026-05-12
**当前行数**: 371,359
**数据源**: `06_厂牌明细*.xlsx` -> `pipelines/convert_brand_dim.py` -> `warehouse/dim/brand/latest.parquet`

---

## 1. 当前 schema

`warehouse/dim/brand/latest.parquet` 是厂牌明细维表，不再是历史的“保单厂牌车型字符串解析表”。

核心字段：

| 字段 | 含义 | 用途 |
|:---|:---|:---|
| `vehicle_model_code` | 车辆型号（上传平台） | 厂牌明细主键 |
| `vehicle_model_name` | 厂牌车型名称 | 与 `PolicyFact.vehicle_model` 连接 |
| `brand` | 品牌 | 品牌下钻 |
| `manufacturer` | 生产厂家 | 厂家下钻 |
| `series_name` | 车系名称 | 车系下钻 |
| `vehicle_class` | 新车型分类名称 | 车型分类、摩托车/货车/客车识别 |
| `seat_count` | 座位数 | 客车/乘用车辅助维度 |
| `curb_weight` | 整备质量 | 车辆属性辅助维度 |
| `tonnage_value` | 吨位数 | 货车辅助维度 |

---

## 2. 标准 JOIN 口径

```sql
SELECT
  p.vehicle_frame_no,
  p.vehicle_model,
  b.brand,
  b.manufacturer,
  b.vehicle_class,
  b.seat_count,
  b.curb_weight
FROM read_parquet('warehouse/fact/policy/current/*.parquet', union_by_name=true) p
LEFT JOIN read_parquet('warehouse/dim/brand/latest.parquet') b
  ON p.vehicle_model = b.vehicle_model_name;
```

统一规则：

- 保单事实表连接键：`PolicyFact.vehicle_model`
- 厂牌维表连接键：`BrandDim.vehicle_model_name`
- 品牌车型汇总键：`brand || '_' || vehicle_class`
- 不再使用历史字段：`vehicle_model`、`brand_usage`、`usage_category`、`品牌_用途`

---

## 3. 摩托车识别

厂牌维表可以把已有保单 VIN 反查到车型分类：

```sql
WITH joined AS (
  SELECT p.vehicle_frame_no, p.vehicle_model, b.vehicle_class
  FROM read_parquet('warehouse/fact/policy/current/*.parquet', union_by_name=true) p
  LEFT JOIN read_parquet('warehouse/dim/brand/latest.parquet') b
    ON p.vehicle_model = b.vehicle_model_name
  WHERE p.vehicle_frame_no IS NOT NULL
    AND TRIM(p.vehicle_frame_no) <> ''
)
SELECT COUNT(DISTINCT vehicle_frame_no)
FROM joined
WHERE vehicle_class LIKE '%摩托%';
```

本项目正式经营口径仍优先使用 `customer_category = '摩托车'`；`vehicle_class LIKE '%摩托%'` 是车型维表补充识别能力，适合做 VIN 级校验、车型补全和异常排查。

---

## 4. 已核验数字

截至 2026-05-12 本地 parquet：

| 项目 | 数量 |
|:---|---:|
| 厂牌维表行数 | 371,359 |
| 保单唯一 `vehicle_model` | 38,058 |
| 可匹配 `vehicle_model_name` | 37,080 |
| 有 `vehicle_frame_no + vehicle_model` 的 VIN | 1,268,082 |
| 能通过厂牌维表识别分类的 VIN | 1,253,653 |
| `vehicle_class LIKE '%摩托%'` 的 VIN | 521,493 |
