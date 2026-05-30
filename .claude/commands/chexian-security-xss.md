---
name: chexian-security-xss
description: XSS防护专项检查（输出编码、innerHTML使用、React安全）
category: security
version: 1.0.0
author: "@claude"
tags: ["xss","sanitization","react"]
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

# XSS防护专项检查

检查所有用户输入渲染点是否正确转义。

## 检查项

- [ ] 禁止 dangerouslySetInnerHTML
- [ ] 使用 React 默认转义
- [ ] URL 编码检查
- [ ] 事件处理器安全

## 使用示例

```bash
/chexian-security-xss
/chexian-security-xss --target src/features
```

## 详细规则

参见 `/chexian-security-review` 「全量 8 项审查清单」§5。全量审查或其它安全域检查由路由器 `/chexian-security-review` 统一分发。
