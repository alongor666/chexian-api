---
name: 经代诊断脚本
description: diagnose_agent.py 可复用脚本 — 对任意三级机构下的经代公司进行9维KPI诊断，经代名字段仅在原始parquet中
type: project
---

经代/代理公司经营诊断工具已沉淀。

**Why:** 用户需要反复对不同机构+经代进行经营分析，`经代名`字段未在PolicyFact视图中暴露，只能直接读parquet。

**How to apply:**
- 脚本路径: `数据管理/pipelines/diagnose_agent.py`
- Slash command: `/diagnose-agent`
- CLI 入口: `python3 数据管理/cli.py diagnose_agent`
- 用法: `python3 数据管理/pipelines/diagnose_agent.py --org 青羊 --agent "中升" --years 2025 2026`
- 支持模糊匹配（LIKE '%agent%'）
- 9 个维度: 核心KPI、险类、客户类别、险别组合、月度趋势、业务员、商车系数、机构对比、损失暴露
- 指标口径对齐 `开发文档/01_指标体系.md`（满期保费=1/365封顶规则）
- 输出: `数据分析报告/agent_diagnosis_{org}_{agent}_{date}.md`
