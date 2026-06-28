---
name: chexian-data-profile
description: 数据概览与质量检查（基础统计、字段完整性、保费分布百分位）。当用户说"数据质量"/"概览"/"缺失值"/"分布"时触发。
category: data-analysis
version: 1.1.0
author: "@claude"
tags: ["profiling","quality","statistics"]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts
  - server/src/sql/kpi.ts
  - server/src/config/field-registry/fields.json
parent_command: chexian-data-analysis
last_updated: "2026-06-09"
---

# 数据概览与质量检查

对车险业务数据执行基础统计、字段完整性和保费分布分析。

## 分析内容

### 1. 基础统计
- 保单总数（去重 `policy_no`，排除批改副本）
- 业务员数、机构数
- 总保费（SUM 净额）、平均保费、标准差
- 数据时间跨度（`insurance_start_date` MIN ~ MAX）

### 2. 字段完整性
- 核心字段缺失率统计（NULL 或空串）
- 数据质量评分（完整率 = 非空行数 / 总行数）

### 3. 保费分布（异常值规则）
百分位分析：P05、P25、P50、P75、P95、P99

**异常值判定口径**：
- 单保单保费 < P05 或 > P99 → 标记为潜在异常
- 保费 ≤ 0 → 必须人工复核（批改冲销行）

## 使用示例

```bash
/chexian-data-profile
/chexian-data-profile --output report.md
```

## 执行协议

### 数据源

<!-- governance-field-gate: allow 存量影子口径 endorsement_type，推广审计 task_ea580007 待修（照 K1 改净额+省份隔离后删本注释） -->
```bash
duckdb -c "
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT policy_no) AS unique_policies,
  COUNT(DISTINCT salesman_name) AS salesman_count,
  COUNT(DISTINCT org_level_3) AS org_count,
  SUM(premium) AS total_premium,
  AVG(premium) AS avg_premium,
  STDDEV(premium) AS std_premium,
  MIN(insurance_start_date) AS date_min,
  MAX(insurance_start_date) AS date_max
FROM '数据管理/warehouse/fact/policy/current/*.parquet'
WHERE endorsement_type IS NULL OR endorsement_type = ''
"
```

百分位（在上述 duckdb 查询中追加）：

```sql
PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY premium) AS p05,
PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY premium) AS p50,
PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY premium) AS p95,
PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY premium) AS p99
```

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

| 字段名 | 含义 |
|--------|------|
| `policy_no` | 保单号（原单+批改多行，需去重） |
| `premium` | 保费（净额） |
| `insurance_start_date` | 承保起期（时间范围锚点） |
| `salesman_name` | 业务员姓名 |
| `org_level_3` | 三级机构 |
| `endorsement_type` | 批改类型（空串 = 原单） |
| `customer_category` | 客户类别（11 类枚举，完整性核心字段） |
| `is_nev` | 是否新能源 |

**率值聚合铁律**：任何比率必须 SUM(分子)/SUM(分母)，禁止对率值做加权平均或二次汇总。

### SQL 模块参考

- `server/src/sql/kpi.ts` — 基础 KPI 聚合（含保费 SUM 逻辑）

### 验证

```bash
curl -s localhost:3000/api/query/kpi | jq '.data | length'
# 期望返回非零，证明 Parquet 可读且 API 通
```
