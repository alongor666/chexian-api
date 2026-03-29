---
paths: ["server/src/sql/**", "server/src/services/duckdb.ts"]
---

# SQL 生成器与 DuckDB 规则

## 业务口径定义（RED LINE）

| 文件 | 规则 |
|------|------|
| `server/src/services/duckdb.ts` | 不得修改已有查询逻辑，只能追加新查询，需 BACKLOG.md 登记+证据 |
| `server/src/routes/query.ts` | 不得删除已有路由，只能追加新路由，需 BACKLOG.md 登记 |

## DuckDB 序列化陷阱

DATE → `{days:N}`、TIMESTAMP → `{micros:N}`，**必须**在 duckdb.ts 反序列化为 ISO 字符串。

## 空值防护

`row.time_period` 可能为 undefined — 必须先 `?? ''` 再 `.includes()`。所有 DuckDB 返回字段都需空值防护。

## DuckDB 语法

查 [DuckDB 官方文档](https://duckdb.org/docs/)，禁止猜测。日期处理先 `CAST(field AS DATE)`。
