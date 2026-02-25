---
name: data-kpi
description: 业绩分析与排名（Top30业务员、机构对比、四象限分层）
category: data-analysis
version: 1.0.0
author: "@claude"
tags: ["kpi","ranking","performance"]
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

# 业绩分析与排名

对业务员和机构进行多维度业绩分析和四象限分层。

## 分析内容

### 1. 业务员排名
- Top 30 业务员（按保费）
- 保费区间分布
- 多维度指标（续保率、新能源占比等）

### 2. 机构业绩对比
- 各机构全维度对比
- 人均产能分析

### 3. 四象限分析
- Q1: 明星业务员
- Q2: 大单专家
- Q3: 新手待培养
- Q4: 效率待提升

## 使用示例

```bash
/data-kpi
/data-kpi --top 50
```

## SQL 查询

参见 data-analysis.md § 2, § 4


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/data-analysis`
