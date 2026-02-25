---
name: data-analysis
description: 车险数据多维度深度分析（KPI、趋势、续保、成本、系数、视角）
category: data-analysis
version: 2.2.0
author: "@claude"
tags: [insurance, analysis, kpi, trends, duckdb, parquet, cost, coefficient]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts (PolicyFact视图)
  - server/src/sql/*.ts
data_requirements:
  - 车险清单.parquet (607K+ 保单记录)
  - 必需字段: 保单号, 保费, 业务员, 签单日期, 三级机构
last_updated: "2026-02-24"
---

# 车险数据多维度深度分析

对车险业务数据执行全方位深度分析，生成业务洞察和决策支持报告。

---

## 子命令速查（推荐）

| 子命令 | 功能 | 使用场景 |
|--------|------|---------|
| `/data-profile` | 数据概览与质量检查 | 首次分析数据时 |
| `/data-kpi` | 业绩分析与排名 | 查看业务员/机构业绩 |
| `/data-trends` | 时间趋势分析 | 分析环比增长和异常 |
| `/data-export` | 数据导出 | 导出分析结果 |
| `/cost-analysis` | 成本深度审计 | 赔付率/费用率分析 |

**完整分析**: 使用本命令执行所有 12 个分析维度。

---

## 输入参数

```bash
/data-analysis                           # 默认：全量分析
/data-analysis --dimensions kpi,trend    # 指定维度
/data-analysis --period 2025-12          # 指定月份
/data-analysis --org 成都市本级           # 指定机构
```

**可选参数**:
- `--dimensions`: 分析维度（逗号分隔，见下方列表）
- `--period`: 时间范围（YYYY-MM 或 YYYY-MM-DD~YYYY-MM-DD）
- `--org`: 筛选机构
- `--salesman`: 筛选业务员
- `--format`: 输出格式（markdown/json，默认 markdown）

---

## 12 个分析维度

| # | 维度 | 说明 | 对应子命令 |
|---|------|------|-----------|
| 1 | **数据概览** | 总记录数、字段完整性、基础统计 | `/data-profile` |
| 2 | **KPI 汇总** | 保费/件数/件均、环比增长、同比对比 | `/data-kpi` |
| 3 | **机构分析** | 机构排名、保费占比、人均产能 | `/data-kpi` |
| 4 | **业务员排名** | Top 30 排名、四象限分类、贡献度分析 | `/data-kpi` |
| 5 | **时间趋势** | 月度/周度趋势线、环比增长率、异常检测 | `/data-trends` |
| 6 | **险种结构** | 险别组合分布、险种保费占比、件均对比 | — |
| 7 | **续保分析** | 续保率、可续保率、续保潜力、不可续原因 | — |
| 8 | **营业货车** | 吨位分段统计、堆叠柱状图、下钻分析 | — |
| 9 | **成本分析** | 赔付率、费用率、综合费用率、变动成本率 | `/cost-analysis` |
| 10 | **商车系数** | 系数分布、机构对比、阈值合规、缺口保费 | — |
| 11 | **交叉销售** | 驾意推介率、四象限散点图、机构渗透率 | — |
| 12 | **增长率** | 同比/环比增长率、机构增速对比、异常预警 | — |

---

## 数据源

- **视图**: PolicyFact（`server/src/services/duckdb.ts`）
- **SQL 生成器**: `server/src/sql/` 下 16 个模块
- **字段定义**: `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md`
- **业务规则**: `数据管理/knowledge/rules/车险数据业务规则字典.md`

---

## 输出格式

```markdown
# 车险数据分析报告

**分析时间**: YYYY-MM-DD HH:mm
**数据范围**: YYYY-MM-DD ~ YYYY-MM-DD
**总记录数**: N 条

## 1. 数据概览
## 2. KPI 汇总
...（按维度依次输出）

## 分析结论与建议
```

---

## 错误处理

| 错误 | 处理 |
|------|------|
| 数据未加载 | 提示使用 `bun run dev:full` 启动并加载数据 |
| SQL 执行失败 | 显示错误 + 查 DuckDB 官方文档 |
| 字段不存在 | 对照 PARQUET_SCHEMA_KNOWLEDGE.md 检查 |
| 日期格式错误 | 使用 `CAST(field AS DATE)` |

---

## 相关

- `.claude/knowledge-extraction-protocol.md` — 知识提取协议
- `.claude/agents/business-intelligence.md` — BI 分析 Agent
- `开发文档/00_index/DATA_INDEX.md` — 数据索引

---

现在请开始执行数据分析。
