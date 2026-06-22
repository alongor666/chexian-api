---
paths: ["scripts/loop/**", ".claude/workflow/**", "BACKLOG_LOG.jsonl"]
---

# Loop v2 编排协议（多会话并行调度 + 双对抗闸 + 质量度量 + 自进化）

policy: append-only

> **加载方式**：本文件带 `paths:` 门控（按需加载，不计入 eager-load 预算）——做 loop 工作
> （触碰 `scripts/loop/**` / `.claude/workflow/**` / `BACKLOG_LOG.jsonl`）时自动注入。入口指针在
> `CLAUDE.md` / `skills-map.md` / `chexian-evidence-loop` wrapper。

> **来源**：2026-06-21 三会话并行实跑（G7/G8/RLS，PR #708/#709/#710/#712 零冲突合并）后复盘。
> 暴露 4 缺口：① 无总调度（各自完成后无人推进）② 规划后/完成后无 codex 对抗审计闸
> ③ 无结构化质量度量与记录 ④ 自进化项（needs_automation）缺到期催办回路。本协议补齐之。
>
> **定位**：本协议是「多个 evidence-loop 单任务」之上的**编排层**。单任务闭环（合同六要素 / 8 步 loop /
> verifier 隔离 / scorecard）仍以 `evidence-loop-core` 基座 + `/chexian-evidence-loop` wrapper 为准，
> 本协议不重复，只新增「跨任务调度 + 双对抗闸 + 质量账本 + 进化回路」。

---

## 0. 总流程（Loop v2）

```
[Backlog 事件日志 (SSOT)]  每任务 create 事件的 code 字段 = 文件域信号；deps 见 dispatch-config.json
        │
        ▼
① 调度器 dispatch.mjs：折叠日志→算「可并行前沿」(文件域冲突图的独立集) + 状态板 + 会话提示词
        │  （文件域重叠 / deps 未满足 / 在飞 / BLOCKED → 不进前沿）
        ▼
   每个前沿任务 = 一条 evidence-loop 流水线（混合编排：脚本算前沿 + Workflow 跑并行执行）：
        ② 合同/计划（evidence-loop-core 合同六要素 + §4 harness）
        ③ 🛡 对抗闸-1（codex 审【计划】）→ 修 P0/P1 → 放行
        ④ TDD 实现（隔离 worktree，off 最新 main）
        ⑤ 确定性闸：bun run verify:full / governance / 字节安全证据
        ⑥ 🛡 对抗闸-2（codex 审【完成 diff】+ evidence-verifier 证伪 + CI auto-review）→ 修 P0/P1 → 复审
        ⑦ commit（bundle 代码+backlog 流转+复盘+质量账本一行）→ PR → enable --auto
        │
        ▼
⑧ 合并探测（dispatch.mjs 重算前沿）→ 推进下一波，循环至队列空/预算尽
        │
        ▼
⑨ meta-review（每 N 任务/周）：quality-report.mjs + automation-due.mjs → 升级机制 / 进化本协议
        │
        ▼
🔴 GATED cutover 闸：调度器永不自动跨越，须用户显式确认
```

---

## 1. 调度层（混合：脚本算前沿 + Workflow/会话执行）

**SSOT = `BACKLOG_LOG.jsonl`**（append-only 事件日志，已 `merge=union`）。无需新数据源。

- **文件域**：每任务 `create` 事件的 `code` 字段（逗号/空格分隔路径）映射到**粗粒度域桶**（`be-sql`/`be-routes`/`be-services`/`be-config`/`be-middleware`/`frontend`/`etl`/`scripts`/`docs`，规则见 `dispatch.mjs:bucketOf`）。
- **冲突图**：两任务**共享任一域桶**即连边。`scripts/loop/dispatch-config.json` 可：① `tasks.<uid>.domain` 覆盖域（细调）② `deps.<uid>=[uid…]` 声明前置 ③ `inflight=[uid…]` 标记在飞（防重复派单）④ `tasks.<uid>.exclude` 排除。
- **可并行前沿** = OPEN（非 DONE/BLOCKED）+ deps 全 DONE + 非在飞 的任务里，按优先级贪心取**域互斥的独立集**。其余串行到后续波。
- **粗粒度优先安全**：域桶宁粗勿细（误判"可并行"→ 冲突；误判"需串行"→ 仅慢一点）。需要更细并行时用 config `domain` 覆盖。

**执行（C·混合）**：
- `bun run loop:dispatch` 输出：当前前沿 + 状态板 + 每个前沿任务的可粘贴会话提示词。
- 两种跑法：
  - **Workflow 执行**：一个编排会话用 Workflow 工具把前沿 fan-out 成隔离 worktree 子代理跑流水线（②–⑦），自动探测完成→`loop:dispatch` 重算→下一波。
  - **多交互会话**：把前沿提示词分发到 N 个会话（各自 off 最新 main 建 worktree），合并后任一会话 `loop:dispatch` 看新前沿。
- **新分支一律 off `origin/main`**；每会话每轮起手 + push 前 `git fetch origin main && git merge origin/main`（非 rebase，免 force-push 与 auto-merge 竞态）。

---

## 2. 双对抗闸（codex）

> codex 平台 auto-review 已失效（memory `feedback_codex_review_auto_off`）→ 现靠 `claude-code.yml` auto-review job。
> codex **CLI 经 `codex` skill 仍可手动调**（"ask codex"/"codex review"）。本协议把对抗审计固化为**两道强制闸**。

- **闸-1（计划对抗·阶段 ②后）**：合同/计划写好后，调 `codex` skill 对抗审查**设计**（缺陷 / 遗漏 / 更优解 / 边界）。P0/P1 修复后才进实现。结论计入质量账本 `codex_plan`。
- **闸-2（完成对抗·阶段 ⑤后、enable --auto 前）**：调 `codex` skill 审 **diff 完成质量** + `evidence-verifier` agent 独立证伪（fresh context）+ `claude-code.yml` CI auto-review。**三源 P0/P1 全修 + 复审通过**才合并。结论计入 `codex_done` / `verifier_refuted`。
- **降级**：codex CLI 不可用时，闸用 `evidence-verifier` + CI auto-review 双源，并在质量账本标 `codex_*: {"unavailable":true}`，**不得静默跳过对抗**（向用户报缺口，参 `feedback_no_giveup_ask_authorization`）。
- **降级分层（2026-06-22 · PR #732 补）**：codex 对抗源按可用性**逐级**降级，**不得**因 `codex` skill 报 `Unknown skill` 就直接跳到 evidence-verifier：① skill 在 → 经 skill 调；② **skill 包装缺失但 CLI 在**（`command -v codex` 命中，如 `/opt/homebrew/bin/codex`）→ 直接 `codex exec --sandbox read-only - < <prompt 文件>`（prompt 走 stdin 文件，避开反引号 / `${}` 的 shell 转义事故）；③ CLI 也不可用 → 才退 `evidence-verifier` + CI 双源并标 `unavailable`。**教训**：本次 `Unknown skill: codex` 但 `/opt/homebrew/bin/codex` 实际可用，险被误判"对抗源不可用"。

---

## 3. 质量账本（度量与记录）

- **`.claude/workflow/loop-quality-ledger.jsonl`**（append-only，`merge=union`）：每任务收尾 append 一行结构化指标：
  ```json
  {"uid":"...","round":"R12","ts":"2026-06-21","task":"一句话","domain":["be-sql"],
   "rounds_to_green":1,"rework_count":0,
   "codex_plan":{"P0":0,"P1":1,"P2":2},"codex_done":{"P0":0,"P1":0,"P2":1},
   "verifier_refuted":0,"byte_safety_proof":"by-construction","tests_added":6,
   "governance_pass":true,"pr":704,"verdict":"pass"}
  ```
  字段语义见 `dispatch.mjs`/`quality-report.mjs` 注释。`byte_safety_proof ∈ golden-baseline|by-construction|n/a`。
- **`bun run loop:quality`**（`quality-report.mjs`）聚合 → 北极星：**一次过率**（rounds_to_green=1 且 rework=0）/ 平均转绿轮次 / 平均返工 / codex 命中（plan+done 各级合计）/ governance 通过率，按域 + 按 round 趋势。
- 与 `pr-evolution.md` 互补：**账本=量化指标，复盘=定性教训**。两者同一收尾步一起写。

---

## 4. 自进化回路

- 三问复盘（每任务）→ `needs_automation: true` 紧跟 `expires: YYYY-MM-DD`（governance #703 闸保新增不漏）。
- **`bun run loop:automation-due`**（`automation-due.mjs`）：扫 `pr-evolution.md`，列**已过期**（< 今日）/ **临期**（默认 14 天内）/ **缺 expires** 的 needs_automation 项 → meta-review 时强制处置（升级为脚本/governance/hook 或显式撤项 + 记复盘）。补 governance #703 只拦"新增缺 expires"的盲区（它不催办**已过期**项）。
- **meta-review**（每 ~10 任务或每周）：读 `loop:quality` + `loop:automation-due` → 改进本协议 / 调度 / 闸 → append 本文件一节（append-only）或 `pr-evolution.md` 一条 meta entry。**loop 改 loop**。
- **meta（2026-06-22 · PR #732）· 新失败类「误报前提任务」+ 调度层证成员资格**：
  - **现象**：派单"在别处修同款 X（如 PR #Y 那样）"，但 X 在新点经数据流根本不成立——本次 claims_detail 的 `"${policyDir}"` 经 `runPythonScript` 中央剥引号 → 非 bug；且上游 `e9507542` 那处去引号经 codex 确认是冗余 no-op，**站不住的根因又派生出本任务**。
  - **与 stale 的区别**：`loop:stale-scan` 只抓"已完成未流转"，抓不到"前提就错"。这是**独立失败类**。
  - **进化规则**：dispatch / 派单步骤对"修同款"类任务，须先**追一条代表性调用链（调用点 → helper → 消费端 argparse/Path）证明失败在新点重现 + 给最小复现**，再纳入前沿——把"修一类前先证成员资格"（`feedback_codex_review_fix_sop` 逆向护栏）**上提到调度层**：pattern 相似 ≠ 类成员资格。
  - **印证 codex 闸-2 价值**：本次窄范围对抗不止"抓 bug"——(a) 独立确认核心判断、降自我 pattern-match 风险 (b) 揪出正交既存隐患（full_snapshot 缓存键漏 extraArgs → `task_6d1e8053`）。即便常规变更，一次窄范围对抗也划算。
- **meta（2026-06-22 · 本 PR）· 启用合并队列（merge queue）根治「CI 双绿但 state=BEHIND」活锁**：
  - **现象**：每次落地 CI 双绿但 `state=BEHIND`——CI（Production Gate ≈ 3min）跑的期间别的 loop PR 合入 main，使本 PR 落后；`strict=true` 要求分支含最新 main → 绿了也合不了 → 人工 update-branch 重跑又赌一次没人插队，高并行下几乎每次复现。
  - **根因（三因相乘，非 loop 逻辑 bug）**：main 分支保护 `strict=true`（要求分支 up-to-date）× 并行 PR 在合并门汇聚（在飞 K≥2 且 CI 完成时间重叠时，严格模式下只 1 个能合、其余瞬间全 BEHIND，self-invalidation）× **无 GitHub 合并队列**。靠"`git fetch origin main && git merge` 再 push"纪律赢不了——让你 BEHIND 的那次 main 前进，正是这批并行 PR 自己制造的。`enable --auto` 在 strict 下**不自动 update-branch**，故"绿了也不合"。三七开：平台机制缺口 ~60% / loop 并行度把偶发放大成每次 ~40%。
  - **进化**：启用 GitHub 合并队列。队列把每个 PR **投机性 rebase 到队列尾**、对"未来 main 状态"跑必需检查、按序合并 → `BEHIND` 从定义上消失，且**保住"组合被一起测过"的保证**（优于关 strict）。配套：`production-gate.yml` / `governance-check.yml` 加 `merge_group` 事件触发（否则队列等不到同名 status → 合并门卡死）；deploy.yml 不动（merge_group 跑队列分支被 `branches:[main]` 过滤，不触发部署）。
  - **落地语义变更（loop 端几乎零改动）**：⑦ 的 `gh pr merge --auto` 命令**不变**——队列启用后 `--auto` 自动变为"加入合并队列"。⑧ 合并探测**不再需要手动 update-branch**（队列负责串行 rebase + 合）。"enable --auto 后禁再 push"仍成立。
  - **回滚**：删除 merge queue ruleset 即恢复旧行为（workflow 的 merge_group 触发空跑无害，可保留）。
- **meta（2026-06-22 · 更正上一条）· 合并队列对个人账号仓不可用 → 实际改走 `strict=false`**：
  - **上一条 meta 的「启用 GitHub 合并队列」未能落地**：本仓 owner 是**个人账号（User，非 organization）**。`POST /repos/.../rulesets` 的 `merge_queue` rule 返回 422 `Invalid rule 'merge_queue'`；鉴别测试（同结构换 `non_fast_forward` rule 可成功创建）坐实**仅 merge_queue 被拒**——GitHub 合并队列只对 organization 仓开放，public 与否无关。教训：**推荐平台机制方案前必先核前置约束（此处 = 仓库 owner 类型），「public 就能用合并队列」是错的**。
  - **实际修复**：关 main 分支保护的 `strict`（`required_status_checks.strict=false`，保留两必需检查 Production Readiness Gate + Governance Consistency Check）。BEHIND 活锁消除（双绿即可合，不再要求 up-to-date）；代价是放弃「组合一起测过」的保证，靠 ① dispatch 文件域隔离压低语义冲突 ② deploy/production-gate 的 push-main 后兜底。
  - **merge_group 触发保留**：阶段1 给两 workflow 加的 `merge_group` 无害空跑（无队列不触发），为将来若迁 org 启用队列留路；届时只需建 merge_queue ruleset + 重新开启 strict（或交由队列接管）。
  - **本条所属 PR 自身即方案 B 的端到端验证**：strict 已关后，本 PR 应双绿即合、不再卡 `state=BEHIND`。
- **meta（2026-06-22 · wave-2 复盘）· 跨会话重复劳动(P0) + 限流韧性(P0) + bucketOf 目录归桶(P1·本 PR 已修)**：
  - **P0「跨会话重复劳动」（仍未解·待协调后单 owner 实现）**：wave-2 派 b331，6h 内**另一会话也做 b331 并先合并**（`1e19b486` 1401→882），我的 agent 工作孤儿化作废。根因=`computeFrontier` 的 `inflight` 仍是 `dispatch-config.json` **本地配置、非跨会话共享**；多会话各跑 dispatch 都见同任务"可派"，无认领锁。**根治方向**：认领即 `bun scripts/backlog.mjs status <uid> IN_PROGRESS --actor <session>` 并立即 push（event-log union 跨会话可见）；dispatch 先 `git fetch` 再折叠，排除"新鲜 IN_PROGRESS 认领"（带时效防死锁）。远程分支 `claude/loop-<slug>` 存在性是**辅助**信号（对方未 push 前无效），event-log 认领才是主锁。
  - **P0「限流韧性」**：wave-2 两 high-effort agent 在 Anthropic 服务端限流窗口同时重试，跑 21.9M ms 后 `dev:[]` 零产出；b244 未到 push 即死=无 checkpoint。**根治**：① 并发 ≤2、effort 按任务难度而非一律 high、限流期不强推大并发波；② agent 尽早 commit/push（即便 WIP）留 checkpoint；③ 派大波前先轻量探一个 agent 试水再放大。
  - **P1「bucketOf 目录归桶」（本 PR 已修 + 单测）**：边界用 `(?:\/|$)` 替硬尾斜杠——目录形式 code（`server/src/sql` 无尾斜杠）旧版误归 be-other，致域互斥漏判（b331 与 b244 在 `claims-detail.ts` 真重叠未被检出，险并行撞车，靠人工拦下）。
  - **元教训**：本会话另一浪费源是「**多会话无协调地并发硬化 loop 机制**」本身——§4 出现 merge-queue→strict=false 的来回、本会话也险些重复别人已修的 BEHIND 活锁。**建议：loop-meta（本协议 / dispatch.mjs 等）改动由单一 owner 会话串行，功能任务才并行**。
- **meta（2026-06-22 · 本 PR）· 方案 B 配套：合并门串行化闸（dispatch ⑧）— 不迁 org 近似恢复「组合一起测过」**：
  - **决策**：BEHIND 活锁的「真正根治 = 迁 org 启用合并队列」经完整影响清单 + 回滚预案评估后**决定不迁**——owner 单人协作、止血方案（`strict=false`）已实测生效，迁 org（建 org / 重建 6 secrets+1 variable / 复核部署链 SSH / 生产域名）属不可逆性高的大手术，对单人 loop 自动化性价比低（合并队列的杀手锏是团队级高并发问题）。改在 `strict=false` 之上加一道**合并门串行化闸**，零生产风险拿到合并队列的主要收益。迁 org 完整清单 + 回滚预案见本 PR 描述（将来加入真实协作者 / 质量账本出现实测并行语义冲突时再迁）。
  - **机制**：`dispatch.mjs` 新增纯函数 `mergeGate(tasks, config)` + `bun run loop:dispatch --merge-gate` 模式 + `--json` 的 `mergeGate` 字段。给定在飞集（`config.inflight`）确定性算出**合并次序**（priority→uid，与 computeFrontier 一致）：同一时刻只 1 个 slot holder 有资格合，其余排队。computeFrontier 把在飞**排除出前沿**（不重复派单）、本闸把在飞**纳入合并门**（决定谁先合），二者互补复用同一 `inflight` 源。剔除已 DONE / 不在 backlog 的脏 inflight 项防卡门。
  - **协议落地（⑦/⑧）**：enable --auto 前先 `bun run loop:dispatch --merge-gate` 确认自己是 slot holder；不是则等前序 PR 落地 main → `git fetch origin main && git merge origin/main` 重新转绿 → 再 enable --auto。于是每个 PR 都对**累积后的 main** 验证过 → 近似恢复合并队列的「组合被一起测过」，无需迁 org。`sessionPrompt` 第 6 步已固化此纪律。
  - **与 strict=false 的关系**：strict=false 消除 BEHIND（活锁根治）；串行化闸补回 strict=false 放弃的「组合一起测过」。两者叠加 = 不迁 org 的足够好替代。
  - **将来若迁 org**：合并队列（投机 rebase 更强）可完全替代本闸，届时 `mergeGate` 可退役、`merge_group` 触发接管。本闸是「不迁 org 期间」的过渡机制，非永久。
  - **单测**：`scripts/loop/__tests__/loop.test.mjs` 加 6 个 mergeGate 用例（空在飞 / 单个 / 多个排序 / DONE 剔除 / 脏 uid 剔除 / 缺 priority 兜底）。
- **meta（2026-06-22 · 本 PR · 单 owner 串行实现 loop-meta）· P0「跨会话重复劳动」根治落地：event-log 认领锁（带 TTL）**：
  - **承接**：上文 wave-2 复盘登记的 P0「跨会话重复劳动（仍未解·待协调后单 owner 实现）」。按其根治方向落地，遵守「loop-meta 改动单 owner 串行」元教训（本 PR 即单会话串行实现，无并发硬化）。
  - **上游根因（复述）**：`computeFrontier` 的 `inflight` 仅 `dispatch-config.json` **本地配置、非跨会话共享**——多会话各跑 dispatch 都见同任务「可派」，无认领锁。wave-2 实证：派 b331，6h 内另一会话也做并先合并，agent 工作孤儿化。
  - **机制（三件套）**：① **主锁=event-log 认领**：会话开工即 `bun scripts/backlog.mjs status <uid> IN_PROGRESS --actor <branch>` 并立即 push（`BACKLOG_LOG.jsonl` merge=union 跨会话可见）；`sessionPrompt` 第 2 步已固化「认领先于实现」。② **dispatch 跨 ref 收集认领**：新增纯函数 `latestClaims(events)`（取每 uid 最新 status 事件，命中 `CLAIM_STATUSES={IN_PROGRESS,DOING}` 即认领，与 fold 同 `(at,eid)` 全序）；CLI `gatherClaimContext` 默认 `git fetch origin` 后扫 `origin/main` + **所有 `origin/claude/*`**（认领常在会话 feature 分支尚未并 main）的 `BACKLOG_LOG.jsonl`，union 去重后 `latestClaims` 折叠；`computeFrontier` 把**新鲜认领**（age<`claimTtlHours`，默认 8h）锁出候选/前沿。③ **辅助信号=远程分支存在**（复用 stale-scan `branchMatchesUid`）：前沿任务有匹配 `claude/loop-*` 分支但无认领事件 → 软提示「疑似已开工未认领」，**不硬锁**（对方未 push 认领前是弱信号）。
  - **带时效防死锁**：认领后超 TTL 无后续事件（会话疑似死亡）→ 视为**陈旧认领**释放回前沿（`released`），状态板 ♻️ 段提示人工确认原会话是否仍在做。`computeFrontier` 纯函数注入 `claims/now/claimTtlHours`，缺时钟信息保守视为新鲜（宁串行勿重复派单）。
  - **向后兼容**：无 `claims/now`（或 `--no-claims`）→ 行为与旧版完全一致（`IN_PROGRESS` 仍按 `OPEN_STATUSES` 候选）。`inflight` 字段保留作本地/单会话编排兜底 + 合并门串行化输入，与认领锁互补。
  - **实测验证（本机当下并发态）**：默认 dispatch 见 `b244`(0.64h)/`b255`(1.13h) 新鲜认领 → 锁出前沿（旧 `--no-claims` 下二者仍是候选，会被重复派单）；`b332`(430h)/`35998a`(88h) 陈旧 → 释放。候选 64→62 = 恰好 2 个新鲜锁，零误伤。这正是 wave-2「另一会话先做」的实时拦截证据。
  - **新增/变更**：纯函数 `latestClaims` + `computeFrontier`（新增 `config.claims/now/claimTtlHours`，返回新增 `claimed/released`）；CLI `gatherClaimContext` + `--no-fetch`/`--no-claims` 旗标；`dispatch-config.json` 增 `claimTtlHours`；`sessionPrompt` 增认领步。单测加 13 例（`latestClaims` 5 + `computeFrontier` 认领锁 7 + 边界）。`bun run governance` 44/44、全量单测 3715/3715 通过。
  - **不 cd 主仓**：`gatherClaimContext` 用 `git -C "${ROOT}"`（worktree 内 fetch/show），不触发主目录守卫。
  - **三问复盘**：① 重来更好？认领锁本可与 wave-2 同期落地（根因当时已诊断清楚），延后一波才补——根因明确即应同 PR 修，勿只登记。② 复用价值？`latestClaims`（事件日志取最新认领态）可被 stale-scan / 其他 loop 工具复用，避免各自实现折叠。③ 自动化？认领锁本身即「把纪律变机制」；残留人工点=会话必须真的执行「认领先于实现」步——`sessionPrompt` 已固化，但仍依赖会话遵从。`needs_automation: true`（认领遗漏的硬闸：dispatch 检出「远程分支存在但无认领」时可升级为更强提示/pre-push 闸）`expires: 2026-09-22`。

---

## 5. 终局闸（GATED cutover）

🔴 RLS-on → SX 进 `current/` → sync VPS → 发账号：**对外不可逆**，调度器/Workflow **永不自动跨越**，须用户显式确认（ADR D5 / Day-1 SOP）。dispatch.mjs 对带 `gated:true`（config）的任务**永不纳入前沿**。

---

## 6. 命令速查

| 命令 | 作用 |
|---|---|
| `bun run loop:dispatch` | 算可并行前沿 + 状态板 + 会话提示词 |
| `bun run loop:quality` | 质量账本聚合报告（北极星 + 趋势） |
| `bun run loop:automation-due` | 到期/临期/缺 expires 的 needs_automation 清单 |
| `bun run loop:stale-scan [--churn]` | 列疑似陈旧任务（note 完成信号 + git churn 旁路改动） |
| `bun run loop:dispatch --merge-gate` | 合并门串行化闸：当前 slot holder + 排队（strict=false 下同一时刻只放一个 PR 过门，每个 PR 对累积后的 main 验证过） |

## 7. 关联

- 单任务闭环基座：`~/.claude/skills/evidence-loop-core/SKILL.md` · wrapper [`.claude/commands/chexian-evidence-loop.md`](../commands/chexian-evidence-loop.md)
- §4 harness 表：[`.claude/rules/evidence-loop.md`](./evidence-loop.md)
- 并发纪律（worktree/分支/簿记 union）：[`.claude/rules/worktree-setup.md`](./worktree-setup.md)
- verifier：[`.claude/agents/evidence-verifier.md`](../agents/evidence-verifier.md) · 对抗第二模型：`codex` skill
- scorecard/复盘 sink：`.claude/workflow/pr-evolution.md`（AGENTS.md §8.3 user-only 路径只读）
- 本文件 append-only（AGENTS.md §8.2）：新增独立护栏文件，无需 `[policy-override]`。
