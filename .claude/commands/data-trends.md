---
name: data-trends
description: 时间趋势分析（月度/周度趋势、环比增长、异常检测）
category: data-analysis
version: 1.0.0
author: "@claude"
tags: ["trends","growth","anomaly"]
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

# 时间趋势分析

分析业务数据的时间趋势和异常波动。

## 分析内容

### 1. 月度趋势
- 月度保费与件数
- 环比增长率
- 活跃业务员数

### 2. 周度趋势
- 最近12周数据
- 周度波动分析

### 3. 异常检测
- 环比增长率异常（>100% 或 <-50%）
- 单日保费峰值
- 连续零保费

## 使用示例

```bash
/data-trends
/data-trends --period month
/data-trends --period week --last 12
```

## SQL 查询

参见 data-analysis.md § 3, § 7, § 11


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/data-analysis`
