---
name: chexian-data-profile
description: 数据概览与质量检查（基础统计、字段完整性、保费分布）
category: data-analysis
version: 1.0.0
author: "@claude"
tags: ["profiling","quality","statistics"]
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

# 数据概览与质量检查

对车险业务数据执行基础统计、字段完整性和保费分布分析。

## 分析内容

### 1. 基础统计
- 保单总数、业务员数、机构数
- 总保费、平均保费、标准差
- 时间跨度

### 2. 字段完整性
- 核心字段缺失值统计
- 数据质量评分

### 3. 保费分布
- 百分位数分析（P05, P25, P50, P75, P95, P99）
- 异常值标记

## 使用示例

```bash
/chexian-data-profile
/chexian-data-profile --output report.md
```

## SQL 查询

参见 data-analysis.md § 1


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/chexian-data-analysis`
