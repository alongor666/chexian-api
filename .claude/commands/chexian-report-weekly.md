---
name: chexian-report-weekly
description: 车险业务周报自动生成（董事会级，数据驱动，业务洞察型）
category: reporting
version: 2.3.0
author: "@claude"
tags: [report, weekly, kpi, trends, executive, insurance, cost, coefficient]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts
  - server/src/sql/kpi.ts
  - server/src/sql/cost.ts
  - server/src/sql/trend.ts
data_requirements:
  - 数据管理/warehouse/fact/policy/current/*.parquet
last_updated: "2026-06-09"
---

# 车险业务周报自动生成

根据已加载的车险业务数据生成董事会级周报（数据驱动，业务洞察型）。

---

> 报告域分流（weekly/monthly/custom 边界）由路由器 `/chexian-report` 统一管理；月度口径优先用专属 `/chexian-report-monthly`（自然月 + 同比），本命令的 `--period month` 仅作 weekly 框架内的便利切片。

## 输入参数

```bash
/chexian-report-weekly                                   # 默认：最近一周
/chexian-report-weekly --period week --number 50         # 指定自然周
/chexian-report-weekly --start 2025-12-01 --end 2025-12-31  # 指定时间范围
/chexian-report-weekly --period month --value 2025-12    # 月度报告
```

---

## 数据源

- **主数据**: `数据管理/warehouse/fact/policy/current/*.parquet`（签单清单事实表；字段以 `server/src/config/field-registry/fields.json` 为唯一事实源）
- **视图**: PolicyFact（`server/src/services/duckdb.ts`）
- **SQL 生成器**: `server/src/sql/kpi.ts`, `cost.ts`（及 `cost/cost-ratios.ts`）, `trend.ts`
- **必需字段**: 保单号、业务员、保费、签单日期、三级机构
- **扩展字段**: 是否续保、是否可续、批改类型、是否新能源等

---

## 执行流程（6 阶段）

### Phase 1: 数据加载与验证
查询 PolicyFact 视图，验证数据完整性。关键字段缺失率必须为 0。

### Phase 2: 周期定义与筛选
确定报告周期（自然周/自然月/自定义）。`date_trunc('week', ...)` 计算周边界。筛选当前+上期数据。

### Phase 3: 核心 KPI 计算
- **业绩**: 保单数、总保费、件均保费、环比
- **效率**: 人均产能、机构效率、中位数保费
- **质量**: 续保率、可续保率、续保潜力、新能源占比
- **批改**: 批改类型分布、退保率、过户率

### Phase 4: 多维度排名
- Top 20 业务员（保费、贡献率、续保率）
- 机构排名（保费、人均产能、环比增长）
- 四象限分类（明星/大单专家/新手待培养/效率待提升）

### Phase 5: 时间趋势
- 日度趋势、工作日 vs 周末对比
- 最近 8 周趋势，`LAG()` 窗口函数计算环比

### Phase 6: 风险预警
- 异常保单（P99 超高保费、负保费退保）
- 低产能业务员（<1000 元）、低续保率机构（<50%）
- 赔付率 >70% 的机构标红

---

## 报告结构（14 章）

| # | 章节 | 核心内容 |
|---|------|---------|
| 1 | 封面 | 报告周期、数据规模 |
| 2 | 执行摘要 | 核心 KPI 表（本周/上周/环比/累计）、关键发现 5 条 |
| 3 | 业绩分析 | 近 8 周趋势、日度分布、保费构成 |
| 4 | 机构分析 | Top 10 排名、环比增长 Top 5、预警清单 |
| 5 | 业务员分析 | Top 20 排名、四象限分布、零保费预警 |
| 6 | 续保专项 | 续保率对比、不可续保原因 |
| 7 | 新能源专项 | 渗透率、Top 10 新能源业务员 |
| 8 | 成本分析 | 赔付率、费用率、综合费用率 |
| 9 | 商车系数 | 系数分布、机构对比、合规评估 |
| 10 | 批改分析 | 批改类型、退保专项、过户分析 |
| 11 | 数据质量 | 完整性、异常值、一致性 |
| 12 | 风险预警 | 机构/业务员/业务风险（🔴🟡🟢）|
| 13 | 改进建议 | 续保提升、培训、新能源拓展 |
| 14 | 附录 | 数据字典、报告说明 |

---

## 输出格式

- **格式**: GitHub Flavored Markdown
- **金额**: ¥1,234.56（2 位小数，千分位）
- **百分比**: 38.2%（1 位小数）
- **趋势**: ⬆️ / ⬇️ / ➡️
- **风险**: 🔴 高 / 🟡 中 / 🟢 低

---

## 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| 数据未加载 | 提示上传 Parquet 文件 |
| SQL 执行失败 | 显示错误信息 + 修正建议 |
| 时间范围无数据 | 提示选择有效范围 |
| 数据异常值 | 标注异常，继续生成 |

---

## 相关

- `/chexian-cost-analysis` — 成本分析深度审计
- `/chexian-data-analysis` — 多维度深度分析
- `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md` — 完整字段定义

---

现在请开始执行周报生成流程。
