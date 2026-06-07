# BACKLOG event-log 模型（RED LINE）

policy: append-only

> 来源：2026-06-07「BACKLOG 可变表 → event-log 治本」重构（PR #522）。把 BACKLOG 从「git 里的可变 Markdown 表」换成「append-only 事件日志 + 派生视图」，根治多分支并发下的碰号 / 原地改行冲突 / 手解派生文件三类结构性病。
>
> 适用：任何新增 / 流转 BACKLOG 任务、改动 `scripts/backlog/*` 或 `scripts/governance-backlog-curate.mjs`、处理 BACKLOG 合并冲突的操作。
>
> 本文件取代 [worktree-setup.md](./worktree-setup.md) §A 中「BACKLOG 追加冲突已自动化」一行的旧口径（该行原描述治本前的「可变表 + max+1 取号」模型，已废除）。该 frozen 行已于本次收尾清理（owner `[policy-override]` 授权）同步改写为指向本模型。

## 1. 模型（道）

| | 旧（可变表，已废除） | 新（event-log） |
|---|---|---|
| 真相 | `BACKLOG.md` 手维护的表 | **`BACKLOG_LOG.jsonl`**（append-only 事件日志，`merge=union`） |
| 视图 | 同一文件既是真相又是视图 | `BACKLOG.md`（活跃）/ `BACKLOG_ARCHIVE.md`（归档）= 折叠日志渲染的**派生物** |
| 写入 | 改表行 + `assign-task-id.mjs` 取 `max+1` 号 | **追加事件**（`create`/`status`/`note`/`amend`），**写入方永不挑号** |
| 身份 | 序号 B###（并发下会碰） | 创建时生成的稳定 **uid**；曾用号 B234… 对历史任务保留显示，兼容旧引用 |

**根治的三类病**（结构性消除，非修补）：
1. **碰号** — 写入方永不挑号；编号在折叠时按时序渲染，**无可碰撞之物**。（旧 `max+1` 从本地读全局计数派生 = 竞态，是 B339/B340 一场治理撞两次的根因。）
2. **原地改行冲突 / union 重复行** — 状态变更 = 追加 `status` 事件，从不回改旧行；每行内容唯一 → `merge=union` **永不产生重复行**。
3. **手解派生文件** — 视图 = 纯函数(日志)；冲突时**重新渲染而非手解**。

## 2. 铁律

| 铁律 | 做法 |
|------|------|
| 禁止手工编辑视图 | `BACKLOG.md` / `BACKLOG_ARCHIVE.md` 是派生物，**只读**。改动一律改日志（追加事件）后重新渲染 |
| 唯一写路径 | 新增/流转任务一律 `bun scripts/backlog.mjs add\|status\|note\|amend`（写入后自动重渲染视图） |
| 永不挑号 | 不存在「取下一个编号」这一步；uid 由创建时生成。旧 `assign-task-id.mjs` 已删除 |
| 完成必带证据 | `bun scripts/backlog.mjs status <id> DONE --evidence "PR/commit/测试证据"`（缺证据会被拒） |
| 冲突重新渲染不手解 | merge 后若 governance「BACKLOG事件日志」陈旧守卫报「视图 != 折叠(日志)」→ `bun scripts/governance-backlog-curate.mjs --apply` 重渲，**禁止手解** |
| 日志行禁原地改 | `BACKLOG_LOG.jsonl` append-only；纠错也用 `amend`/`status` 追加，不回改/删除历史事件行 |
| 并发确定性 | 每条事件带 `at`（全时间戳）+ `eid`（事件唯一键）；折叠按「分支无关」键 `(at, eid)` 排序，结果与 union 合并的文件行序无关 |

## 3. 并发同 uid 同字段的收敛（codex PR #522 P2）

两个分支可能对同一 `uid` 在同一天各追加不同 `status`/`amend`。收敛保证：

- **确定性排序**：折叠对非 `create` 事件按 `(at || ts, eid)` 全序排序（分支无关），`create` 永远先于其 uid 的其余事件。结果**不依赖** union 合并后的物理行序。
- **末写生效（LWW）**：同字段多次写入，按 `at` 时间戳取最后一条（语义明确、可复现）。
- **冲突可见**：`validateLog` 对「同一 uid、同一天、出现 ≥2 个不同 `status` 值」发出**警告**，提示人工确认（避免 DONE / BLOCKED 这类对冲被静默 LWW 覆盖而无人知）。

## 4. 文件与工具

| | 路径 | 角色 |
|---|------|------|
| 真相 | `BACKLOG_LOG.jsonl` | append-only 事件日志（`merge=union`） |
| 视图 | `BACKLOG.md` / `BACKLOG_ARCHIVE.md` | 折叠日志渲染的派生物（禁手编辑） |
| 核心库 | `scripts/backlog/lib.mjs` | 解析 / 折叠 / 渲染 / 校验 SSOT |
| 写入入口 | `scripts/backlog.mjs` | `add/status/note/amend/list` |
| 渲染器 | `scripts/governance-backlog-curate.mjs` | 折叠日志 → 渲染视图（幂等） |
| 播种（一次性） | `scripts/backlog/migrate.mjs` | 旧表 → 事件日志 + 逐列等价校验 |
| 校验 | `scripts/check-governance.mjs`「BACKLOG事件日志」 | 结构 / 无孤儿 / uid·曾用号唯一 + 陈旧守卫 |

## 5. 已删除（可变表时代遗留）

`assign-task-id.mjs`（不再挑号）/ `merge-backlog.mjs` / `archive-backlog.mjs` / `cleanup-backlog.mjs` / `check-write-conflict.mjs` 五个脚本已**物理删除**（2026-06-07 收尾清理）。其中 `check-write-conflict.mjs` 的通用预检（分支基准 / merge 冲突标记）已由 PR 前 `git rebase origin/main` 纪律 + `bun run governance` 覆盖；其在 `chexian-commit-push-pr.md` §3.2 的钩子一并退役。`check-task-id-conflict.mjs` 保留（已重写为 event-log 校验薄壳）。

## 6. 禁止

- ❌ 手工编辑 `BACKLOG.md` / `BACKLOG_ARCHIVE.md`（派生物；governance 陈旧守卫会报）
- ❌ 在 `BACKLOG_LOG.jsonl` 里回改 / 删除历史事件行（append-only；纠错用追加事件）
- ❌ 复活 `assign-task-id.mjs` 或任何「取下一个编号」逻辑（碰号根因）
- ❌ 用 `merge=union` 以外的策略处理 `BACKLOG_LOG.jsonl`，或对视图冲突手解

## 关联

- 母 PR：[#522 refactor(backlog): 可变表 → event-log 治本](https://github.com/alongor666/chexian-api/pull/522)
- 并发隔离纪律：[worktree-setup.md](./worktree-setup.md) §A
- AGENTS.md §8.2 append-only：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权
