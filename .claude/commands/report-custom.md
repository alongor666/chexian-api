---
name: report-custom
description: 自定义报告生成（灵活时间范围，自定义维度）
category: reporting
version: 1.0.0
author: "@claude"
tags: ["custom","flexible","report"]
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

# 自定义报告生成

生成自定义时间范围和维度的业务报告。

## 使用示例

```bash
/report-custom --start 2025-10-01 --end 2025-12-31
/report-custom --dimensions 机构,险类 --start 2025-12-01
```

## 支持的维度

- 机构
- 险类
- 续保状态
- 新能源
- 批改类型

## 详细SQL

参见 weekly-report.md 完整文档


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/weekly-report`
