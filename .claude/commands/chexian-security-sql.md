---
name: chexian-security-sql
description: SQL注入防护专项检查（输入清理、SQL验证器、LIKE子句）
category: security
version: 1.0.0
author: "@claude"
tags: ["sql-injection","validation","sanitization"]
scope: project
requires:
  - DuckDB
  - bun
dependencies:
  - server/src/services/duckdb.ts
  - server/src/sql/*.ts
parent_command: security-review
parent_version: "2.0.0"
last_updated: "2026-01-11"
---

# SQL注入防护专项检查

检查所有SQL构建代码是否使用安全函数和验证器。

## 检查项

### 1. SQL 注入防护
- [ ] 使用 sanitizeInput() 清理用户输入
- [ ] 使用 validateSQL() 验证查询
- [ ] 使用 buildSafeLikeClause() 构建 LIKE 子句

### 2. SQL 验证器合规性
- [ ] 只读限制（仅 SELECT/WITH）
- [ ] PolicyFact 边界
- [ ] 隐私保护（禁止 SELECT policy_no）
- [ ] 聚合要求

## 使用示例

```bash
/chexian-security-sql
/chexian-security-sql --target src/shared/sql
```

## 详细规则

参见 `/chexian-security-review` 「全量 8 项审查清单」§1-2。全量审查或其它安全域检查由路由器 `/chexian-security-review` 统一分发。
