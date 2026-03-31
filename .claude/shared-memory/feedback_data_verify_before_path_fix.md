---
name: 改路径前必须验证数据正确性
description: 修改数据脚本的路径/SQL 时，必须用 DuckDB 直查验证数据，不能只做文本替换
type: feedback
---

修改数据处理脚本时，路径修复只是表面，数据正确性才是核心。

**Why:** 2026-03-30 修复 diagnose_agent.py 时只改了 policy/daily → policy/current 路径，漏掉了 LEFT JOIN claims/latest.parquet 导致 2021-2023 赔案数据为 0 的根本 bug。路径改对了但数据还是错的。

**How to apply:**
1. 改路径/SQL 前 → `python3 -c "import duckdb; ..."` 直查确认数据范围和字段
2. 改完后 → 跑脚本对比修改前后输出
3. 涉及 JOIN 时 → 验证两表的时间范围是否匹配
