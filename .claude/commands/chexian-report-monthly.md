---
name: chexian-report-monthly
description: 生成月报（自然月数据，同比环比，趋势分析）
category: reporting
version: 1.0.0
author: "@claude"
tags: ["monthly","report","trends"]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts
  - server/src/sql/*.ts
parent_command: report-report
parent_version: "2.0.0"
last_updated: "2026-01-11"
---

# 月报生成

生成指定自然月的业务月报。

## 使用示例

```bash
/chexian-report-monthly
/chexian-report-monthly --month 2025-12
```

## 报告内容

- 月度KPI（当前月 vs 上月）
- 趋势分析
- 各机构对比
- 业务洞察

## 详细SQL

参见 weekly-report.md § 1-3


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/chexian-report-weekly`
