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

## SQL 字段硬规则（RED LINE）

**背景**：项目数据已完成 CN→EN Parquet 迁移（见 `project_english_parquet_migration`），但 AI 经常按直觉写中文字段名导致 Binder Error；另有 DuckDB 保留字规则容易踩。

| 规则 | 错误示例 | 正确示例 |
|------|----------|----------|
| **字段名必须英文** | `SELECT 厂牌车型 FROM ...` | `SELECT vehicle_model FROM ...` |
| **字段名必须来自注册表** | 猜测 `manufacturer_model` | 查 `server/src/config/field-registry/fields.json` 取 `id` |
| **别名不得以数字开头** | `AS 2026新增` | `AS 起保2026` |
| **中文只用于显示层** | SQL / Python 代码内 | Markdown 报表列标题、UI 标签 |
| **fuel_type 枚举值必须带括号后缀** | `fuel_type='天然气'` | `fuel_type='天然气(NG/CNG/LNG)'`（这是 ETL 产出的完整字符串） |

**违反代价**：Binder Error 直接 SQL 跑挂，需要额外一轮调试。写 SQL 前 60 秒确认字段名 = 省 10 分钟调试。

**AI 检查清单**：写 SQL 前 grep `fields.json` 获取精确字段名，不要凭直觉。
