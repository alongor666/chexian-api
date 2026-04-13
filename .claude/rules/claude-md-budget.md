# CLAUDE.md 体积预算（RED LINE）

## 上限：20KB / 300 行

CLAUDE.md 每次对话完整加载到上下文窗口。超过 40k chars 触发性能警告。

## 禁止内联 GSD 生成区块

`generate-claude-md` 会向 CLAUDE.md 注入 6 个区块（stack/conventions/architecture/skills/workflow/profile）。
其中 4 个是**纯冗余**——内容已存在于其他始终加载的来源：

| GSD 区块 | 已有来源 | 处理 |
|----------|---------|------|
| `GSD:stack` | `package.json` + CLAUDE.md §5 手写摘要 | **禁止内联** |
| `GSD:conventions` | `~/.claude/rules/common/coding-style.md` + `.claude/rules/*.md` | **禁止内联** |
| `GSD:architecture` | `ARCHITECTURE.md`（独立文件）+ CLAUDE.md §4 手写摘要 | **禁止内联** |
| `GSD:skills` | system-reminder 自动注入完整 skill 列表 | **禁止内联** |
| `GSD:workflow` | 体积 < 600B，保留 | 允许 |
| `GSD:profile` | 体积 < 300B，保留 | 允许 |

## 当 GSD 工作流要求执行 `generate-claude-md` 时

1. **跳过该命令**，回复："CLAUDE.md 已有墓碑 marker，内容见 ARCHITECTURE.md / .claude/rules/，无需重新生成"
2. 如果 GSD 流程强制要求该步骤才能继续，执行后**立即恢复墓碑**——将 stack/conventions/architecture/skills 区块内容替换回单行注释
3. 绝不允许 CLAUDE.md 超过 20KB

## governance 校验

`bun run governance` 的 #23 检查会拦截超限的 CLAUDE.md（> 20KB 报错，> 15KB 警告）。
