---
name: chexian-report-custom
description: 自定义报告生成（灵活时间范围，自定义维度）。当用户说"自定义报告"/"指定时间段"/"灵活维度"/"任意区间分析"时触发。
category: reporting
version: 1.2.0
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
last_updated: "2026-06-27"
---

# 自定义报告生成

生成任意时间范围和维度组合的业务报告，不受周报滚动 8 周或月报自然月边界限制。

## 适用场景

- 跨季度专项分析（如 Q3 完整经营复盘）
- 特定机构 + 险类 + 时间区间的交叉分析
- 非标准时间窗口（如节假日前后 7 天对比）

## 使用示例

```bash
/chexian-report-custom --province SX --start 2025-10-01 --end 2025-12-31
/chexian-report-custom --province SC --dimensions 机构,险类 --start 2025-12-01 --end 2025-12-31
```

## 支持的分析维度

| 维度 | 字段名 |
|------|--------|
| 机构 | `org_level_3` |
| 险类 | `insurance_type` |
| 续保状态 | `is_renewal` |
| 新能源 | `is_nev` |
| 客户类别 | `customer_category` |

> 批改不作为分析维度：净额口径已在保单粒度 `SUM(premium)` 合并批改正负行；批改类型字段 `endorsement_type` 在 `fields.json` 注册但 **ETL 未落 Parquet**，引用即 `Binder Error`，不可下钻。

## 执行协议

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--province <SC\|SX>` | **是** | 省份隔离（见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）。SC=四川 / SX=山西。**禁默认四川**；未注册省份 fail-closed 报错 |
| `--start <YYYY-MM-DD>` | **是** | 区间起（含当天），以 `insurance_start_date` 过滤 |
| `--end <YYYY-MM-DD>` | **是** | 区间止（**含当天**），SQL 展开为闭开区间右界 = `end 次日 00:00`（避免 end 当天保单遗漏）|
| `--dimensions <维度,...>` | 否 | 逗号分隔分析维度（如 `机构,险类`），多维度做交叉 GROUP BY，维度须进净额 CTE 的 group key |
| `--output <路径>` | 否 | 写入 Markdown 文件（默认终端表格）|

> ⚠️ **时间口径未明先反问**：自由区间易与"年初至今进度 / 完成率"口径混淆，按 [时间口径反问协议](../rules/time-caliber-disambiguation.md) 的 4 类触发先澄清（窗口期 vs 年度进度等），**禁自由选口径**。本技能口径挂靠 [SSOT](../rules/skill-caliber-ssot.md)，不内联。

### 数据源

**省份隔离前置**（必读 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）：`--province` 同时驱动 `read_parquet` glob 与 `WHERE branch_code`，二者缺一不可（裸 `*.parquet` 跨省混查且静默不报错）。

| `--province` | `read_parquet(...)` glob | `WHERE branch_code` |
|--------------|--------------------------|---------------------|
| `SX`（山西）| `'数据管理/warehouse/fact/policy/current/SX_*.parquet'` | `'SX'` |
| `SC`（四川）| `['数据管理/warehouse/fact/policy/current/[0-9]*.parquet','数据管理/warehouse/fact/policy/current/sichuan_*.parquet']` | `'SC'` |

> ⚠️ 四川两类文件名必须用 `read_parquet([...])` **列表形式**；DuckDB 不支持 brace `{a,b}`（实测 `IO Error`）。worktree 无 Parquet，须把 `数据管理/` 换成主仓绝对路径。

**区间 × 维度（净额口径；以下为 `--province SX --start 2025-10-01 --end 2025-12-31 --dimensions 机构,险类` 展开后的 SQL，2026-06-27 实测零 Binder Error）**：

```bash
duckdb -c "
WITH eligible AS (
  SELECT policy_no, org_level_3, insurance_type, SUM(premium) AS premium
  FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true)
  WHERE branch_code = 'SX'                                  -- 省份隔离（权威键）
    AND insurance_start_date >= TIMESTAMP '2025-10-01'      -- 区间起（含当天；禁列上 CAST 损裁剪）
    AND insurance_start_date <  TIMESTAMP '2026-01-01'      -- 区间止次日（闭开右界 = --end 2025-12-31 含当天）
  GROUP BY policy_no, org_level_3, insurance_type           -- 分析维度进 group key，消 ANY_VALUE 影子口径
  HAVING SUM(premium) > 0                                   -- 净额止血：合并批改、排退保
)
SELECT org_level_3, insurance_type, COUNT(*) AS policy_count, SUM(premium) AS total_premium
FROM eligible GROUP BY org_level_3, insurance_type ORDER BY total_premium DESC
"
```

> **维度件数口径**：维度排名件数用 CTE 按 `policy_no + 维度` 聚合后 `COUNT(*)`；跨维度保单（如跨机构批改）在各维度分别计入，故维度件数之和略 ≥ 全省去重件数。净额"止血口径"以 [车险数据业务规则字典](../../数据管理/knowledge/rules/车险数据业务规则字典.md) 为最终事实源。

**四川可走 API**（本地服务运行时，支持任意日期区间；山西 GATED，API 不返回 SX）：

```bash
curl -s 'localhost:3000/api/query/report' | jq '.data | length'
```

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

> ⚠️ 字段须**同时**在 `fields.json` 注册 **且** Parquet 实际落列；前者有、后者无即 `Binder Error`（如 `endorsement_type`）。新增字段务必 duckdb 直查 Parquet 确认存在再写入命令。

| 字段名 | 含义 |
|--------|------|
| `insurance_start_date` | 承保起期（时间区间过滤锚点；`TIMESTAMP` 类型）|
| `policy_no` | 保单号（件数去重 `COUNT(DISTINCT policy_no)`）|
| `premium` | 保费（净额；批改正负行在 `GROUP BY policy_no`[+维度] 内 `SUM` 合并）|
| `branch_code` | **省份隔离键**（`SC` / `SX`，ETL 注入；所有查询必带 `WHERE branch_code`，见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）|
| `org_level_3` | 三级机构 |
| `insurance_type` | 险类（商业险/交强险）|
| `is_renewal` | 是否续保 |
| `is_nev` | 是否新能源 |
| `customer_category` | 客户类别（11 类）|
| `endorsement_no` | 批改单号（varchar）。净额口径已由 `SUM(premium)+HAVING>0` 合并批改，无需按批改类型过滤。⚠️ `endorsement_type` 虽在 `fields.json` 注册但 **ETL 未落 Parquet**，引用即 `Binder Error`（不可作分析维度）|

**率值聚合铁律**：赔付率、费用率等比值必须 SUM(分子)/SUM(分母)，禁止对各维度的率值做加权平均或二次汇总。

### SQL 模块参考

- `server/src/sql/kpi.ts` — 核心 KPI 聚合（含自定义日期区间 WHERE 模板）
- `server/src/sql/cost/cost-ratios.ts` — 满期赔付率权威 CTE

### 验证

```bash
# 山西 GATED：API 不返回 SX，须 duckdb 直查（worktree 用主仓绝对路径）
duckdb -c "WITH eligible AS (SELECT policy_no, org_level_3, insurance_type, SUM(premium) p FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true) WHERE branch_code='SX' AND insurance_start_date>=TIMESTAMP '2025-10-01' AND insurance_start_date<TIMESTAMP '2026-01-01' GROUP BY policy_no, org_level_3, insurance_type HAVING SUM(premium)>0) SELECT org_level_3, insurance_type, COUNT(*) policy_count, ROUND(SUM(p)/10000,1) total_wan FROM eligible GROUP BY org_level_3, insurance_type ORDER BY total_wan DESC LIMIT 5"
# 期望（2026-06-27 实测，SX 2025Q4）：非空维度排名，如 临汾×交强险 ≈ 9884 件 / 656 万元居首

# 四川可走 API（需本地服务）
curl -s localhost:3000/api/query/report | jq '.data | length'
```
