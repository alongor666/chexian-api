---
name: security-xss
description: XSS防护专项检查（输出编码、innerHTML使用、React安全）
category: security
version: 1.0.0
author: "@claude"
tags: ["xss","sanitization","react"]
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

# XSS防护专项检查

检查所有用户输入渲染点是否正确转义。

## 检查项

- [ ] 禁止 dangerouslySetInnerHTML
- [ ] 使用 React 默认转义
- [ ] URL 编码检查
- [ ] 事件处理器安全

## 使用示例

```bash
/security-xss
/security-xss --target src/features
```

## 详细规则

参见 security-review.md § 3


---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: `/security-review`
