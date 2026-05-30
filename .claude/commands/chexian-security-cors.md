---
name: chexian-security-cors
description: CORS与文件上传安全检查（COOP/COEP头部、文件验证）
category: security
version: 1.0.0
author: "@claude"
tags: ["cors","file-upload","headers"]
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

# CORS与文件上传安全检查

检查 CORS 配置和文件上传安全措施。

## 检查项

### 1. CORS 配置
- [ ] COOP 头部（DuckDB要求）
- [ ] COEP 头部

### 2. 文件上传安全
- [ ] 文件类型验证（仅 .parquet, .pq）
- [ ] 文件大小限制（<= 50MB）
- [ ] 路径遍历防护
- [ ] 文件名非法字符过滤

## 使用示例

```bash
/chexian-security-cors
/chexian-security-cors --check upload
```

## 详细规则

参见 `/chexian-security-review` 「全量 8 项审查清单」§3-4。全量审查或其它安全域检查由路由器 `/chexian-security-review` 统一分发。
