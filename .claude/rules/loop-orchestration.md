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

## 7. 关联

- 单任务闭环基座：`~/.claude/skills/evidence-loop-core/SKILL.md` · wrapper [`.claude/commands/chexian-evidence-loop.md`](../commands/chexian-evidence-loop.md)
- §4 harness 表：[`.claude/rules/evidence-loop.md`](./evidence-loop.md)
- 并发纪律（worktree/分支/簿记 union）：[`.claude/rules/worktree-setup.md`](./worktree-setup.md)
- verifier：[`.claude/agents/evidence-verifier.md`](../agents/evidence-verifier.md) · 对抗第二模型：`codex` skill
- scorecard/复盘 sink：`.claude/workflow/pr-evolution.md`（AGENTS.md §8.3 user-only 路径只读）
- 本文件 append-only（AGENTS.md §8.2）：新增独立护栏文件，无需 `[policy-override]`。
