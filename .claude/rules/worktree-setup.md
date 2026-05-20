# Worktree 配置规则

## 背景

`git worktree add` 创建新工作目录时，**不会**自动 `bun install`。本项目的 `cli/` `mcp/` `server/` 是独立 package.json，worktree 里它们的 `node_modules` 为空，导致：

- `bunx vitest run` 跑到 `cli/__tests__/*` 时报 `Failed to resolve import "cli-table3"`
- 推送被 pre-push hook 的 `bun run test` 拒绝（不是测试失败，是模块解析失败）

## 自动修复（已实施）

`scripts/hooks/post-checkout` 会在 worktree 创建（`git worktree add` 触发的 branch checkout）时自动跑 `bun install` 装缺失的子项目依赖。**唯一前置条件**：执行过一次 `bun run hooks:install`（首次克隆仓库时做）。

### 验证 hook 已生效

```bash
git config core.hooksPath
# 应输出: scripts/hooks
```

如果输出为空 → 跑 `bun run hooks:install` 一次（影响所有 worktree）。

## 手动兜底（hook 失效或 bun 缺失时）

```bash
# 主项目 + workspaces (cli/mcp)
bun install --cwd <worktree>

# server 独立 package（不在 workspaces 内）
bun install --cwd <worktree>/server
```

## 不要做的事

- ❌ **不要** `cp scripts/hooks/* .git/hooks/` 重新走旧 cp 路径 — 会让 worktree 失去 hook
- ❌ **不要** 在 worktree 里改 hook 源文件（hooks 跨 worktree 共享，影响所有人）
- ❌ **不要** 把 `cli/` `mcp/` `server/` 任何一个移出独立 package — workspaces 配置是 root `package.json` 唯一事实源

## 关联

- 升级历史：[scripts/install-git-hooks.sh](../../scripts/install-git-hooks.sh) 从 cp 模式切换到 `core.hooksPath` 模式
- post-checkout 源：[scripts/hooks/post-checkout](../../scripts/hooks/post-checkout)
