---
name: chexian-data-kpi
description: 业绩分析与排名（Top30业务员、机构对比、四象限分层）。当用户说"排名"/"业绩"/"四象限"/"哪个业务员最强"时触发。
category: data-analysis
version: 1.1.0
author: "@claude"
tags: ["kpi","ranking","performance"]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts
  - server/src/sql/kpi.ts
  - server/src/sql/salesman-ranking.ts
  - server/src/sql/performance-analysis.ts
  - server/src/config/field-registry/fields.json
parent_command: chexian-data-analysis
last_updated: "2026-06-09"
---

# 业绩分析与排名

对业务员和机构进行多维度业绩分析和四象限分层。

## 分析内容

### 1. 业务员排名
- Top 30 业务员（按保费降序）
- 保费区间分布统计
- 多维度指标（续保率、新能源占比等）

### 2. 机构业绩对比
- 各机构全维度横向对比（保费、件数、赔付率）
- 人均产能分析

### 3. 四象限分层（核心业务定义）
四象限以**件数中位数**和**人均保费中位数**为轴：
- Q1 明星业务员：件数高 + 人均保费高
- Q2 大单专家：件数低 + 人均保费高（大客户型）
- Q3 新手待培养：件数低 + 人均保费低
- Q4 效率待提升：件数高 + 人均保费低

## 使用示例

```bash
/chexian-data-kpi
/chexian-data-kpi --top 50
```

## 执行协议

### 数据源

优先 Parquet 直查（口径验证用）：

```bash
duckdb -c "
SELECT
  salesman_name,
  org_level_3,
  COUNT(DISTINCT policy_no) AS policy_count,
  SUM(premium) AS total_premium
FROM '数据管理/warehouse/fact/policy/current/*.parquet'
WHERE endorsement_type IS NULL OR endorsement_type = ''
GROUP BY salesman_name, org_level_3
ORDER BY total_premium DESC
LIMIT 30
"
```

或走 API（需本地服务运行）：

```bash
curl -s localhost:3000/api/query/kpi | jq '.data | length'
curl -s localhost:3000/api/query/salesman | jq '.data[0]'
```

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

| 字段名 | 含义 |
|--------|------|
| `policy_no` | 保单号（含批改为多行，统计件数需去重） |
| `premium` | 保费（净额，SUM 聚合） |
| `salesman_name` | 业务员姓名 |
| `org_level_3` | 三级机构（最细粒度组织维度） |
| `customer_category` | 客户类别（11 类枚举） |
| `is_renewal` | 是否续保 |
| `is_nev` | 是否新能源 |
| `endorsement_type` | 批改类型（过滤原单时排除非空批改） |

**率值聚合铁律**：满期赔付率 = SUM(赔款分子) / SUM(满期保费)，禁止对率值做加权平均或二次汇总。

### SQL 模块参考

- `server/src/sql/kpi.ts` — KPI 聚合主逻辑
- `server/src/sql/salesman-ranking.ts` — 业务员排名 SQL
- `server/src/sql/performance-analysis.ts` — 机构绩效分析

### 验证

```bash
curl -s localhost:3000/api/query/kpi | jq '.data | length'
# 期望返回非零数组
```
