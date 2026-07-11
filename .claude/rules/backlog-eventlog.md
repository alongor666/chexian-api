---
paths: ["scripts/backlog/**", "scripts/backlog.mjs", "scripts/governance-backlog-curate.mjs", "BACKLOG.md", "BACKLOG_LOG.jsonl", "BACKLOG_ARCHIVE.md"]
---

# BACKLOG event-log 模型（RED LINE）

policy: append-only

> 来源：2026-06-07「BACKLOG 可变表 → event-log 治本」重构（PR #522）。把 BACKLOG 从「git 里的可变 Markdown 表」换成「append-only 事件日志 + 派生视图」，根治多分支并发下的碰号 / 原地改行冲突 / 手解派生文件三类结构性病。
>
> 适用：任何新增 / 流转 BACKLOG 任务、改动 `scripts/backlog/*` 或 `scripts/governance-backlog-curate.mjs`、处理 BACKLOG 合并冲突的操作。
>
> 本文件取代 [worktree-setup.md](./worktree-setup.md) §A 中「BACKLOG 追加冲突已自动化」一行的旧口径（该行原描述治本前的「可变表 + max+1 取号」模型，已废除）。该 frozen 行已于本次收尾清理（owner `[policy-override]` 授权）同步改写为指向本模型。
>
> **⚠️ 2026-07-09 演进（`[policy-override]` 授权 · 收口于文末 §10）**：派生视图 `BACKLOG.md` / `BACKLOG_ARCHIVE.md` 改为 **gitignored、不进 git**（真相日志成为唯一入库账本）。**§1 / §2 / §4 / §6 中凡描述「视图进 git」「视图 union」「陈旧守卫」的口径，一律以 §10 为准**（陈旧守卫已删除，PR 只碰真相日志、合并顺序无关紧要）。根治动机：把「union 救不了非纯追加渲染 → 陈旧守卫红 → 追尾重渲」这一整类冲突**结构性消除**。

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

## 7. event-log 不根治的一类病：实现-状态漂移（自进化护栏）

event-log 根治了「碰号 / 重复行 / 手解派生文件」三类**结构性**病（§1），但**不**根治
**实现-状态漂移**——任务代码已存在（已并入 main，或躺在开放 PR 分支上），而 BACKLOG
状态仍停在 PROPOSED。两种危害：

1. **已合并却未置 DONE** → 看板谎报「待办」（实证：9377d1/PR #633、9719ff/PR #636 已合并仍标 PROPOSED）。
2. **开放 PR 未在看板登记** → 后续会话误判「未开始」而**重复实现**（实证：992469/PR #635、28bd9c/PR #634 各有开放 PR，险些被重做）。

**护栏（advisory）**：`bun scripts/backlog/check-merged-drift.mjs`
- 判据（高精度）：PROPOSED 任务若存在一条**引用其现代 uid 短后缀**（提交惯例 `(P1 9719ff)`）、
  **改动了非账本文件**、且**命中该任务 `code` 字段声明路径**的提交（`git log --all`，含开放 PR 分支）→ 漂移候选。
- 精度取舍：只认现代 uid 短后缀（≥5 字符），不认曾用号 `B###`（短且在「登记/顺带提及」类提交泛滥，实测 27 例误报）。
- 浅克隆自动 SKIP（不误报）；`--strict` 可作可选 CI 闸（需 `fetch-depth:0` + 全远端分支）。

**用法纪律**：开工一个标 PROPOSED 的任务前，先跑本检测——命中即先核实「已合并 → 置 DONE」/「开放 PR → 勿重复，登记 PR 号」，避免重复劳动。

**误报压制（2026-07-06 追加）**：启发式会命中「记账/引用」类提交（squash 信息提及 uid、
PR 正文声明"分离为后续项"——2026-07-06 逐条权威核实当轮 6 条命中全部属此类，且 note
登记"系误报"后复跑仍原样再报，无压制通道；先例 b714a7 的 PR #874）。机制：人工核实为
误报后，`bun scripts/backlog.mjs note <uid> "check-merged-drift 命中 <短SHA或PR#N> 系误报：<结论>"`
—— 检测器按 (uid, 提交) **逐对**豁免：含「系误报」标记且点名提交短 SHA（≥7 位十六进制，
6 位会撞 uid 短后缀故不认）或 PR 号的 note 才构成压制声明；同 uid 新的不同实现提交仍照常
上报；被压制项在输出中以 🔇 行可见（不静默）。判定纯函数 `scripts/backlog/drift-dismissal.mjs`，
单测 `tests/backlog-drift-dismissal.test.ts` 锁两条路径（压制生效 / 新提交再报）。

## 8. 弃置状态：CANCELLED / WONTFIX（终态扩展，2026-07-04）

> 来源：BACKLOG `2026-06-08-claude-691a87`（P2）。append-only 下，过时/放弃任务此前只有
> `DONE` 一条终态出口，导致确实已弃置的任务只能滞留 `PROPOSED`（体检发现最长滞留约 2 个月）。

- **终态集合**扩展为 `TERMINAL_STATUSES = [DONE, CANCELLED, WONTFIX]`（`scripts/backlog/lib.mjs`），
  三者均移出活跃看板、渲染进 `BACKLOG_ARCHIVE.md`。`DONE` = 完成，`CANCELLED`/`WONTFIX` = 弃置
  （不再打算做；WONTFIX 侧重"确认不修/不做"，CANCELLED 侧重"需求已过时/被取代"，语义细分不影响机制）。
- **证据/理由强制**：与 `DONE` 同一机制——`bun scripts/backlog.mjs status <id> CANCELLED|WONTFIX --evidence "弃置理由"`，
  缺 `--evidence` 一律拒绝写入（`backlog.mjs` `cmdStatus` 检查 `TERMINAL_STATUSES.includes(status)`）。
  `check-governance.mjs` 的 `checkBacklogEvidence`（"BACKLOG证据链"）同步从"仅查 DONE"扩展为
  "查全部终态"，弃置任务的证据列必须非空（内容即弃置理由）。
- **归档渲染**：`BACKLOG_ARCHIVE.md` 保持**单张表**（不拆分"已完成"/"已弃置"两张表）——
  `check-governance.mjs` 的 `parseBacklogTable` 遇到表格结束（非 `|` 开头行）即 `break`，
  拆成两张 `| ID |` 表会导致第二张表内容不被解析、证据链校验静默漏检。改为**同表分组排序**
  （`sortArchiveGrouped`：DONE 在前，CANCELLED/WONTFIX 在后）+ 归档头部计数注明
  "已完成 N · 已弃置 M"，「状态」列本身就是弃置标注，兼顾可读性与解析器兼容。
- **禁止**：不得为图省事把归档拆成多张表；不得绕过 `--evidence` 强制（弃置理由必须人工给出，
  不可留空/填占位符）。

## 9. 复杂度账惯例（登记新任务必答一行，2026-07-04）

> 来源：2026-07-04 全量架构价值审计（67 项活跃任务五分类裁定，owner 拍板固化为登记惯例）。教训：看板曾把"该删的死代码"记成"该合并的重复实现"、给 ADR 已判退役的机制继续登记加固补丁、为未到触发条件的假想敌预建机制。

- **登记新任务时，desc 末尾附一行「复杂度账」**：`【账】做完删 X / 加 Y / 触发条件 Z` —— 三问至少答其一：做完删掉什么（代码/机制/闸）？新增什么长期维护义务？若为防御未来风险，触发条件是什么（**条件未到默认冻结不做**）？
- **五分类 triage 参考**（处置优先级降序）：净简化（删>加）→ 根治性简化（一次结构改变作废一批防御机制，最高杠杆）→ 必要复杂（守护真实风险且无更简替代，先找 80/20 版本）→ 低回报复杂化（触发条件未到 → 冻结挂条件）→ 纯装饰（砍）。
- **判断哲学**：结构性消除 > 检查性防御；删除 > 新增；一个根治 > 十个补丁。给 governance 新增闸前先问：能否用结构性消除让该闸不必存在。
- 本惯例是**登记纪律非硬闸**——不为它新增 governance 检查（那本身违背本惯例的精神）。

## 10. 派生视图不进 git：根治并发冲突的最后一步（2026-07-09 · `[policy-override]`）

> 来源：PR #1005-1008 反复因 BACKLOG 冲突被卡，决策人拍板"彻底避免"。§1 的 event-log 重构
> 让**真相日志**结构上不冲突，但仍**把渲染出来的视图提交进 git**——这是遗留的最后一处冲突源。

**根因**：`merge=union` 只对**纯追加**生效。看板渲染**不是纯追加**——每次 `add/status/note`
都会改写计数表头（`活跃任务速查（N 项）`、`P2（M 项）`）、重排、重新分组。两分支各自渲染的
看板被 union 机械并起来 → 结构错乱且 **≠ 折叠(日志)** → 旧「陈旧守卫」判 CI 红 → PR BLOCKED
→ 必须重渲重推；期间别的 PR 先合并 → 又陈旧 → **追尾循环**。

**根治（结构性消除，非补丁）**：
- `BACKLOG.md` / `BACKLOG_ARCHIVE.md` **gitignored、不进 git**（`.gitignore` 根锚定两行）；
  `git rm --cached` 停止跟踪、本地保留。它们仍是日志的派生视图，仍禁手工编辑，只是**改为本地产物**。
- **唯一入库账本 = `BACKLOG_LOG.jsonl`**（`merge=union`，追加天然可交换）。PR 从此只碰它，
  结构上零冲突/零陈旧，**合并顺序永远无关紧要**。
- `.gitattributes` 删去 `BACKLOG.md/ARCHIVE merge=union` 两行（视图不入库，无需 merge 策略）。
- **陈旧守卫删除**：既无被提交视图可陈旧，`check-governance.mjs` 的「视图 == 折叠(日志)」守卫
  失去存在理由 → 删（呼应 §9「能否用结构性消除让该闸不必存在」）。
- **证据链改为折叠日志直查**：`checkBacklogEvidence` 用 `loadLog()`+`fold()` 在内存任务模型上
  查终态任务 `docs/code/evidence(+notes)`——校验真相而非派生物，更正确。
- **本地看板按需生成**：`bun run backlog:render`（= `governance-backlog-curate.mjs --apply`）。
  `backlog.mjs add/status` 写入后仍本地重渲（写 gitignored 文件，**不再污染 PR diff**）。
  `manage-plans.mjs` 读视图前惰性渲染兜底，避免静默空索引。

**取代的旧口径**（本节权威）：§1 表「视图」行、§2「冲突重新渲染不手解」/「禁止手工编辑视图 governance 会报」、
§4 表视图角色、§6「❌ 手工编辑视图（陈旧守卫会报）」——凡涉「视图进 git / union / 陈旧守卫」
均以本节为准。仍然成立且不变：真相日志 append-only、永不挑号、永不回改历史行、DONE 必带证据。

**代价（诚实边界）**：视图不再能在 GitHub 网页直接浏览（决策人确认可接受）；对 `BACKLOG.md` 的
文档链接在 GitHub 上悬空，但本地渲染后可读，SSOT 链接指向 `BACKLOG_LOG.jsonl`。未采用 A+
（main-only 自动渲染 Action）——保持最省心稳态、不引入 commit-loop 维护面。

**授权**：本节及 §1/§2/§4/§6 的 frozen 正文改写，经决策人 2026-07-09「批准·授权 policy-override」，
标记落本次 PR。设计文档：`开发文档/架构设计/2026-07-09-backlog-不提交派生视图-根治冲突.md`。

## 11. 认领/派发登记：claim / release（防重复派发，2026-07-11）

> 来源：2026-07-10 backlog 治理循环实证。`spawn_task` 派发任务卡与 backlog 状态是**两套互不联动的系统**——把一条 `PROPOSED` 任务派发出去后，backlog 里那条需求**仍停在 PROPOSED**，看板毫无「已派发/在做」痕迹。结果：另一个 Agent（或同一循环再跑一次）看 backlog 以为没人做，**重复认领撞车**（实证：山西维修域 `2815e4` 已有 Agent 在做，backlog 仍 PROPOSED，被本会话重复 spawn 一次才发现）。event-log 的 §7 漂移检测只覆盖「已合并/开放 PR」的实现漂移，**不覆盖「已派发但尚无代码」的认领漂移**——本节补这个洞。

**机制**：`backlog.mjs` 新增 `claim` / `release` 子命令，让「派发」这个动作强制在 backlog 留痕。

| 命令 | 语义 | 转移 |
|------|------|------|
| `bun scripts/backlog.mjs claim <id> [--agent "认领方"] [--note "..."]` | 派发即登记 | 置 `status=DOING` + `owner=认领方` + 认领 note（原子三事件） |
| `bun scripts/backlog.mjs release <id> "撤回理由"` | 撤回认领，交还队列 | `DOING → PROPOSED` + 撤回 note |

**fail-closed 防重复派发（核心）**：`claim` 目标若已是 `DOING`/`IN_PROGRESS`（有人在做）或终态 → **拒绝并非零退出**，从机制上杜绝两个 Agent 认领同一任务。判定纯函数 `scripts/backlog/claim-gate.mjs`（`evaluateClaim`/`evaluateRelease`），单测 `tests/backlog-claim-gate.test.ts` 锁两条路径。

**纪律（RED LINE）**：
- **派发任务卡（`spawn_task`）『之前』必须先 `claim`**——顺序是「先 claim 让 backlog 留痕，再 spawn」，不是反过来。claim 被拒即说明该任务已有人做，**不要 spawn**。
- **撤回任务卡时对称 `release`**，把 DOING 退回 PROPOSED，避免「认领了但没做」的任务永久占位。
- `release` 只针对 `claim` 产生的 `DOING`；`IN_PROGRESS`/`PARTIAL` 是**实质进展态**，用 `status` 正常流转，不用 release 退回。
- 接手他人已 `DOING` 的任务前，先与现 `owner`（看板 owner 列）对齐；确属废弃认领则先 `release` 再 `claim`。

**诚实边界**：本机制是**流程纪律 + 命令闸**，不能在运行时强制 Agent「spawn 前必先 claim」（`spawn_task` 是独立工具，无法拦截）——遵从靠纪律。但一旦遵守，claim 的 fail-closed 判定就能确定性地挡下第二次认领（参 §7 漂移检测的定位：机制降低而非消灭人因漏登）。

## 关联

- 母 PR：[#522 refactor(backlog): 可变表 → event-log 治本](https://github.com/alongor666/chexian-api/pull/522)
- 并发隔离纪律：[worktree-setup.md](./worktree-setup.md) §A
- 实现漂移检测器：[../../scripts/backlog/check-merged-drift.mjs](../../scripts/backlog/check-merged-drift.mjs)（§7）
- 弃置状态设计：[../../scripts/backlog/lib.mjs](../../scripts/backlog/lib.mjs)（TERMINAL_STATUSES）+ [../../scripts/backlog.mjs](../../scripts/backlog.mjs)（§8）
- 认领登记机制：[../../scripts/backlog/claim-gate.mjs](../../scripts/backlog/claim-gate.mjs)（判定纯函数）+ [../../scripts/backlog.mjs](../../scripts/backlog.mjs)（claim/release，§11）
- AGENTS.md §8.2 append-only：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权；§8/§10/§11 为新增小节（append），非改写既有内容
