---
name: security-cors
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
/security-cors
/security-cors --check upload
```

## 详细规则

参见 security-review.md § 3-5


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/chexian-security-review`
