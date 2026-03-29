# 数据流字段变换规则知识库

> **目的**: 记录关键实体（业务员、机构、保费等）在数据流各节点中的字段名、值格式、JOIN 关系，防止维护映射/查询时因格式不一致导致 JOIN 失败。
>
> **适用角色**: AI 协作、开发者、数据运维

---

## 0. Gotcha 速查清单（MUST READ）

> **CRITICAL #1**: `salesman_organization_mapping.json` 的 `full_name` 必须使用 Parquet 中的原始值（含工号前缀），如 `"110030888王时凤"`。纯中文名 `"王时凤"` 会导致 JOIN 失败。
>
> **CRITICAL #2**: 系统存在两个平行机构体系——`PolicyFact.org_level_3`（来自原始 Parquet）和 `SalesmanTeamMapping.organization`（来自映射表，可覆盖原始值）。不同报表/API 使用不同来源。
>
> **CRITICAL #3**: Parquet 是唯一事实源。所有维度表的关联字段必须以 Parquet 实际数据为准。
>
> **CRITICAL #4**: UI 永远只展示中文名（通过 `formatSalesmanName()` 提取），但底层数据全程保持 `{工号}{中文名}` 格式。

---

## 1. 数据流全景图

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  Excel 原始   │────▶│  Parquet 文件  │────▶│  PolicyFact 视图      │
│  业务员="业务员" │     │  业务员="业务员" │     │  salesman_name        │
│  值="110030888│     │  值="110030888│     │  值="110030888王时凤"  │
│    王时凤"    │     │    王时凤"    │     │                      │
└──────────────┘     └──────────────┘     └─────────┬────────────┘
                                                     │
                     ┌───────────────────────────────┤
                     │                               │
              ┌──────▼──────────┐           ┌────────▼─────────────┐
              │ SalesmanTeam    │           │ 预聚合表              │
              │ Mapping         │           │ CrossSellDailyAgg    │
              │ full_name=      │           │ salesman_name=       │
              │ "110030888王时凤"│           │ "110030888王时凤"     │
              │ org="重客"(覆盖) │           │ org_level_3="本部"   │
              └───────┬─────────┘           │ (原始值,不经映射)     │
                      │                     └──────────────────────┘
              ┌───────▼─────────┐
              │ achievement     │
              │ _cache          │
              │ full_name=      │
              │ "110030888王时凤"│
              │ org_name="重客"  │
              │ (来自映射表)      │
              └───────┬─────────┘
                      │
              ┌───────▼─────────┐     ┌──────────────────────┐
              │  API 响应        │────▶│  前端展示              │
              │  salesman_name= │     │  formatSalesmanName() │
              │  "110030888     │     │  → "王时凤"            │
              │    王时凤"       │     │  (提取中文部分)         │
              └─────────────────┘     └──────────────────────┘
```

---

## 2. 节点详细规格

### 节点 1: Excel 原始数据

| 项目 | 值 |
|------|-----|
| **数据位置** | 用户提供的 `.xlsx` 文件 |
| **业务员字段** | 列名 `"业务员"`, 值格式 `"110030888王时凤"`（9位工号+中文名，无分隔符） |
| **机构字段** | 列名 `"三级机构"`, 值格式 `"本部"` / `"天府"` 等 |
| **变换** | `transform.py` 重命名部分字段（如 `"签单/批改保费含税"` → `"保费"`），但业务员和机构字段**不变** |
| **代码位置** | `数据管理/pipelines/transform.py` L244-429 |

### 节点 2: Parquet 文件

| 项目 | 值 |
|------|-----|
| **数据位置** | `数据管理/warehouse/fact/policy/daily/*.parquet` 或 `current/*.parquet` |
| **业务员字段** | 列名仍为中文 `"业务员"`, 值格式 `"110030888王时凤"` |
| **机构字段** | 列名 `"三级机构"`, 值格式 `"本部"` |
| **下游** | DuckDB 加载 → PolicyFact |

### 节点 3: DuckDB PolicyFact 视图

| 项目 | 值 |
|------|-----|
| **数据位置** | DuckDB 内存表 `PolicyFactRealtime`（物化自 `PolicyFact` 视图） |
| **业务员字段** | 列名 `salesman_name`（通过 `COLUMN_ALIASES` 从 `"业务员"` 映射），值 `"110030888王时凤"` |
| **机构字段** | 列名 `org_level_3`（从 `"三级机构"` 映射），值 `"本部"` |
| **索引** | `idx_policy_fact_salesman ON PolicyFactRealtime(salesman_name)` |
| **代码位置** | `server/src/normalize/mapping.ts` L62-149（列名别名）, `server/src/services/duckdb.ts` L563-611（视图创建） |

### 节点 4: SalesmanTeamMapping 维度表

| 项目 | 值 |
|------|-----|
| **数据位置** | DuckDB 内存表，从 `salesman_organization_mapping.json` 加载 |
| **字段** | `business_no`=`"110030888"`, `salesman_name`=`"王时凤"`（纯中文）, `full_name`=`"110030888王时凤"`（**JOIN 键**）, `team_name`, `organization`=`"重客"`（可覆盖原始 org_level_3） |
| **JOIN** | `full_name = PolicyFact.salesman_name`（必须含工号，否则匹配 0 行） |
| **代码位置** | `server/src/services/duckdb.ts` L980-1032（loadTeamMapping） |

> **WARNING**: `full_name` 格式必须为 `"{9位工号}{中文名}"`，与 Parquet 中 `"业务员"` 列的值完全一致。新增业务员时必须先从 Parquet 查询完整名称。

### 节点 5: SalesmanPlanFact 视图

| 项目 | 值 |
|------|-----|
| **数据位置** | DuckDB 视图，基于 SalesmanTeamMapping |
| **字段** | `salesman_name` = SalesmanTeamMapping.`full_name`（含工号）, `org_name` = SalesmanTeamMapping.`organization` |
| **用途** | 供 `premium-report.ts` 和 `renewal-drilldown.ts` JOIN 使用 |
| **代码位置** | `server/src/services/duckdb.ts` L1019-1030 |

### 节点 6: achievement_cache 预聚合表

| 项目 | 值 |
|------|-----|
| **数据位置** | DuckDB 内存表，启动时预计算 |
| **字段** | `full_name`=`"110030888王时凤"`, `salesman_name_short`=`"王时凤"`, `team_name`, `org_name`=`"重客"`（来自映射表） |
| **双来源逻辑** | Part A: 映射表中的业务员（org 来自映射）; Part B: 有保单但不在映射中的（org 标记 `"未归属机构"` ） |
| **代码位置** | `server/src/services/duckdb.ts` L1052-1158 |

### 节点 7: CrossSellDailyAgg 预聚合表

| 项目 | 值 |
|------|-----|
| **数据位置** | DuckDB 内存表/视图 |
| **字段** | `salesman_name`=`"110030888王时凤"`, `org_level_3`=`"本部"` — **直接来自 PolicyFact，不经映射表** |
| **代码位置** | `server/src/services/duckdb.ts` L811-879 |

### 节点 8: API 响应

| API 端点 | 业务员字段 | 机构字段来源 |
|---------|----------|------------|
| `GET /api/filters/options` → `orgs` | — | `PolicyFact.org_level_3`（原始） |
| `GET /api/filters/options` → `salesmenWithTeam` | `SalesmanTeamMapping.full_name` | `SalesmanTeamMapping.organization`（映射） |
| `GET /api/query/premium-report` | `PolicyFact.salesman_name`（含工号） | `PolicyFact.org_level_3`（原始） |
| 保费达成下钻 | `achievement_cache.full_name` | `achievement_cache.org_name`（映射） |
| 续保下钻 | `REGEXP_REPLACE(salesman_name, '^[0-9]+', '')`（SQL 层去工号） | `PolicyFact.org_level_3` |

代码位置: `server/src/routes/filters.ts` L37-97, `server/src/sql/premiumPlan.ts`, `server/src/sql/renewal-drilldown.ts`

### 节点 9: 前端展示

| 项目 | 值 |
|------|-----|
| **函数** | `formatSalesmanName()` in `src/shared/utils/formatters.ts` |
| **逻辑** | 提取所有中文字符：`raw.match(/[\u3400-\u4DBF\u4E00-\u9FFF]+/g)` |
| **示例** | `"110030888王时凤"` → `"王时凤"`, `"admin"` → `"直接个代"` |

---

## 3. JOIN 关系图谱

| 源 | 目标 | JOIN 键 | 格式约束 |
|----|------|---------|---------|
| PolicyFact.`salesman_name` | SalesmanTeamMapping.`full_name` | 等值连接 | 两端必须都是 `"{工号}{中文名}"` |
| PolicyFact.`salesman_name` | SalesmanPlanFact.`salesman_name` | 等值连接 | SalesmanPlanFact.salesman_name 来自 mapping 的 full_name |
| SalesmanTeamMapping.`full_name` | achievement_cache.`full_name` | 预计算时 JOIN | 格式一致 |

**JOIN 失败案例**:
```
PolicyFact.salesman_name = "110030888王时凤"
SalesmanTeamMapping.full_name = "王时凤"          ← WRONG: 匹配 0 行
SalesmanTeamMapping.full_name = "110030888王时凤"  ← CORRECT: 匹配成功
```

---

## 4. 关键陷阱（CRITICAL TRAPS）

### 陷阱 1: full_name 必须含工号前缀

| 项 | 值 |
|----|-----|
| **现象** | 新增业务员后，保费达成报表中该人无数据 |
| **原因** | mapping.json 的 full_name 是纯中文名，与 PolicyFact 的含工号名称无法 JOIN |
| **正确做法** | 先从 Parquet 查 `SELECT DISTINCT 业务员 FROM parquet WHERE 业务员 LIKE '%姓名%'`，用查到的完整值作为 full_name |
| **错误做法** | 直接用用户提供的纯中文名作为 full_name |

### 陷阱 2: 两个平行机构体系

| 项 | 值 |
|----|-----|
| **现象** | 同一业务员在不同报表中显示不同机构 |
| **原因** | 筛选器/保费报表用 `PolicyFact.org_level_3`（原始），达成分析用 `SalesmanTeamMapping.organization`（映射覆盖） |
| **正确做法** | 理解两个机构的用途——原始机构反映保单实际归属，映射机构反映管理归属（可人为调整） |

### 陷阱 3: 续保模块 SQL 层去工号

| 项 | 值 |
|----|-----|
| **现象** | 续保下钻返回的 group_name 是纯中文名（无工号） |
| **原因** | `renewal-drilldown.ts` 使用 `REGEXP_REPLACE(salesman_name, '^[0-9]+', '')` 在 SQL 层去掉工号 |
| **注意** | 其他模块不做 SQL 层去工号，由前端 `formatSalesmanName()` 处理 |

### 陷阱 4: achievement_cache 双来源

| 项 | 值 |
|----|-----|
| **现象** | 某业务员有保单但达成分析中显示"未归属机构" |
| **原因** | 该业务员不在 SalesmanTeamMapping 中，走了 Part B 逻辑 |
| **正确做法** | 将该业务员添加到 mapping.json（full_name 用 Parquet 值） |

---

## 5. 操作手册：新增业务员到映射文件

### 步骤

```bash
# 1. 从 Parquet 查询完整名称和机构
# 在运行中的后端，或用 DuckDB CLI:
SELECT DISTINCT salesman_name, org_level_3
FROM PolicyFact
WHERE salesman_name LIKE '%目标姓名%'

# 2. 确认结果
# - 唯一匹配 → 直接使用
# - 多个匹配（同名不同ID）→ 确认是哪个人
# - 无匹配 → 该人可能尚无保单数据

# 3. 写入 mapping.json
{
  "business_no": "110030888",           // 从 Parquet 结果提取工号部分
  "salesman_name": "王时凤",            // 纯中文名
  "full_name": "110030888王时凤",       // 必须与 Parquet 完全一致
  "team": "未分配",                     // 或实际团队名
  "organization": "重客"                // 用户指定的管理归属（可覆盖 Parquet 的 org_level_3）
}

# 4. 重启后端使映射生效
# 5. 验证: 检查日志中 "Team mapping loaded: N records"
```

### 规则

- **full_name 必须 = Parquet 中 salesman_name 的原始值**（含工号）
- **organization 允许与 Parquet 的 org_level_3 不同**（管理归属 vs 保单归属）
- **用户未指定机构时**，从 Parquet 的 org_level_3 获取；多机构出单的设为 `"未分配"`

---

## 6. 字段变换横向对照表

| 实体 | Excel | Parquet | PolicyFact | SalesmanTeamMapping | achievement_cache | API 响应 | 前端显示 |
|------|-------|---------|------------|--------------------|--------------------|---------|---------|
| **业务员** | `业务员`=`"110030888王时凤"` | `业务员`=`"110030888王时凤"` | `salesman_name`=`"110030888王时凤"` | `full_name`=`"110030888王时凤"` / `salesman_name`=`"王时凤"` | `full_name`=`"110030888王时凤"` / `salesman_name_short`=`"王时凤"` | `salesman_name`=`"110030888王时凤"` | `"王时凤"` |
| **机构** | `三级机构`=`"本部"` | `三级机构`=`"本部"` | `org_level_3`=`"本部"` | `organization`=`"重客"`（可覆盖） | `org_name`=`"重客"`（来自映射） | 视端点而定 | 原样显示 |
| **团队** | 无 | 无 | 无 | `team_name`=`"未分配"` | `team_name`=`"未分配"` | `team_name` | 原样显示 |

---

## 配套文档

| 文档 | 关系 |
|------|------|
| [PARQUET_SCHEMA_KNOWLEDGE.md](./PARQUET_SCHEMA_KNOWLEDGE.md) | 字段类型/值域详情（本文档侧重字段变换） |
| [车险数据业务规则字典.md](../rules/车险数据业务规则字典.md) | 字段业务语义定义 |
| [data-pipeline.md](../../.claude/rules/data-pipeline.md) | VPS 分层架构/数据加载路径 |
| [data-knowledge-protocol.md](../../.claude/data-knowledge-protocol.md) | 知识分层加载协议 |

---

*最后更新: 2026-03-29*
