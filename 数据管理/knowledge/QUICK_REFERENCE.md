# 车险数据快速参考

> 本页是 `policy/current/` 的自动刷新快照与权威入口导航。
> 域清单、枚举占比、JOIN 规则和命令不在此复述，避免形成会漂移的影子事实源。

**更新**: 2026-07-21 | **数据规模**: ~450 万条 / 48 字段 | **分片**: 9 个 Parquet（policy/current/）

## 数据规模（三层口径）

| 口径 | 数值 | 说明 |
|------|------|------|
| 原始记录 | ~450 万行 | policy/current UNION ALL 行数 |
| 唯一保单 | ~437 万 | COUNT DISTINCT policy_no |
| 2024+ 活跃 | ~195 万行 | policy_date >= 2024-01-01 |

## 权威入口

| 要查什么 | 现行入口 |
|---|---|
| 注册数据域与 ETL 契约 | [`../data-sources.json`](../data-sources.json)（以 `domains` 数组为准） |
| DuckDB 关系与跨域 JOIN | 导航见 [`ai/DOMAIN_OVERVIEW.md`](./ai/DOMAIN_OVERVIEW.md)，变更前回查对应 SQL 实现 |
| 字段结构与值域 | [`ai/PARQUET_SCHEMA_KNOWLEDGE.md`](./ai/PARQUET_SCHEMA_KNOWLEDGE.md) |
| 业务定义、隐私与统计口径 | [`rules/车险数据业务规则字典.md`](./rules/车险数据业务规则字典.md) |
| ETL 可执行入口 | [`../daily.mjs`](../daily.mjs) 与根目录 [`package.json`](../../package.json) 的 scripts |

枚举占比和机构排名属于随数据变化的查询结果，应从当前 Parquet/API 实时计算，不在知识文档中冻结百分比。
