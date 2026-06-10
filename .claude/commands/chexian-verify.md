---
name: chexian-verify
description: 当用户需要在提交或发 PR 前对当前代码库做全面验证时使用 — 三档模式映射到项目真实校验链（build/governance/测试/安全审查），输出结构化通过/失败报告。
category: workflow
scope: project
last_updated: "2026-06-09"
---

# 验证命令（/chexian-verify）

按参数选择档位，逐步执行，任何关键步骤失败立即停止并报告：

## 三档模式

| 模式 | 执行内容 |
|------|---------|
| `quick` | `bun run build`（含类型检查） |
| `full`（默认） | `bun run build` → `bun run governance`（23 项治理校验）→ `bun run test`（单元测试）→ console.log 审计（`grep -rn 'console\.log' src/ server/src/` 报告位置）→ `git status` 未提交变更 |
| `pre-pr` | `full` 全部 + 执行 `/chexian-security-review`（按其分流规则跑专项或全量） |

## 输出格式

```
验证结果: [通过/失败]

构建:     [OK/失败]
治理:     [OK/X 项未过]
测试:     [X/Y 通过]
日志残留: [OK/X 处 console.log]
Git 状态: [干净/X 个未提交文件]

可以发 PR: [是/否]
```

存在关键问题时，逐条列出 文件:行号 + 修复建议。

## 备注

- 集成测试（`bun run test:integration`）需 DuckDB 原生二进制，仅本地手动跑，不在本命令范围
- worktree 中测试加载阶段整套失败时，先查原生模块损坏（memory `feedback_worktree_native_module_proxy_corruption`），不是测试问题

**目标**: $ARGUMENTS（quick / full / pre-pr，缺省 full）
