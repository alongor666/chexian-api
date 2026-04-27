---
name: cleanup-worktrees
description: 清理已合并到 main 的 .claude/worktrees/ 下 worktree + 本地分支
category: git-workflow
version: 1.0.0
author: "@claude"
tags: [git, worktree, cleanup, workflow]
scope: project
requires:
  - git
last_updated: "2026-04-27"
---

# 清理已合并的 Worktree

批量回收 `.claude/worktrees/` 下已合并到 `origin/main` 的 worktree 与本地分支。
**不动** `.codex/worktrees/`（codex CLI 自管），**不动**未合并/有未提交改动/正在使用中的 worktree。

---

## 触发方式

`/cleanup-worktrees`

可选参数：`--dry-run` 只列出会被清理的项目，不执行删除。

---

## 执行步骤

按顺序执行，每一步必须等上一步完成才进入下一步。**遇到任何 SKIP 原因都打印出来**，不静默跳过。

### 1. 拉取 main 最新引用

```bash
git fetch origin main
```

### 2. 列出候选 worktree

```bash
git worktree list --porcelain | awk '/^worktree / {print $2}' \
  | grep -E '/\.claude/worktrees/' || true
```

### 3. 逐个判定（5 项必须全部通过才清理）

对每个候选 worktree（路径变量 `WT`，分支变量 `BR`），按顺序执行：

```bash
# A. 解析分支
BR=$(git -C "$WT" symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ -z "$BR" ]; then echo "SKIP $WT: detached HEAD"; continue; fi

# B. 分支前缀必须是 claude/
case "$BR" in
  claude/*) ;;
  *) echo "SKIP $WT: branch '$BR' is not under claude/"; continue ;;
esac

# C. 不能是当前 shell cwd 所在的 worktree（不删脚下）
CUR_WT=$(git rev-parse --show-toplevel)
if [ "$WT" = "$CUR_WT" ]; then echo "SKIP $WT: this is the current worktree"; continue; fi

# D. 工作区必须干净
if [ -n "$(git -C "$WT" status --porcelain)" ]; then
  echo "SKIP $WT: dirty working tree"
  continue
fi

# E. 分支 HEAD 必须是 origin/main 的祖先（真正合并判定）
HEAD=$(git -C "$WT" rev-parse HEAD)
if ! git merge-base --is-ancestor "$HEAD" origin/main; then
  echo "SKIP $WT: branch '$BR' (HEAD ${HEAD:0:8}) not merged to origin/main"
  continue
fi

# 全部通过 → 清理
echo "REMOVE $WT (branch=$BR, head=${HEAD:0:8})"
if [ "$DRY_RUN" != "1" ]; then
  git worktree remove "$WT"
  git branch -D "$BR"
fi
```

### 4. 总结

打印：
- 清理 N 个 worktree（列出名字）
- 跳过 M 个（每个跳过原因）
- `git worktree list` 最终状态

---

## 红线

| 红线 | 做法 |
|------|------|
| 永不动 `.codex/worktrees/` | grep 过滤只匹配 `.claude/worktrees/` |
| 永不动 detached HEAD | symbolic-ref 失败立即 SKIP |
| 永不动当前 worktree | `git rev-parse --show-toplevel` 比较 |
| 永不强删脏工作区 | 任何 untracked/modified 文件 → SKIP |
| 永不用 `git branch --merged` | 它对 worktree 持有分支漏判，必须用 `merge-base --is-ancestor` |
| 永不 `git worktree remove --force` | 失败立即 SKIP，让用户手动处理 |
| 永不在 webhook/cron 自动跑 | 必须用户主动 `/cleanup-worktrees` 触发 |

---

## 适用场景

- ✅ PR 合并后清理对应 worktree
- ✅ 阶段性回收磁盘（每完成 2-3 个 PR 跑一次）
- ✅ 列出所有 worktree 状态用 `--dry-run`

## 不适用场景

- ❌ 清理 codex CLI 创建的 worktree（codex 自管）
- ❌ 清理远程分支（`git push origin --delete` 由 PR 合并时 GitHub 自动处理）
- ❌ 清理未合并的 WIP 分支（用户必须先合并或主动 `git branch -D`）
