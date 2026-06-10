---
name: chexian-report-custom
description: 自定义报告生成（灵活时间范围，自定义维度）。当用户说"自定义报告"/"指定时间段"/"灵活维度"/"任意区间分析"时触发。
category: reporting
version: 1.1.0
author: "@claude"
tags: ["custom","flexible","report"]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts
  - server/src/sql/kpi.ts
  - server/src/sql/trend.ts
  - server/src/sql/cost/cost-ratios.ts
  - server/src/routes/query/report.ts
  - server/src/config/field-registry/fields.json
parent_command: chexian-report
last_updated: "2026-06-09"
---

# 自定义报告生成

生成任意时间范围和维度组合的业务报告，不受周报滚动 8 周或月报自然月边界限制。

## 适用场景

- 跨季度专项分析（如 Q3 完整经营复盘）
- 特定机构 + 险类 + 时间区间的交叉分析
- 非标准时间窗口（如节假日前后 7 天对比）

## 使用示例

```bash
/chexian-report-custom --start 2025-10-01 --end 2025-12-31
/chexian-report-custom --dimensions 机构,险类 --start 2025-12-01
```

## 支持的分析维度

| 维度 | 字段名 |
|------|--------|
| 机构 | `org_level_3` |
| 险类 | `insurance_type` |
| 续保状态 | `is_renewal` |
| 新能源 | `is_nev` |
| 批改类型 | `endorsement_type` |
| 客户类别 | `customer_category` |

## 执行协议

### 参数说明

- `--start` / `--end`：时间区间，格式 `YYYY-MM-DD`，以 `insurance_start_date` 过滤
- `--dimensions`：逗号分隔的分析维度，多维度时做交叉 GROUP BY
- 默认输出：终端表格；加 `--output <路径>` 写入 Markdown 文件

### 数据源

```bash
duckdb -c "
SELECT
  org_level_3,
  insurance_type,
  COUNT(DISTINCT policy_no) AS policy_count,
  SUM(premium) AS total_premium
FROM '数据管理/warehouse/fact/policy/current/*.parquet'
WHERE
  (endorsement_type IS NULL OR endorsement_type = '')
  AND insurance_start_date >= '2025-10-01'
  AND insurance_start_date <= '2025-12-31'
GROUP BY org_level_3, insurance_type
ORDER BY total_premium DESC
"
```

或走 API（支持任意日期区间的查询）：

```bash
curl -s 'localhost:3000/api/query/report' | jq '.data | length'
```

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

| 字段名 | 含义 |
|--------|------|
| `insurance_start_date` | 承保起期（时间区间过滤锚点） |
| `policy_no` | 保单号（件数去重） |
| `premium` | 保费（净额 SUM） |
| `org_level_3` | 三级机构 |
| `insurance_type` | 险类（商业险/交强险） |
| `is_renewal` | 是否续保 |
| `is_nev` | 是否新能源 |
| `customer_category` | 客户类别（11 类） |

**率值聚合铁律**：赔付率、费用率等比值必须 SUM(分子)/SUM(分母)，禁止对各维度的率值做加权平均或二次汇总。

### SQL 模块参考

- `server/src/sql/kpi.ts` — 核心 KPI 聚合（含自定义日期区间 WHERE 模板）
- `server/src/sql/cost/cost-ratios.ts` — 满期赔付率权威 CTE

### 验证

```bash
curl -s localhost:3000/api/query/report | jq '.data | length'
```
