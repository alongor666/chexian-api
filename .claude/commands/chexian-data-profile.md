---
name: chexian-data-profile
description: 数据概览与质量检查（基础统计、字段完整性、保费分布百分位）。当用户说"数据质量"/"概览"/"缺失值"/"分布"时触发。
category: data-analysis
version: 1.2.0
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
last_updated: "2026-06-27"
---

# 数据概览与质量检查

对车险业务数据执行基础统计、字段完整性和保费分布分析。

## 分析内容

### 1. 基础统计
- 净额保单数（保单粒度合并批改后 `COUNT(*)`）与原始行数（含批改副本）
- 业务员数、机构数（`COUNT(DISTINCT)`）
- 总保费（保单级净额 `SUM`）、件均净额保费、标准差
- 数据时间跨度（`insurance_start_date` MIN ~ MAX）

### 2. 字段完整性
- 核心字段缺失率统计（NULL 或空串）
- 数据质量评分（完整率 = 非空行数 / 总行数）

### 3. 保费分布（异常值规则）
百分位分析（净额保单级）：P05、P25、P50、P75、P95、P99

**异常值判定口径**（净额保单级，除非注明）：
- 单保单净额保费 < P05 或 > P99 → 标记为潜在异常
- 净额 ≤ 0 的保单已被净额 CTE 的 `HAVING SUM(premium)>0` 排除（退保 / 全额冲销）；其原始负数批改行仍计入「数据覆盖范围」的 `raw_rows`，二者之差即批改 / 冲销行数，是数据质量观察项

## 使用示例

```bash
/chexian-data-profile --province SX
/chexian-data-profile --province SC --output report.md
```

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--province <SC\|SX>` | **是** | 省份隔离（见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）。SC=四川 / SX=山西。**禁默认四川**；未注册省份 fail-closed 报错 |
| `--output <路径>` | 否 | 写入 Markdown 文件（默认输出终端表格）|

> 数据概览为**全量口径**（不限时间窗口），故无时间参数；如需限定区间请用 [/chexian-report-custom](./chexian-report-custom.md)。本技能口径一律挂靠 SSOT、禁内联（见 [技能口径挂靠 SSOT](../rules/skill-caliber-ssot.md)）。

## 执行协议

### 数据源

**省份隔离前置**（必读 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）：`--province` 同时驱动 `read_parquet` glob 与 `WHERE branch_code`，二者缺一不可（裸 `*.parquet` 跨省混查且静默不报错）。

| `--province` | `read_parquet(...)` glob | `WHERE branch_code` |
|--------------|--------------------------|---------------------|
| `SX`（山西）| `'数据管理/warehouse/fact/policy/current/SX_*.parquet'` | `'SX'` |
| `SC`（四川）| `['数据管理/warehouse/fact/policy/current/[0-9]*.parquet','数据管理/warehouse/fact/policy/current/sichuan_*.parquet']` | `'SC'` |

> ⚠️ 四川两类文件名必须用 `read_parquet([...])` **列表形式**；DuckDB 不支持 brace `{a,b}`（实测 `IO Error`）。worktree 无 Parquet，须把 `数据管理/` 换成主仓绝对路径。

**基础统计（净额保单口径；以下为 `--province SX` 展开后的 SQL，2026-06-27 实测零 Binder Error）**：

```bash
duckdb -c "
WITH eligible AS (
  SELECT policy_no, SUM(premium) AS premium
  FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true)
  WHERE branch_code = 'SX'                                 -- 省份隔离（权威键）
  GROUP BY policy_no                                       -- 保单粒度合并批改正负行
  HAVING SUM(premium) > 0                                  -- 净额止血：排退保 / 全额冲销
)
SELECT
  COUNT(*)        AS net_policies,                         -- 净额保单数
  SUM(premium)    AS total_premium,                        -- 净额总保费
  AVG(premium)    AS avg_premium,                          -- 件均净额保费
  STDDEV(premium) AS std_premium,
  PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY premium) AS p05,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY premium) AS p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY premium) AS p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY premium) AS p99
FROM eligible
"
```

**数据覆盖范围（行级元数据；批改副本 / 冲销行观察）**：

```bash
duckdb -c "
SELECT
  COUNT(*)                      AS raw_rows,               -- 原始行数（含批改副本）
  COUNT(DISTINCT policy_no)     AS distinct_policies,      -- 去重保单数（含净额≤0）
  COUNT(DISTINCT salesman_name) AS salesman_count,
  COUNT(DISTINCT org_level_3)   AS org_count,
  MIN(insurance_start_date)     AS date_min,
  MAX(insurance_start_date)     AS date_max
FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true)
WHERE branch_code = 'SX'
"
```

> **数据质量读法**：`raw_rows − distinct_policies` = 批改副本行数；`distinct_policies − net_policies` = 净额 ≤ 0 被排除的保单数（退保 / 冲销）。二者均为数据质量观察项。净额"止血口径"以 [车险数据业务规则字典](../../数据管理/knowledge/rules/车险数据业务规则字典.md) 为最终事实源。

**四川可走 API**（本地服务运行时；山西 GATED，API 不返回 SX）：

```bash
curl -s localhost:3000/api/query/kpi | jq '.data | length'
```

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

> ⚠️ 字段须**同时**在 `fields.json` 注册 **且** Parquet 实际落列；前者有、后者无即 `Binder Error`（如 `endorsement_type`）。新增字段务必 duckdb 直查 Parquet 确认存在再写入命令。

| 字段名 | 含义 |
|--------|------|
| `policy_no` | 保单号（原单 + 批改多行，件数去重 `COUNT(DISTINCT policy_no)`）|
| `premium` | 保费（净额；批改正负行在 `GROUP BY policy_no` 内 `SUM` 合并）|
| `branch_code` | **省份隔离键**（`SC` / `SX`，ETL 注入；所有查询必带 `WHERE branch_code`，见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）|
| `insurance_start_date` | 承保起期（时间范围锚点；`TIMESTAMP` 类型）|
| `salesman_name` | 业务员姓名 |
| `org_level_3` | 三级机构 |
| `customer_category` | 客户类别（11 类枚举，完整性核心字段）|
| `is_nev` | 是否新能源 |
| `endorsement_no` | 批改单号（varchar）。净额口径已由 `SUM(premium)+HAVING>0` 合并批改，无需按批改类型过滤。⚠️ `endorsement_type` 虽在 `fields.json` 注册但 **ETL 未落 Parquet**，引用即 `Binder Error` |

**率值聚合铁律**：任何比率必须 SUM(分子)/SUM(分母)，禁止对率值做加权平均或二次汇总。

### SQL 模块参考

- `server/src/sql/kpi.ts` — 基础 KPI 聚合（含保费 SUM 逻辑）

### 验证

```bash
# 山西 GATED：API 不返回 SX，须 duckdb 直查（worktree 用主仓绝对路径）
duckdb -c "WITH eligible AS (SELECT policy_no, SUM(premium) p FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true) WHERE branch_code='SX' GROUP BY policy_no HAVING SUM(premium)>0) SELECT COUNT(*) net_policies, ROUND(SUM(p)/10000,1) total_wan FROM eligible"
# 期望（2026-06-27 实测）：SX 全量净额 ≈ 1772136 件 / 153116 万元；行级 raw_rows ≈ 1833180（批改副本≈5.8 万行）

# 四川可走 API（需本地服务）
curl -s localhost:3000/api/query/kpi | jq '.data | length'
# 期望返回非零，证明 Parquet 可读且 API 通
```
