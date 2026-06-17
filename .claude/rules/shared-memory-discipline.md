# shared-memory user-only 红线（RED LINE）

policy: append-only

> 来源：2026-06-17 全量审计 + 机制化。AGENTS.md §8.3 把 `.claude/shared-memory/**` 与 `~/.claude/shared-memory/chexian/**` 标为 user-only，但红线仅文档化、无自动闸——2026-06-10 出现两次 AI 越权写入。本文件把红线机制化为 `bun run governance` 第 37 项闸（`checkSharedMemoryUserOnly`），并固化违规清单。
>
> 适用：任何会改动 `.claude/shared-memory/**` 的 AI 行为（直接写、复制、迁移、生成）。本规则不替代 AGENTS.md §8.3 user-only 定义，是其执行机制。

## 1. 红线（AI 不得越线）

- **路径**：`.claude/shared-memory/**` 与 `~/.claude/shared-memory/chexian/**` 是 user-only
- **AI 仅可只读引用**：可 Read / Grep / Bash cat，但不得 Write / Edit / NotebookEdit / `git add` 这些路径下的任何文件
- **写操作全禁**：新增 / 修改 / 删除（`git rm`）/ 重命名（`git mv`）均算写操作，**无例外**
  - PR #664 review 教训：原 §1 曾留"治理清理已违规文件"专项例外 + governance check 给"纯 D"留 warning 通道——等于 AI 自我授权后门。已删除；user 若决定清理 shared-memory 文件须本人手动执行（git/shell）后由闸验证零新增/修改
- **不包括 hook 自动写入**：`~/.claude/projects/**/memory/**` 由 auto-memory hook 维护（AGENTS.md §8.3 已注明）

## 2. 备选路径（按内容性质选）

| 内容类型 | 落位 | 理由 |
|---------|------|------|
| 失败教训 / 复盘 / scorecard / PR 校准账 | `.claude/workflow/pr-evolution.md`（append-only entry） | 跨 PR 检索方便；`commit-push-pr-core` / evidence-loop 的标准 sink 位置 |
| 跨项目可复用知识 / skill 内容 | `~/.claude/skills/`（共享 skills 仓 `alongor666-skills`） | 通过 skill 维护流水线（`chexian-crystallize-skill`）发布 |
| 项目级 skill | `.claude/skills/`（本项目内） | frontmatter description 自动注入上下文 |
| 本项目新增护栏规则 | `.claude/rules/`（append-only 新文件） | AGENTS.md §8.2 path-tier policy 显式允许 |
| 频繁演进的知识 / 状态 | `BACKLOG_LOG.jsonl`（append-only event log） | event-log 模型见 `.claude/rules/backlog-eventlog.md` |

## 3. 自动闸（`checkSharedMemoryUserOnly`）

`scripts/check-governance.mjs` 第 37 项 `shared-memory user-only`：

- **扫描范围**（4 路并集，PR #664 review 修正前仅前 3 路 → CI/pre-push clean checkout 漏 commit range）：
  1. `git diff --cached --name-status`（staged）
  2. `git diff --name-status`（working tree unstaged）
  3. `git ls-files --others --exclude-standard`（untracked）
  4. `git diff --name-status origin/main...HEAD`（**已 commit 但未推到 main 的 range**——CI/pre-push 关键，原版漏掉这条 → PR #662 模式可绕过）
- **判定**：
  - 任何 `A`（新增）/ `M`（修改）/ `D`（删除）/ `??`（未跟踪）→ **error, exit 1**
  - 无"纯 D = warning"例外（PR #664 review：D 也是写操作，留例外等于给 AI 自我授权后门）
  - 环境变量 `SHARED_MEMORY_USER_WRITE=1` → user 显式授权豁免（命名带 USER_WRITE 自我提示）
- **触发场景**：`bun run governance`（手动）/ `bun run verify:quick`（人工预检）/ pre-push hook（PreToolUse `git push` 钩子链）/ CI `governance-check.yml`
- **绕过**：仅在 user 本人手动操作 shared-memory 时由 user 本人在 shell 设环境变量。**AI 会话禁用此变量**——若 AI 试图设置，等同自我授权后门，违反 user-only 红线

## 4. 违规清单（chronological）

仅记录 §8.3 红线生效（**2026-04-27 commit `801f84e7`** 用分层 policy 替代扁平禁改名单）**之后**的越权写入。2026-04-27 之前的 shared-memory 文件（含 13 个初始 bootstrap + 4 次 ETL 字段映射归档）属于规则生效前的合规存量，不在违规范围。

| 日期 | Commit | 主题 | 违规文件 | 处置 |
|------|--------|------|---------|------|
| 2026-06-10 | `b3e14e1c` | feat(governance): 守恒恒等式增设演进通道 + 复盘教训固化进共享记忆 | `feedback_retrospective_to_mechanism.md` | 2026-06-17 内容归档到 `.claude/workflow/pr-evolution.md` §A.1，原文件物理删除 |
| 2026-06-10 | `f8866baf` | feat(skills): 沉淀 PR 评审打法为项目级 skill（三层结构 + 自进化协议 + 校准账） | `project_pr_review_calibration.md` | 2026-06-17 内容归档到 `.claude/workflow/pr-evolution.md` §A.2，原文件物理删除 |

**说明**：本规则机制化提交（2026-06-17 PR #664）**不删除**两个违规文件——AI 自行删除违反 §1（即使是清理违规也是写操作；本身就是 owner 在 PR #664 review 中指出的后门）。两文件原文已在 `.claude/workflow/pr-evolution.md` §A 历史归档完整保留可追溯；shared-memory 内的原始副本是否清理由 user 本人在 governance 闸生效后手动决定（`SHARED_MEMORY_USER_WRITE=1 git rm ...`）。

## 5. 关联事故 / 教训

- **memory `feedback_rules_need_automation`**: 规则需自动化执行——文档规则 ≠ 执行规则。本红线在 2026-04-27 至 2026-06-17 仅文档化期间被违反两次，是该模式的又一实证
- **`.claude/workflow/pr-evolution.md` 2026-06-16 entry 第 4 条预防**："pr-evolution.md 作为 scorecard 落位（取代基座默认的 .claude/shared-memory/，避免触发 AGENTS.md §8.3 user-only 红线）"——该 entry 已提示 sink 应迁移，但停在文档层
- **AGENTS.md §8.3 user-only 名单**: 红线的语义定义（"AI 不得修改，只读引用；只能由用户手动 sync / 编辑"）
- **memory `project_evidence_scorecard_writable_path.md`**: chexian-api 内 evidence-loop scorecard 唯一可写 sink 是 `.claude/workflow/pr-evolution.md`

## 6. 禁止

- ❌ AI 通过 Write / Edit / NotebookEdit / `git add` / `git rm` / `git mv` 触动 `.claude/shared-memory/**`（新增/修改/删除/重命名全禁）
- ❌ AI 用 `SHARED_MEMORY_USER_WRITE=1` 环境变量绕过（仅 user 手动操作时设置）
- ❌ 在 `.claude/shared-memory/` 下新增"AI 复盘"/"AI 工作产物"——一律落 `.claude/workflow/pr-evolution.md`
- ❌ 把违规文件的内容"挪到"`~/.claude/shared-memory/chexian/`（user 本地副本，规则同 §8.3）

## 关联

- 自动闸实现：[scripts/check-governance.mjs](../../scripts/check-governance.mjs) `checkSharedMemoryUserOnly`
- AGENTS.md §8.3：项目根 [AGENTS.md](../../AGENTS.md)
- pr-evolution.md sink 协议：[.claude/workflow/pr-evolution.md](../workflow/pr-evolution.md)
- AGENTS.md §8.2 append-only：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权
