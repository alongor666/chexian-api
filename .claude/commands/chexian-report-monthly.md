---
name: chexian-report-monthly
description: 生成月报（自然月数据，同比对比）。当用户说"月报"/"上个月报告"/"自然月分析"/"同比"时触发。
category: reporting
version: 1.1.0
author: "@claude"
tags: ["monthly","report","yoy"]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts
  - server/src/sql/kpi.ts
  - server/src/sql/trend/yoy.ts
  - server/src/sql/trend/ytd.ts
  - server/src/sql/cost/cost-ratios.ts
  - server/src/routes/query/report.ts
  - server/src/config/field-registry/fields.json
parent_command: chexian-report
last_updated: "2026-06-09"
---

# 月报生成

生成指定自然月的业务月报。

## 与周报的本质区别（RED LINE）

| 维度 | 月报（本命令） | 周报（/chexian-report-weekly） |
|------|------------|--------------------------|
| 时间边界 | **自然月**：1 日 00:00 至月末 23:59 | 滚动 8 周（以当周周六为截止） |
| 对比口径 | **同比**：与上一年同月对比 | 环比：与上周/上期对比 |
| 典型用途 | 月度经营会、月度 KPI 考核 | 日常巡检、周度经营例会 |

**禁止混用**：月报不得使用滚动 8 周口径；月报同比必须精确到"上一年同自然月"，不得用滚动 12 周均值替代。

## 使用示例

```bash
/chexian-report-monthly
/chexian-report-monthly --month 2025-12
```

## 报告内容

- 自然月 KPI（保费、件数、赔付率、费用率）
- 同比：与 `YYYY-1` 年同月对比（绝对值差 + 百分比差）
- 各机构横向对比
- 险类结构分析（商业险/交强险）
- 业务洞察（自动标注显著同比异动项）

## 执行协议

### 参数说明

- `--month`：目标自然月，格式 `YYYY-MM`，默认为上一个已过完整月份
- 时间过滤锚点：`insurance_start_date >= 月初第 1 天` AND `insurance_start_date < 下月第 1 天`

### 数据源

当月保费（Parquet 直查）：

<!-- governance-field-gate: allow 存量影子口径 endorsement_type，推广审计 task_ea580007 待修（照 K1 改净额+省份隔离后删本注释） -->
```bash
duckdb -c "
SELECT
  org_level_3,
  COUNT(DISTINCT policy_no) AS policy_count,
  SUM(premium) AS total_premium
FROM '数据管理/warehouse/fact/policy/current/*.parquet'
WHERE
  (endorsement_type IS NULL OR endorsement_type = '')
  AND insurance_start_date >= '2025-12-01'
  AND insurance_start_date < '2026-01-01'
GROUP BY org_level_3
ORDER BY total_premium DESC
"
```

同比（上年同月）：日期区间整体往前移 12 个月，其余逻辑相同。API 方式：`curl -s localhost:3000/api/query/report | jq '.data | length'`

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

| 字段名 | 含义 |
|--------|------|
| `insurance_start_date` | 承保起期（自然月边界过滤锚点） |
| `policy_no` | 保单号（件数去重） |
| `premium` | 保费（净额 SUM） |
| `org_level_3` | 三级机构 |
| `insurance_type` | 险类 |
| `is_renewal` | 是否续保 |
| `customer_category` | 客户类别（11 类） |
| `endorsement_type` | 批改类型（空串 = 原单） |

**率值聚合铁律**：满期赔付率 = SUM(赔款) / SUM(满期保费)，同比差 = 本月率 - 上年同月率。禁止对各机构赔付率取算术平均后求差。

### SQL 模块参考

- `server/src/sql/kpi.ts` — KPI 聚合主逻辑
- `server/src/sql/trend/yoy.ts` — 同比（年对年）计算逻辑
- `server/src/sql/trend/ytd.ts` — 年初至今口径（月报辅助视角）
- `server/src/sql/cost/cost-ratios.ts` — 满期赔付率权威 CTE（赔款分子口径）

### 验证

```bash
curl -s localhost:3000/api/query/report | jq '.data | length'
# 期望返回非空；结合 | jq '.data[0]' 确认日期字段在目标自然月区间内
```
