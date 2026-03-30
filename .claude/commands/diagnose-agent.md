---
name: diagnose-agent
description: 经代/代理公司经营KPI诊断（满期赔付率/变动成本率/费用率/出险率，分年对比）
category: data-analysis
version: 1.0.0
author: "@claude"
tags: [diagnosis, intermediary, agent-company, kpi, duckdb, parquet, earned-premium]
scope: project
requires:
  - Python 3.x
  - duckdb (pip)
dependencies:
  - 数据管理/pipelines/diagnose_agent.py
  - 数据管理/warehouse/fact/policy/current/*.parquet
  - 数据管理/warehouse/fact/claims/latest.parquet
last_updated: "2026-03-27"
---

# 经代公司经营 KPI 诊断

对指定三级机构下的经代/代理公司进行全维度经营诊断，输出 Markdown 报告。

## 使用方式

```
/diagnose-agent --org 青羊 --agent 中升
/diagnose-agent --org 天府 --agent 升华 --years 2025
```

## 参数

- `--org`（必填）: 三级机构名称（青羊/天府/宜宾/高新/泸州/自贡/新都/资阳/武侯等）
- `--agent`（必填）: 经代公司名称（支持模糊匹配，如"中升"匹配完整经代名）
- `--years`（可选）: 年份，默认 2025 2026
- `--precise-earned`（可选）: 精确满期保费口径（含费用率+险类系数）

---

## 执行步骤

### Step 1: 参数解析

从用户输入中提取 `--org` 和 `--agent` 参数。

若用户未提供，用以下 DuckDB 查询列出可用选项：
```bash
python3 -c "
import duckdb
con = duckdb.connect()
r = con.execute(\"SELECT DISTINCT 三级机构, COUNT(*) FROM read_parquet('数据管理/warehouse/fact/policy/current/*.parquet', union_by_name=true) GROUP BY 三级机构 ORDER BY COUNT(*) DESC\").fetchall()
for x in r: print(f'  {x[0]} ({x[1]:,d}件)')
"
```

### Step 2: 验证数据文件

```bash
ls 数据管理/warehouse/fact/policy/current/ | tail -3
ls 数据管理/warehouse/fact/claims/latest.parquet
```

### Step 3: 执行诊断脚本

```bash
python3 数据管理/pipelines/diagnose_agent.py --org {org} --agent "{agent}" --years {years}
```

### Step 4: 展示报告

读取生成的 Markdown 报告并直接输出。

### Step 5: 业务洞察

根据诊断结果，重点关注：
1. **变动成本率**：预警91% / 危险94%
2. **满期赔付率**：预警线75%
3. **费用率**：预警17% / 危险14%
4. **续保率**：0% 需特别关注
5. **商车系数**：低系数占比过高意味着定价偏低
6. **出险率 + 案均赔款**：对比摩托车/非摩托车预警线

---

## 指标口径

| 指标 | 公式 | 来源 |
|------|------|------|
| 满期保费 | 保费 × MIN(已过天数, 365) / 365 | 监管1/365口径 |
| 满期赔付率 | 已报告赔款 / 满期保费 × 100% | policy+claims |
| 费用率 | 费用金额 / 签单保费 × 100% | policy+claims |
| 变动成本率 | 满期赔付率 + 费用率 | 计算 |
| 边际贡献率 | 100% - 变动成本率 | 计算 |
| 案均赔款 | 已报告赔款 / 赔案件数 | claims |
| 出险率 | 有赔案保单数 / 总保单数 × 100% | policy+claims |

## 注意事项

- `经代名` 字段仅存在于原始 parquet，不在 PolicyFact 视图中
- 2026年数据尚未满期，满期保费和满期赔付率会随时间变化
- 脚本支持模糊匹配，若命中多个经代名会提示选择
