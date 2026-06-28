---
name: chexian-data-kpi
description: 业绩分析与排名（Top30业务员、机构对比、四象限分层）。当用户说"排名"/"业绩"/"四象限"/"哪个业务员最强"时触发。
category: data-analysis
version: 1.3.0
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
  - server/src/config/metric-registry/categories/cost.ts
  - server/src/sql/claims-heatmap.ts
  - .claude/rules/skill-caliber-ssot.md
  - .claude/rules/data-pipeline.md
  - .claude/rules/time-caliber-disambiguation.md
parent_command: chexian-data-analysis
last_updated: "2026-06-27"
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
四象限以**件数中位数**和**人均保费中位数**为轴（人均保费＝保费÷业务员）。注：件均保费另有注册表口径 `avg_premium_per_policy`[K4]（＝保费÷件数，区别于人均÷业务员、车均÷车架号）；四象限轴**是否回填为件均**属后续（见计划 §8）。当前轴维持人均，列举如下：
- Q1 明星业务员：件数高 + 人均保费高
- Q2 大单专家：件数低 + 人均保费高（大客户型）
- Q3 新手待培养：件数低 + 人均保费低
- Q4 效率待提升：件数高 + 人均保费低

## 使用示例

```bash
/chexian-data-kpi --province SX --year 2026
/chexian-data-kpi --province SC --start 2026-01-01 --end 2026-06-13 --top 50
```

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--province <SC\|SX>` | **是** | 省份隔离（见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）。SC=四川 / SX=山西。**禁默认四川**；未注册省份 fail-closed 报错 |
| `--year <YYYY>` | 时间窗口二选一 | 整年口径（年初至今，闭开区间 `[YYYY-01-01, (YYYY+1)-01-01)`）|
| `--start <YYYY-MM-DD> --end <YYYY-MM-DD>` | 时间窗口二选一 | 自定义窗口（**必须成对**，缺一不可）|
| `--top <N>` | 否 | 业务员排名取前 N（默认 30）|

> ⚠️ **时间口径未明先反问**：`--year` 与 `--start/--end` 二者必择其一、不混用；若用户只给"某月 / 某周"或语义含糊，按 [时间口径反问协议](../rules/time-caliber-disambiguation.md) 的 4 类触发先澄清（窗口期 vs 年初至今进度等），**禁自由选口径**。

## 执行协议

### 数据源

**省份隔离前置**（必读 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）：`--province` 同时驱动 `read_parquet` glob 与 `WHERE branch_code`，二者缺一不可。

| `--province` | `read_parquet(...)` glob | `WHERE branch_code` |
|--------------|--------------------------|---------------------|
| `SX`（山西）| `'数据管理/warehouse/fact/policy/current/SX_*.parquet'` | `'SX'` |
| `SC`（四川）| `['数据管理/warehouse/fact/policy/current/[0-9]*.parquet','数据管理/warehouse/fact/policy/current/sichuan_*.parquet']` | `'SC'` |

> ⚠️ 四川两类文件名必须用 `read_parquet([...])` **列表形式**；DuckDB 不支持 brace `{a,b}`（实测 `IO Error`）。worktree 无 Parquet，须把 `数据管理/` 换成主仓绝对路径。

**业务员排名（山西 Top 30，净额口径；以下为 `--province SX --year 2026` 展开后的 SQL）**：

```bash
duckdb -c "
WITH eligible AS (
  SELECT policy_no, salesman_name, SUM(premium) AS premium
  FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true)
  WHERE branch_code = 'SX'                              -- 省份隔离（权威键）
    AND policy_date >= TIMESTAMP '2026-01-01'           -- 时间窗口（闭开区间，禁列上 CAST 损裁剪）
    AND policy_date <  TIMESTAMP '2027-01-01'
  GROUP BY policy_no, salesman_name                     -- salesman_name 自带工号前缀＝人唯一键，勿拆姓名
  HAVING SUM(premium) > 0                               -- 净额止血口径：合并批改、排退保 / 负净额
)
SELECT salesman_name, COUNT(*) AS policy_count, SUM(premium) AS total_premium
FROM eligible GROUP BY salesman_name ORDER BY total_premium DESC LIMIT 30
"
```

**机构业绩对比（山西，净额口径）**：

```bash
duckdb -c "
WITH eligible AS (
  SELECT policy_no, org_level_3, SUM(premium) AS premium
  FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true)
  WHERE branch_code = 'SX'
    AND policy_date >= TIMESTAMP '2026-01-01'
    AND policy_date <  TIMESTAMP '2027-01-01'
  GROUP BY policy_no, org_level_3                        -- 机构进 group key 消除 ANY_VALUE 影子口径
  HAVING SUM(premium) > 0
)
SELECT org_level_3, COUNT(*) AS policy_count, SUM(premium) AS total_premium
FROM eligible GROUP BY org_level_3 ORDER BY total_premium DESC
"
```

> **件数口径**：全省唯一保单件数用 `COUNT(DISTINCT policy_no)`（或 CTE 仅 `GROUP BY policy_no` 后 `COUNT(*)`）；维度排名件数用 CTE 按 `policy_no + 维度` 聚合后 `COUNT(*)` —— 跨维度保单（实测约 0.01% 跨机构批改）在各维度分别计入，故维度件数之和略 ≥ 全省去重件数。净额"止血口径"以 `数据管理/knowledge/rules/车险数据业务规则字典.md` 为最终事实源。

**四川可走 API**（本地服务运行时；山西 GATED，API 不返回 SX）：

```bash
curl -s localhost:3000/api/query/kpi | jq '.data | length'
curl -s localhost:3000/api/query/salesman | jq '.data[0]'
```

### 常用字段（唯一事实源：`server/src/config/field-registry/fields.json`）

> ⚠️ 字段须**同时**在 `fields.json` 注册 **且** Parquet 实际落列；前者有、后者无即 `Binder Error`（如 `endorsement_type`）。新增字段务必 duckdb 直查 Parquet 确认存在再写入命令。

| 字段名 | 含义 |
|--------|------|
| `policy_no` | 保单号（含批改为多行，统计件数需去重 `COUNT(DISTINCT policy_no)`）|
| `premium` | 保费（净额；批改正负行在保单粒度 `GROUP BY policy_no`[+分析维度] 内 `SUM` 合并）|
| `branch_code` | **省份隔离键**（`SC` / `SX`，ETL 注入；所有查询必带 `WHERE branch_code`，见 [省份数据隔离 RED LINE](../rules/data-pipeline.md)）|
| `salesman_name` | 业务员姓名（**自带工号前缀**＝人唯一键，按人聚合勿拆姓名）|
| `org_level_3` | 三级机构（最细粒度组织维度）|
| `customer_category` | 客户类别（11 类枚举）|
| `is_renewal` | 是否续保 |
| `is_nev` | 是否新能源 |
| `endorsement_no` | 批改单号（varchar）。净额口径已由 `SUM(premium)+HAVING>0` 合并批改，无需按批改类型过滤。⚠️ `endorsement_type` 虽在 `fields.json` 注册但 **ETL 未落 Parquet**，引用即 `Binder Error` |

**率值聚合铁律**：满期赔付率 = SUM(赔款分子) / SUM(满期保费)，禁止对率值做加权平均或二次汇总。

### 满期赔付率（机构对比扩展，挂靠注册表 `earned_claim_ratio`）

满期赔付率口径**挂靠注册表 `earned_claim_ratio`**（`server/src/config/metric-registry/categories/cost.ts`，取数 `getMetricSql('earned_claim_ratio')`），**禁在本命令内联 L4 SQL**（见 [技能口径挂靠 SSOT](../rules/skill-caliber-ssot.md)）：

> 满期赔付率 = SUM(已报告赔款) / SUM(满期保费)（闰年感知）
> - **已报告赔款**（SX 赔案 `validation/SX/claims_detail/claims_*.parquet`）：仅取 `liability_ratio > 0` 且 `case_type` 非「零结 / 注销 / 拒赔」的案件；**已结案**（`settlement_time ≤ 观察截止`）取 `settled_amount`、**未结案**取 `reserve_amount` —— **二者二选一，不得相加**。
> - **满期保费** = `premium × earned_days / policy_term`（闰年感知：`policy_term = 起期到起期+1年 = 365/366`，`earned_days = LEAST(已过天数, policy_term)`）。

⚠️ **口径复杂必挂靠、禁手写内联**：实测把 `settled` 与 `reserve` **相加** + 未排无责，机构满期赔付率虚高至最高 **143%**（不合理）；正确口径（二选一 + 排无责无效）为 **56–73%**（SX 2025 保单年度，cutoff 2026-06-23，合理）。L4 实现入口见 `server/src/sql/claims-heatmap.ts`（机构维度 cohort / cutoff）；机构满期赔付率发展报告用 `/diagnose-loss-development`。

### 口径挂靠总表（技能挂靠 SSOT 闭环 · 治理链 K1–K5）

本命令所有口径**禁内联、必挂靠** SSOT（[技能口径挂靠 SSOT](../rules/skill-caliber-ssot.md)）：

| 口径 | SSOT 锚点（可定位文件 / 路径） | 来源 |
|------|----------|------|
| 省份隔离 | [`data-pipeline.md`](../rules/data-pipeline.md) 省份数据隔离 RED LINE（`branch_code` + 文件名 glob） | K1 |
| 净额保费 | `数据管理/knowledge/rules/车险数据业务规则字典.md` + `GROUP BY policy_no HAVING SUM(premium)>0` | K1 |
| 字段名落列 | `server/src/config/field-registry/fields.json` **且** Parquet 实际落列（K3 闸强制） | K1/K3 |
| 枚举值 | `数据管理/knowledge/rules/车险数据业务规则字典.md`（`insurance_type` / `coverage_combination` 等） | K1 |
| 时间口径 | [`time-caliber-disambiguation.md`](../rules/time-caliber-disambiguation.md) 反问协议 | K1 |
| 技能禁内联元规则 | [`skill-caliber-ssot.md`](../rules/skill-caliber-ssot.md) | K2 |
| 幽灵字段强制闸 | `scripts/governance/parquet-columns.snapshot.json` + `scripts/check-governance.mjs` 技能字段闸 | K3 |
| 件均保费 | 注册表 `avg_premium_per_policy`（`server/src/config/metric-registry/categories/foundation.ts`） | K4 |
| 满期赔付率 | 注册表 `earned_claim_ratio`（`server/src/config/metric-registry/categories/cost.ts`）+ `server/src/sql/claims-heatmap.ts` | K5 |
| 业务员粒度 | `server/src/config/field-registry/fields.json` 的 `salesman_name`（自带工号前缀＝人唯一键，按人聚合） | K1 |
| 率值聚合 | 注册表 `additive:false` 标记 + `domain-cross-metric.test.ts`（禁 `AVG(xxx_ratio)`）；`SUM(分子)/SUM(分母)` | 既有 |

### SQL 模块参考

- `server/src/sql/kpi.ts` — KPI 聚合主逻辑
- `server/src/sql/salesman-ranking.ts` — 业务员排名 SQL
- `server/src/sql/performance-analysis.ts` — 机构绩效分析
- `server/src/config/metric-registry/categories/cost.ts` — 满期赔付率 `earned_claim_ratio` 注册表口径（L3 表达式）
- `server/src/sql/claims-heatmap.ts` — 满期赔付率 L4 实现入口（满期保费 CTE + claims JOIN 已报告赔款）

### 验证

```bash
# 山西 GATED：API 不返回 SX，须 duckdb 直查（worktree 用主仓绝对路径）
duckdb -c "WITH eligible AS (SELECT policy_no, SUM(premium) p FROM read_parquet('数据管理/warehouse/fact/policy/current/SX_*.parquet', union_by_name=true) WHERE branch_code='SX' AND policy_date>=TIMESTAMP '2026-01-01' AND policy_date<TIMESTAMP '2027-01-01' GROUP BY policy_no HAVING SUM(premium)>0) SELECT COUNT(*) cnt, ROUND(SUM(p)/10000,1) wan FROM eligible"
# 期望：SX 2026 年至今 ≈ 113846 件 / 9865 万元；与裸 glob 混查（约 388675 件）须显著不同 → 隔离生效

# 四川可走 API（需本地服务）
curl -s localhost:3000/api/query/kpi | jq '.data | length'
# 期望返回非零数组
```

## 产物与边界

- **产物**：业务员 Top N 排名表 / 机构对比表（件数 + 净额保费 + 满期赔付率）/ 四象限分层。纯查询命令，**不落文件**；HTML 报告用 `/diagnose-org-weekly`，满期赔付率发展用 `/diagnose-loss-development`。
- **场景边界**：本命令聚焦 L1–L3 净额业绩口径（保费 / 件数 / 件均 / 排名 / 四象限）；满期赔付率（L4）**挂靠注册表指向实现、不内联**。续保 / 交叉销售 / 渠道 / 定价等专题用对应 `chexian-*` skill。
- **worktree 数据回退**：worktree 无 Parquet（gitignored），duckdb 直查须用主仓绝对路径 `/Users/<user>/.../chexian-api/数据管理/warehouse/...`；山西 GATED 一律 duckdb 直查 `SX_*`（生产 API 不返回 SX）。
