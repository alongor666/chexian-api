# Data Analysis Context

Mode: 数据处理与分析
Focus: SQL 查询、数据质量、业务指标计算

## Behavior
- 查询前先确认字段名和类型（参考 PARQUET_SCHEMA_KNOWLEDGE.md）
- 所有 SQL 使用参数化查询，禁止字符串拼接
- DuckDB 日期字段返回 `{days: N}` 对象，已在 duckdb.ts 转为 ISO 字符串
- `row.time_period` 等字段可能为 undefined，必须 `?? ''` 后再操作

## Key Paths
- DuckDB 服务: `server/src/services/duckdb.ts`
- SQL 生成器: `server/src/sql/*.ts`（16 个模块）
- 字段映射: `server/src/normalize/mapping.ts`
- 业务规则字典: `数据管理/knowledge/rules/车险数据业务规则字典.md`
- Parquet Schema: `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md`

## Common Filters
- orgLevel3（三级机构）、salesmanName（业务员）
- startDate/endDate（签单日期范围）
- insuranceType（险种：商业险/交强险/驾意险）
- vehicleType（车辆类型）

## Priorities
1. 数据准确性（口径正确）
2. 查询性能（避免全表扫描）
3. 空值防护（DuckDB 返回值可能为 null/undefined）
