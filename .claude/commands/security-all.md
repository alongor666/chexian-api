---
name: security-all
description: 全量安全审查（8项检查完整覆盖）
category: security
version: 1.0.0
author: "@claude"
tags: ["audit","comprehensive","all"]
scope: project
requires:
  - DuckDB-WASM
  - bun
dependencies:
  - src/shared/duckdb/client.ts
  - src/shared/sql/*.ts
parent_command: security-review
parent_version: "2.0.0"
last_updated: "2026-01-11"
---

# 全量安全审查

执行所有8项安全检查。

## 审查清单

1. 🔴 SQL 注入防护
2. 🔴 SQL 验证器合规性
3. 🟠 XSS 防护
4. 🟠 CORS 配置
5. 🟡 文件上传安全
6. 🟡 隐私保护
7. 🟢 依赖安全
8. 🟢 环境变量管理

## 使用示例

```bash
/security-all
/security-all --target all
```

## 详细规则

参见 security-review.md 完整文档


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/security-review`
