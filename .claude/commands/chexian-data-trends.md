---
name: chexian-data-trends
description: 时间趋势分析（月度/周度趋势、环比增长、异常检测）。当用户说"趋势"/"增长"/"环比"/"异常波动"/"最近几周"时触发。
category: data-analysis
version: 1.2.0
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
last_updated: "2026-06-27"
---

# 时间趋势分析

分析业务数据的时间趋势和异常波动。

## 分析内容

### 1. 月度趋势
- 月度保费与件数（按保单承保起期 `insurance_start_date` 截取年月分组）
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
/chexian-data-trends --province SX --period month
/chexian-data-trends --province SC --period week --last 12
```

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--province <SC\|SX>` | **是** | 省份隔离（见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）。SC=四川 / SX=山西。**禁默认四川**；未注册省份 fail-closed 报错 |
| `--period <month\|week>` | 否 | 趋势粒度（默认 month）|
| `--last <N>` | 否 | 仅看最近 N 个周期（如 `--period week --last 12`）|

> ⚠️ **时间口径未明先反问**：若用户只给"最近 / 近期"等模糊窗口，按 [时间口径反问协议](../rules/time-caliber-disambiguation.md) 先澄清周期粒度与日期锚点（承保起期 vs 签单日），**禁自由选口径**。本技能口径挂靠 [SSOT](../rules/skill-caliber-ssot.md)，不内联。

## 执行协议

### 数据源

**省份隔离前置**（必读 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）：`--province` 同时驱动 `read_parquet` glob 与 `WHERE branch_code`，二者缺一不可（裸 `*.parquet` 跨省混查且静默不报错）。

| `--province` | `read_parquet(...)` glob | `WHERE branch_code` |
|--------------|--------------------------|---------------------|
| `SX`（山西）| `'数据管理/warehouse/fact/policy/current/SX_*.parquet'` | `'SX'` |
| `SC`（四川）| `['数据管理/warehouse/fact/policy/current/[0-9]*.parquet','数据管理/warehouse/fact/policy/current/sichuan_*.parquet']` | `'SC'` |

> ⚠️ 四川两类文件名必须用 `read_parquet([...])` **列表形式**；DuckDB 不支持 brace `{a,b}`（实测 `IO Error`）。worktree 无 Parquet，须把 `数据管理/` 换成主仓绝对路径。

**月度趋势（净额口径；以下为 `--province SX --period month` 展开后的 SQL，2026-06-27 实测零 Binder Error）**：

```bash
duckdb -c "
WITH eligible AS (
  SELECT policy_no,
         STRFTIME(MIN(insurance_start_date), '%Y-%m') AS month,  -- 同一保单承保起期一致，MIN 确定化（消 ANY_VALUE 影子口径）
         SUM(premium) AS premium
  FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true)
  WHERE branch_code = 'SX'                                       -- 省份隔离（权威键）
  GROUP BY policy_no                                             -- 保单粒度合并批改正负行
  HAVING SUM(premium) > 0                                        -- 净额止血：排退保 / 全额冲销
)
SELECT month, COUNT(*) AS policy_count, SUM(premium) AS total_premium
FROM eligible GROUP BY month ORDER BY month
"
```

> **周度同理**：把月份键 `STRFTIME(MIN(insurance_start_date), '%Y-%m')` 换成按周（如 `STRFTIME(MIN(insurance_start_date), '%Y-W%W')`），净额 CTE 与省份隔离不变。环比 = 本期 ÷ 上期 - 1，在外层结果上算（窗口函数 `LAG`），**不可对各机构环比率取平均**。

**四川可走 API**（本地服务运行时；山西 GATED，API 不返回 SX）：

```bash
curl -s 'localhost:3000/api/query/trend' | jq '.data | length'
```

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

> ⚠️ 字段须**同时**在 `fields.json` 注册 **且** Parquet 实际落列；前者有、后者无即 `Binder Error`（如 `endorsement_type`）。新增字段务必 duckdb 直查 Parquet 确认存在再写入命令。

| 字段名 | 含义 |
|--------|------|
| `insurance_start_date` | 承保起期（月度/周度分组锚点；`TIMESTAMP` 类型）|
| `policy_no` | 保单号（件数去重计数 `COUNT(DISTINCT policy_no)`）|
| `premium` | 保费（净额；批改正负行在 `GROUP BY policy_no` 内 `SUM` 合并）|
| `branch_code` | **省份隔离键**（`SC` / `SX`，ETL 注入；所有查询必带 `WHERE branch_code`，见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）|
| `org_level_3` | 三级机构（趋势下钻维度）|
| `customer_category` | 客户类别（11 类，续保/新车趋势拆分）|
| `is_nev` | 是否新能源 |
| `endorsement_no` | 批改单号（varchar）。净额口径已由 `SUM(premium)+HAVING>0` 合并批改，无需按批改类型过滤排除批改副本。⚠️ `endorsement_type` 虽在 `fields.json` 注册但 **ETL 未落 Parquet**，引用即 `Binder Error` |

**率值聚合铁律**：环比增长率必须 SUM(本期分子)/SUM(上期分母) - 1，禁止对各机构的环比率取平均。

### SQL 模块参考

- `server/src/sql/trend.ts` — 趋势主入口（调度各子模块）
- `server/src/sql/trend/total-trend.ts` — 全量月度/周度趋势
- `server/src/sql/trend/mom.ts` — 环比（月对月）计算逻辑
- `server/src/sql/growth.ts` — 增长分析（含同比/环比）

### 验证

```bash
# 山西 GATED：API 不返回 SX，须 duckdb 直查（worktree 用主仓绝对路径）
duckdb -c "WITH eligible AS (SELECT policy_no, STRFTIME(MIN(insurance_start_date),'%Y-%m') month, SUM(premium) p FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true) WHERE branch_code='SX' GROUP BY policy_no HAVING SUM(premium)>0) SELECT month, COUNT(*) policy_count, ROUND(SUM(p)/10000,1) total_wan FROM eligible GROUP BY month ORDER BY month DESC LIMIT 6"
# 期望（2026-06-27 实测）：非空逐月序列，如 2026-03 ≈ 31268 件 / 2618 万元（山西开门红峰值）

# 四川可走 API（需本地服务）
curl -s localhost:3000/api/query/trend | jq '.data | length'
# 期望返回非空数组；结合 | jq '.data[-3:]' 看最近 3 个周期数据是否合理
```
