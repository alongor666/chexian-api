---
name: data-export
description: 数据导出工具（CSV/JSON/Excel格式，支持筛选和聚合）
category: data-analysis
version: 1.0.0
author: "@claude"
tags: ["export","csv","excel","json"]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts
  - server/src/sql/*.ts
parent_command: data-report
parent_version: "2.0.0"
last_updated: "2026-01-11"
---

# 数据导出工具

将分析结果导出为各种格式。

## 支持格式

- CSV: 通用格式，适合 Excel/数据库导入
- JSON: 程序化处理
- Excel: 带格式的报表

## 使用示例

```bash
/data-export --query "SELECT * FROM PolicyFact LIMIT 1000" --format csv
/data-export --query "SELECT 业务员, SUM(保费) FROM PolicyFact GROUP BY 业务员" --format excel
```

## 筛选和聚合

支持所有标准 SQL 查询，必须通过 SQL 验证器。


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/data-analysis`
