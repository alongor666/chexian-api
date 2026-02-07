---
name: report-weekly
description: 生成周报（自然周数据，环比分析，业绩排名）
category: reporting
version: 1.0.0
author: "@claude"
tags: ["weekly","report","kpi"]
scope: project
requires:
  - DuckDB-WASM
  - bun
dependencies:
  - src/shared/duckdb/client.ts
  - src/shared/sql/*.ts
parent_command: report-report
parent_version: "2.0.0"
last_updated: "2026-01-11"
---

# 周报生成

生成指定自然周的业务周报。

## 使用示例

```bash
/report-weekly
/report-weekly --week 50
/report-weekly --start 2025-12-09 --end 2025-12-15
```

## 报告内容

- 核心KPI（当前周 vs 上周）
- 业绩排名
- 续保分析
- 异常预警

## 详细SQL

参见 weekly-report.md § 1-3


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/weekly-report`
