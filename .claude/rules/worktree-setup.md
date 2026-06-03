# Worktree 配置规则

> 两部分：**§A 多会话并发纪律**（根治"分支被其他会话切换" + 减少合并冲突）· **§B worktree 依赖安装机制**（原内容）。

## A. 多会话并发纪律（RED LINE）

### 为什么需要

多个 Claude / codex 会话**共享同一个主工作目录的单一 git HEAD** 时，各自 `git checkout` 会互相打架：A 会话切到自己分支，B 会话又切走 → "分支被其他会话切换"、未提交改动张冠李戴、并发改同一文件 merge 冲突。worktree 给每个会话**独立 HEAD + 独立工作树**，从物理上消除"分支被切换"。

⚠️ worktree 只能根治"分支被切换"（工作树隔离），**根治不了"合并冲突"**——冲突是内容级（多分支改同一文件同一区域），需配合下面的 union / 重新生成策略。

### 铁律

| 规则 | 做法 |
|------|------|
| 主目录锁 `main` 只读 | 主目录 `chexian-api/` 永远停在 `main`，作集成 / 基线区，**禁止在主目录直接 checkout 业务分支开发**（曾出现主目录卡在他人 WIP 分支） |
| 每会话进独立 worktree | 开工第一步：`git worktree add -b <branch> ../chexian-api-<task> origin/main`，全程在该兄弟目录工作 |
| worktree 放**兄弟目录** | 放 `../chexian-api-<task>`（与主目录同级，如现有 `chexian-api-postal-policy-dedupe`）。**不要**放 `.claude/worktrees/`——该路径被工具权限 deny，Read/Edit/cd 全部失败 |
| 提交前查重 | commit / push 前必 `git fetch origin main` + 搜同名 open/merged PR（防重复劳动：2026-05-30 sync-and-reload 守卫修复撞上已合并的 PR #448，白做） |
| 派生文件冲突**重新生成不手解** | `data-sources.json` / `QUICK_REFERENCE.md` / `转换质量报告.json` 是 ETL 派生（结构稳定，仅 row_count / 规模数字变）。merge 冲突时跑 `node 数据管理/daily.mjs`（或对应生成器）重新生成 + `git add`，**禁止手解**。三者均有 governance / ETL 配置消费方（daily.mjs 读 data-sources.json 取域配置；check-governance.mjs 读另两者校验），**禁止移出 git 追踪** |
| BACKLOG 追加冲突已自动化 | `.gitattributes` 已对 `BACKLOG.md` 设 `merge=union`，多分支往末尾加 B3xx 自动合并；仍建议追加到末尾、ID 取全局最大 +1 |

### 反模式：禁止用 `git sparse-checkout` 物理执行"主目录只读"

**历史事故**（2026-06-03 session `a241089d`）：有 AI 会话把"主目录禁开发"误执行为 `git sparse-checkout set server/src/config/metric-registry/`——后果是 `scripts/`、`src/`、`tests/`、`数据管理/{daily.mjs,pipelines,integrations}` 被物理裁掉 **1416/1492 个跟踪文件**，本地 governance / sync-vps / readiness 全部跑不了；该会话最后只能给出"转由 CI 跑"的妥协，单次反馈环 7-10 分钟，效率倒退。

**机制错配的根因**——§A 铁律各条目的**正确**执行机制：

| 目标 | ❌ 错误机制（sparse-checkout） | ✅ 正确机制 |
|------|------------------------------|------------|
| 禁止主目录开发改代码 | 把 scripts/src/tests/ 全裁 | CLAUDE.md 红线 + PR 流程 + branch protection |
| 防本地脏 commit 推 main | 把代码裁掉让人改不了 | GitHub branch protection + `pre-push` hook |
| 并发隔离 / 长任务不阻塞 | sparse 无关 | **git worktree（本规则唯一指定机制）** |
| 主目录跑 governance / sync-vps / ETL | sparse 把 scripts/ 裁掉 → 跑不了 | **应该能跑**（只读 / 数据运维不是代码开发） |

**禁止条款**：

- ❌ 任何 AI agent / 自动化脚本不得在主目录执行 `git sparse-checkout init` / `set` / `add` / `reapply`
- ❌ 不得通过裁文件方式"加强" §A 铁律——铁律靠**纪律 + CI + branch protection 三层**，不靠物理隔离

**检测与处置**：

```bash
# 检测
git config core.sparseCheckout        # 期望 false 或 unset
[ -e .git/info/sparse-checkout ] && echo "⚠ 已开启" || echo "✓ 未开启"

# 处置（含主目录两个长期未提交派生文件的 stash 保护）
git stash push -m "wip: pre-disable" 数据管理/data-sources.json 数据管理/knowledge/QUICK_REFERENCE.md
git sparse-checkout disable
git stash pop
bun install
bun run governance && node scripts/check-data-readiness.mjs   # 期望分别 23/23 与 4/4 全过
```

发现 sparse-checkout 被开启时，**必查上游 skill / 自动化脚本**找出真凶并修源头，避免重蹈覆辙。

### 收尾

合并后用 `cleanup-worktrees` skill 清理已合并的 worktree + 本地分支。

## B. worktree 依赖安装机制

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
