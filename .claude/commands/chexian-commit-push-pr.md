---
name: chexian-commit-push-pr
description: Git 提交并创建 Pull Request（commit-push-pr-core 的本项目 wrapper）
category: git-workflow
version: 3.0.0
author: "@claude"
tags: [git, pr, workflow, automation, conflict-detection]
scope: global
requires:
  - gh CLI
  - bun
dependencies:
  - ~/.claude/skills/commit-push-pr-core/SKILL.md
  - .claude/pr-checklist.md
  - scripts/check-governance.mjs
last_updated: "2026-06-07"
---

# Git 提交并创建 PR（commit-push-pr-core 的本项目 wrapper）

完整 commit → push → PR 流程与跨项目 git 护栏（包管理器探测、大文件拦截、
unrelated-histories、rebase 后 lockfile 同步、LFS、push 后回主干、Post-PR
验证 + 自进化）都在基座 **commit-push-pr-core** 里。本文件只声明本项目挂载点
与特例，不重复骨架。

## 当前上下文

```bash
$(git branch --show-current)
$(git status --short)
$(git log --oneline -3)
$(git diff --stat origin/main 2>/dev/null || git diff --stat main)
```

## 执行

### 1. 读并执行基座流程

读 `~/.claude/skills/commit-push-pr-core/SKILL.md`，**逐节执行** §0→§7：
分析变更 → conventional commit → 前置检查（§3）→ 提交推送 → 建 PR → 回 main → Post-PR 验证 + 自进化。

### 2. 基座挂载点（基座会自动读取，本项目已就位）

| 基座挂载点 | 本项目提供 |
|-----------|-----------|
| 红线自审清单（§3.4） | `.claude/pr-checklist.md`（依赖链 + 7 行红线表 + 输出格式 + codex 第二意见 + 部署链特例） |
| 冲突检测钩子（§3.2） | `bun run governance`（含 merge 冲突标记扫描 + BACKLOG 事件日志陈旧守卫）+ 基座自带 rebase/merge 处理。旧 `check-write-conflict.mjs` 已退役：BACKLOG 冲突由 event-log（`merge=union` + 派生视图）结构性消除，分支基准由 PR 前 `git rebase origin/main` 纪律保证 |
| 治理校验钩子（§3.3） | `bun run governance`（聚合 26 项检查，等价于 `scripts/check-governance.mjs`） |
| 自进化日志（§0.3 / §7） | `.claude/workflow/pr-evolution.md` |

### 3. 本项目特例（覆盖基座通用项）

- **包管理器固定 bun**（基座会自动探测到 `bun.lock`，本项目无歧义）。
- **治理用 `bun run governance`**（聚合脚本），不是直接调单个 `.mjs`。
- **BACKLOG 实现漂移预检（防重复劳动）**：提交/建 PR 前，若本次改动是在推进某个 BACKLOG 任务，先跑 `bun scripts/backlog/check-merged-drift.mjs`。命中「标 PROPOSED 但已有实现提交」→ **停下核实**：已合并 → 直接置 DONE 不重做；开放 PR 未合并 → 勿提交竞品实现，改为复用/评审该 PR（实证：本机制已拦下 992469/28bd9c 两次重复实现）。见 `.claude/rules/backlog-eventlog.md` §7。
- **Git LFS** 大文件示例：`git lfs track "*.parquet"`。
- **`{owner}/{repo}`** 在基座 §7 的 actions/runs API 中即 `alongor666/chexian-api`。
- **部署链 PR**（`deploy.yml` / `vps-wrapper/**` / `sync-vps.mjs` / `ecosystem.config.cjs`）**禁止 auto-merge**，见 `.claude/pr-checklist.md` §4 与 `.claude/rules/deploy-chain-sop.md`。

### 降级（基座不可读时）

若 `~/.claude/skills/commit-push-pr-core/SKILL.md` 未安装/不可读：
执行 `npx skills add alongor666/alongor666-skills -g --skill commit-push-pr-core` 安装，
或按上表挂载点 + `.claude/pr-checklist.md` 手动走「分析 → 自审 → 冲突检测 → 治理 → 提交 → push → PR → 回 main」全流程（禁止直推 main）。
