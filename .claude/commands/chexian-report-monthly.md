---
name: chexian-report-monthly
description: 生成月报（自然月数据，同比对比）。当用户说"月报"/"上个月报告"/"自然月分析"/"同比"时触发。
category: reporting
version: 1.2.0
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
last_updated: "2026-06-27"
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
/chexian-report-monthly --province SX --month 2025-12
/chexian-report-monthly --province SC --month 2025-12
```

## 报告内容

- 自然月 KPI（保费、件数、赔付率、费用率）
- 同比：与 `YYYY-1` 年同月对比（绝对值差 + 百分比差）
- 各机构横向对比
- 险类结构分析（商业险/交强险）
- 业务洞察（自动标注显著同比异动项）

## 执行协议

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--province <SC\|SX>` | **是** | 省份隔离（见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）。SC=四川 / SX=山西。**禁默认四川**；未注册省份 fail-closed 报错 |
| `--month <YYYY-MM>` | 否 | 目标自然月（默认上一个已过完整月份）；展开为闭开区间 `[月初 00:00, 下月初 00:00)` |

> ⚠️ **同比为跨口径对比**：月报同比 = 与上一年同自然月并列。按 [时间口径反问协议](../rules/time-caliber-disambiguation.md) 的「跨口径横向对比」触发，确认两月均为同一日期锚点（承保起期），**禁滚动 12 周均值替代**。本技能口径挂靠 [SSOT](../rules/skill-caliber-ssot.md)，不内联。

### 数据源

**省份隔离前置**（必读 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）：`--province` 同时驱动 `read_parquet` glob 与 `WHERE branch_code`，二者缺一不可（裸 `*.parquet` 跨省混查且静默不报错）。

| `--province` | `read_parquet(...)` glob | `WHERE branch_code` |
|--------------|--------------------------|---------------------|
| `SX`（山西）| `'数据管理/warehouse/fact/policy/current/SX_*.parquet'` | `'SX'` |
| `SC`（四川）| `['数据管理/warehouse/fact/policy/current/[0-9]*.parquet','数据管理/warehouse/fact/policy/current/sichuan_*.parquet']` | `'SC'` |

> ⚠️ 四川两类文件名必须用 `read_parquet([...])` **列表形式**；DuckDB 不支持 brace `{a,b}`（实测 `IO Error`）。worktree 无 Parquet，须把 `数据管理/` 换成主仓绝对路径。

**当月保费（净额口径；以下为 `--province SX --month 2025-12` 展开后的 SQL，2026-06-27 实测零 Binder Error）**：

```bash
duckdb -c "
WITH eligible AS (
  SELECT policy_no, org_level_3, SUM(premium) AS premium
  FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true)
  WHERE branch_code = 'SX'                                  -- 省份隔离（权威键）
    AND insurance_start_date >= TIMESTAMP '2025-12-01'      -- 自然月闭开区间（禁列上 CAST 损裁剪）
    AND insurance_start_date <  TIMESTAMP '2026-01-01'
  GROUP BY policy_no, org_level_3                            -- 机构进 group key，消 ANY_VALUE 影子口径
  HAVING SUM(premium) > 0                                   -- 净额止血：合并批改、排退保
)
SELECT org_level_3, COUNT(*) AS policy_count, SUM(premium) AS total_premium
FROM eligible GROUP BY org_level_3 ORDER BY total_premium DESC
"
```

> **同比（上年同月）**：把净额 CTE 的日期区间整体往前移 12 个月（如 `--month 2025-12` 的同比基准 = `[2024-12-01, 2025-01-01)`），其余口径不变；同比差 = 本月率/值 − 上年同月率/值。四川可走 API（山西 GATED，API 不返回 SX）：`curl -s localhost:3000/api/query/report | jq '.data | length'`。

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

> ⚠️ 字段须**同时**在 `fields.json` 注册 **且** Parquet 实际落列；前者有、后者无即 `Binder Error`（如 `endorsement_type`）。新增字段务必 duckdb 直查 Parquet 确认存在再写入命令。

| 字段名 | 含义 |
|--------|------|
| `insurance_start_date` | 承保起期（自然月边界过滤锚点；`TIMESTAMP` 类型）|
| `policy_no` | 保单号（件数去重 `COUNT(DISTINCT policy_no)`）|
| `premium` | 保费（净额；批改正负行在 `GROUP BY policy_no`[+维度] 内 `SUM` 合并）|
| `branch_code` | **省份隔离键**（`SC` / `SX`，ETL 注入；所有查询必带 `WHERE branch_code`，见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）|
| `org_level_3` | 三级机构 |
| `insurance_type` | 险类 |
| `is_renewal` | 是否续保 |
| `customer_category` | 客户类别（11 类）|
| `endorsement_no` | 批改单号（varchar）。净额口径已由 `SUM(premium)+HAVING>0` 合并批改，无需按批改类型过滤。⚠️ `endorsement_type` 虽在 `fields.json` 注册但 **ETL 未落 Parquet**，引用即 `Binder Error` |

**率值聚合铁律**：满期赔付率 = SUM(赔款) / SUM(满期保费)，同比差 = 本月率 - 上年同月率。禁止对各机构赔付率取算术平均后求差。

### SQL 模块参考

- `server/src/sql/kpi.ts` — KPI 聚合主逻辑
- `server/src/sql/trend/yoy.ts` — 同比（年对年）计算逻辑
- `server/src/sql/trend/ytd.ts` — 年初至今口径（月报辅助视角）
- `server/src/sql/cost/cost-ratios.ts` — 满期赔付率权威 CTE（赔款分子口径）

### 验证

```bash
# 山西 GATED：API 不返回 SX，须 duckdb 直查（worktree 用主仓绝对路径）
duckdb -c "WITH eligible AS (SELECT policy_no, org_level_3, SUM(premium) p FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true) WHERE branch_code='SX' AND insurance_start_date>=TIMESTAMP '2025-12-01' AND insurance_start_date<TIMESTAMP '2026-01-01' GROUP BY policy_no, org_level_3 HAVING SUM(premium)>0) SELECT org_level_3, COUNT(*) policy_count, ROUND(SUM(p)/10000,1) total_wan FROM eligible GROUP BY org_level_3 ORDER BY total_wan DESC LIMIT 5"
# 期望（2026-06-27 实测，SX 2025-12）：非空机构排名，如 临汾 ≈ 6346 件 / 418 万元居首

# 四川可走 API（需本地服务）
curl -s localhost:3000/api/query/report | jq '.data | length'
# 期望返回非空；结合 | jq '.data[0]' 确认日期字段在目标自然月区间内
```
