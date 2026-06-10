---
name: chexian-data-trends
description: 时间趋势分析（月度/周度趋势、环比增长、异常检测）。当用户说"趋势"/"增长"/"环比"/"异常波动"/"最近几周"时触发。
category: data-analysis
version: 1.1.0
author: "@claude"
tags: ["trends","growth","anomaly"]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts
  - server/src/sql/trend.ts
  - server/src/sql/trend/total-trend.ts
  - server/src/sql/trend/mom.ts
  - server/src/sql/growth.ts
  - server/src/config/field-registry/fields.json
parent_command: chexian-data-analysis
last_updated: "2026-06-09"
---

# 时间趋势分析

分析业务数据的时间趋势和异常波动。

## 分析内容

### 1. 月度趋势
- 月度保费与件数（按 `insurance_start_date` 截取年月分组）
- 环比增长率：SUM(本月保费) / SUM(上月保费) - 1

### 2. 周度趋势
- 最近 12 周数据（按签单周分组）
- 周度波动分析

### 3. 异常检测口径（业务定义）
以下情形标记为异常并需人工说明：
- 单月/单周环比增长率 > 100%（倍增，通常为批量导入或口径变化）
- 单月/单周环比降幅 < -50%（折半，通常为数据截断或业务萎缩）
- 单日保费峰值超过月均日保费的 5 倍
- 连续 3 天及以上保费为 0（节假日除外）

**环比口径说明**：环比 = 与上一个自然月对比，不做季节调整。**禁止**对月度环比率做跨月平均或二次汇总，需直接用 SUM(分子)/SUM(分母) 重算。

## 使用示例

```bash
/chexian-data-trends
/chexian-data-trends --period month
/chexian-data-trends --period week --last 12
```

## 执行协议

### 数据源

月度趋势（Parquet 直查）：

```bash
duckdb -c "
SELECT
  STRFTIME(insurance_start_date, '%Y-%m') AS month,
  COUNT(DISTINCT policy_no) AS policy_count,
  SUM(premium) AS total_premium
FROM '数据管理/warehouse/fact/policy/current/*.parquet'
WHERE endorsement_type IS NULL OR endorsement_type = ''
GROUP BY month
ORDER BY month
"
```

或走 API：

```bash
curl -s 'localhost:3000/api/query/trend' | jq '.data | length'
```

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

| 字段名 | 含义 |
|--------|------|
| `insurance_start_date` | 承保起期（月度/周度分组锚点） |
| `policy_no` | 保单号（件数去重计数） |
| `premium` | 保费（净额 SUM） |
| `org_level_3` | 三级机构（趋势下钻维度） |
| `customer_category` | 客户类别（11 类，续保/新车趋势拆分） |
| `is_nev` | 是否新能源 |
| `endorsement_type` | 批改类型（空串 = 原单，排除批改副本） |

**率值聚合铁律**：环比增长率必须 SUM(本期分子)/SUM(上期分母) - 1，禁止对各机构的环比率取平均。

### SQL 模块参考

- `server/src/sql/trend.ts` — 趋势主入口（调度各子模块）
- `server/src/sql/trend/total-trend.ts` — 全量月度/周度趋势
- `server/src/sql/trend/mom.ts` — 环比（月对月）计算逻辑
- `server/src/sql/growth.ts` — 增长分析（含同比/环比）

### 验证

```bash
curl -s localhost:3000/api/query/trend | jq '.data | length'
# 期望返回非空数组；结合 | jq '.data[-3:]' 看最近 3 个周期数据是否合理
```
