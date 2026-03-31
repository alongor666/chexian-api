---
name: DuckDB CREATE VIEW 不支持参数化查询
description: DuckDB 的 CREATE VIEW 语句中不能使用 $param 参数，只能用 f-string + 转义
type: feedback
---

DuckDB 的 `CREATE OR REPLACE VIEW` 语句不支持 prepared parameters（`$org`, `$agent`），会报 `BinderException: Unexpected prepared parameter`。

**Why:** 2026-03-31 在 diagnose_agent.py v2.0 中尝试用参数化查询防注入，但 DuckDB DDL 不支持。

**How to apply:**
- SELECT 语句可以用参数化：`con.execute("SELECT * WHERE x = $v", {"v": val})`
- CREATE VIEW 必须用 f-string：先 `val.replace("'", "''")`转义，再 `f"WHERE x = '{val_esc}'"`
- 这是 DuckDB 限制，不是 bug
