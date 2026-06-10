---
name: chexian-test-coverage
description: 测试覆盖率分析与增强建议。当用户说"跑测试覆盖率/查测试情况/补充测试"时触发。
category: development-tools
version: 1.1.0
author: "@claude"
tags: [testing, coverage, vitest]
scope: project
requires:
  - bun
  - vitest
dependencies:
  - .claude/agents/tdd-guide.md
  - vitest.config.ts
last_updated: "2026-06-09"
---

# /chexian-test-coverage

测试覆盖率分析命令，检查单元/组件/集成/E2E 测试覆盖情况并给出增强建议。

## 分级覆盖率目标

详见 `.claude/agents/tdd-guide.md` "分级覆盖率目标" 表格。摘要：

| 测试类型 | 目标 |
|----------|------|
| 单元测试 | > 80% |
| 组件测试 | > 70% |
| 整体综合 | > 75% |

## 真实命令（package.json 核实）

```bash
bun run test              # 运行全部单元测试（vitest）
bun run test:coverage     # 生成覆盖率报告（vitest --coverage）
bun run test:integration  # 集成测试（仅本地，需 DuckDB 原生二进制）
bun run test:e2e          # E2E 测试（需先 bun run dev:full）

# 覆盖率 HTML 报告
open coverage/index.html
```

注意：CLAUDE.md §5 CI 测试分层协议——集成测试仅本地跑，CI 环境已在 `vite.config.ts` 中排除。

## 覆盖率报告输出格式

```markdown
## 测试覆盖率报告

### 整体覆盖率: X% （目标 > 75%）

#### 按模块统计
- SQL 生成器: X% ✅/⚠️/❌
- 工具函数: X% ✅/⚠️/❌
- React 组件: X% ✅/⚠️/❌
- Hook: X% ✅/⚠️/❌

#### 未覆盖的关键文件（0% 覆盖率）
- [文件路径列表]

### 优化建议（按优先级）
1. [模块] — 补充 [具体测试点]
```

## 相关文件

- `.claude/agents/tdd-guide.md` — TDD 流程与完整覆盖率阈值
- `vitest.config.ts` — Vitest 配置
- `vitest.integration.config.ts` — 集成测试配置
- `tests/` — 测试目录
