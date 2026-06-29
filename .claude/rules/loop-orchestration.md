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
        ③ 🛡 对抗闸-1（codex 审【计划】）[🔴 默认关闭·仅用户本次显式要求才跑] → 修 P0/P1 → 放行
        ④ TDD 实现（隔离 worktree，off 最新 main）
        ⑤ 确定性闸：bun run verify:full / governance / 字节安全证据
        ⑥ 🛡 对抗闸-2（codex CLI 审【完成 diff】· code review 单源）[🔴 默认关闭·仅用户本次显式要求才跑] → 修 P0/P1 → 复审
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

## 2. 双对抗闸（codex）· 🔴 默认关闭·显式才跑（2026-06-29 用户指令）

> **默认状态（2026-06-29 起·`[policy-override]`）**：codex 双闸**默认不跑**——loop / evidence-loop 收尾**不再默认调 codex**。仅当**用户本次显式要求**（如「这次跑 codex 评审」「过一遍 codex 对抗」）时才执行下面闸-1 / 闸-2。**默认的 code review 改由 Claude `/code-reviewer` 自审兜底**（fresh 自审 + 修复 SOP，见 memory `feedback_codex_review_off_by_default`），**不起 evidence-verifier**；正确性由阶段 ⑤ 确定性闸（`verify:full` / `governance` / golden-baseline / duckdb 直查）正交承担。即「默认 LLM 评审从 codex 换成 /code-reviewer」，非「无 LLM 评审」。变更原委见 §4 末 meta（2026-06-29）。
>
> codex 平台 auto-review 已失效（memory `feedback_codex_review_auto_off`）。
> codex 评审**一律走 codex CLI 直接调**（`codex exec --sandbox read-only - < <prompt 文件>`），**不经 `codex` skill**（2026-06-27 用户指令「安排 codex 做评审就是让 codex CLI 做对抗性评审，不要当成技能」，见 §4 末 meta）。
>
> **🔴 code review 单源 = codex CLI（2026-06-25 用户指令，见 §4 末 meta）**：**当本次显式启用时**，闸-1 审【计划】、闸-2 审【完成 diff】**只用 codex CLI**。
> **不再起 `code-reviewer` / `evidence-verifier` 等 Claude 子代理做 LLM 对抗，也不把 `claude-code.yml` CI auto-review 计作闸源**（CI job 仍可在 PR 上空跑，但不作为闸-2 的判定源）。
> correctness oracle 由阶段 ⑤ 确定性闸（`verify:full` / `governance` / golden-baseline / duckdb 直查）承担，与本 code-review 闸正交、不受本收敛影响。

- **闸-1（计划对抗·阶段 ②后·🔴 默认关闭，仅本次显式要求才跑）**：合同/计划写好后，**直接调 codex CLI**（`codex exec --sandbox read-only`，不经 skill）对抗审查**设计**（缺陷 / 遗漏 / 更优解 / 边界）。P0/P1 修复后才进实现。结论计入质量账本 `codex_plan`（未跑则不产出该字段）。
- **闸-2（完成对抗·阶段 ⑤后、enable --auto 前·🔴 默认关闭，仅本次显式要求才跑）**：**直接调 codex CLI**（`codex exec --sandbox read-only`，不经 skill）审 **diff 完成质量** —— **code review 单源 = codex CLI**（2026-06-25 + 2026-06-27 用户指令）。**本次显式跑了**才有此闸；跑了则 **P0/P1 全修 + 复审通过**才合并，结论计入 `codex_done`。**默认（未跑 codex）时** code review 由 Claude `/code-reviewer` 自审兜底，合并凭 `/code-reviewer` 通过 + 阶段 ⑤ 确定性闸 + CI 双绿 + 非部署链。**不再起 `code-reviewer` / `evidence-verifier` 子代理，也不把 CI auto-review 计作闸源**；correctness 由阶段 ⑤ 确定性闸承担（正交）。
- **降级（仅当本次显式要求跑 codex、但 CLI 不可用时相关）**：code review 已收敛为 codex CLI 单源 → 用户要求跑却 codex 完全不可用时**无 LLM 兜底闸**：标 `codex_*: {"unavailable":true}` 并**向用户报缺口请授权**（`feedback_no_giveup_ask_authorization`），**不得静默跳过、也不得擅自回退 `evidence-verifier` / CI 兜底**；阶段 ⑤ 确定性闸照常跑。**未显式要求时 codex 本就默认不跑，不触发本降级。**
- **调用方式（2026-06-22 · PR #732 引入"逐级取用"；2026-06-27 据"不经 skill"用户指令收敛为 CLI 直调两级）**：**默认直接调 codex CLI，不经 `codex` skill**：① CLI 在（`command -v codex` 命中，如 `/opt/homebrew/bin/codex`）→ `codex exec --sandbox read-only - < <prompt 文件>`（prompt 走 stdin 文件，避开反引号 / `${}` 的 shell 转义事故）；② CLI 不可用 → 标 `unavailable` 并**向用户报缺口请授权**（不回退 `codex` skill / `evidence-verifier` / CI；阶段 ⑤ 确定性闸照跑）。**教训（保留）**：曾因 `codex` skill 报 `Unknown skill` 险误判"对抗源不可用"，而 `/opt/homebrew/bin/codex` 实际可用——故现在**不经 skill、直接认 CLI**。
- **评审 prompt 编排（2026-06-27 · 防 codex 自主搜索污染输出）**：codex 是 agentic CLI——**prompt 里禁止指示它跑 `git diff`/`grep`/`rg` 去"找"待审内容**，否则它会自主扩大搜索、扫到机器上记录本次对话的 `~/.claude/projects/*.jsonl`（高频含 codex/skill 字样），输出被污染到几十 KB 且把会话内容喂给 codex（`--sandbox read-only` 只挡写不挡读、全盘可读）。**铁律 = 任务自包含**：① 由本会话在 shell 跑好 `git -C <wt> --no-pager diff origin/main`（范围我定）+ 需要的 `sed -n` 文件片段，拼「prompt 头 + diff + 尾」喂 stdin；② prompt 开头硬性禁令兜底「仅据三引号内材料判断，禁跑 git/rg/grep/find/cat/ls、禁读文件——材料已贴全」；③ **消除搜索动机 > 下禁令**（禁令是软约束、遵从非 100%·`feedback_prompt_needs_code_backup`；喂全后 codex 无动机搜）→ 不探索、输出短、`| tail -n 60` 取结论。**兜底**：diff 太大→分块/只贴改动关键文件（**不退回**让 codex 自跑 diff）；确需 codex 自主探索代码库→限范围（"只在 server/src 下搜"）+ cwd 设 `/tmp` 空目录（只放 changes.diff）+ `codex exec --json` 取最终 message 丢中间日志。**实证 2026-06-27**：首轮让 codex 自跑 grep→输出 81KB（扫到会话 JSONL）；改自包含 + 禁令→23KB 干净。

---

## 3. 质量账本（度量与记录）

- **`.claude/workflow/loop-quality-ledger.jsonl`**（append-only，`merge=union`）：每任务收尾 append 一行结构化指标：
  ```json
  {"uid":"...","round":"R12","ts":"2026-06-21","task":"一句话","domain":["be-sql"],
   "rounds_to_green":1,"rework_count":0,
   "codex_plan":{"P0":0,"P1":1,"P2":2},"codex_done":{"P0":0,"P1":0,"P2":1},
   "byte_safety_proof":"by-construction","tests_added":6,
   "governance_pass":true,"pr":704,"verdict":"pass"}
  ```
  字段语义见 `dispatch.mjs`/`quality-report.mjs` 注释。`byte_safety_proof ∈ golden-baseline|by-construction|n/a`。
  - **`verifier_refuted` 字段 2026-06-25 起弃用**：闸-2 收敛为 codex CLI 单源、不再跑 evidence-verifier，新行**不再产出**该字段（`quality-report.mjs` 以 `Number(...)||0` 兜底，缺失即计 0，旧行兼容保留）。对抗命中以 `codex_plan`/`codex_done` 为准。
- **`bun run loop:quality`**（`quality-report.mjs`）聚合 → 北极星：**一次过率**（rounds_to_green=1 且 rework=0）/ 平均转绿轮次 / 平均返工 / codex 命中（plan+done 各级合计）/ governance 通过率，按域 + 按 round 趋势。
- 与 `pr-evolution.md` 互补：**账本=量化指标，复盘=定性教训**。两者同一收尾步一起写。
- **E1 失败记账（治茧房1 幸存者偏差·2026-06-27）**：账本原只在「成功收尾步」记账 → 失败/孤儿/放弃任务走不到记账点 → 北极星只算幸存样本、放弃率不可见（实测 58 样本 0 fail/orphaned，一次过率 36.2% 是幸存值）。E1 补齐：
  - **verdict 规范集扩**为 `pass | partial | reverted | abandoned | orphaned | blocked`（`reason` 必附）；既有历史成功变体（实测 5 种顶层 `pass-*` 共 7 行 + `all_fixed`/`mergeable` 同义词）由 `quality-report.normalizeVerdict`（**单一事实源**，`dispatch` import 复用·前缀 `pass-*`/`pass_*` + 同义词白名单归一）**读时归一**到 `pass`+子标记——**不迁移既有 append-only 行**（改写历史行会在 `merge=union` 下产生新旧重复），归一在读时做，「非 pass 纳入分母」口径据归一后判定才稳。
  - **失败行**（`dispatch` 自动记账）`{uid, ts, task, domain, verdict, reason, claim_at?(orphaned 去重键), actor?}`——**不造** `rounds_to_green/governance_pass` 等完成指标（`aggregate` avg 只算有指标的行，缺失≠0）。
  - **孤儿/阻塞幂等记账**：`bun run loop:dispatch`（**仅默认交互模式**，非 `--json/--board/--merge-gate`；`--no-orphan-ledger` 退出）把 `computeFrontier` 的 `released`（陈旧认领→`orphaned`）与 `blocked`（→`blocked`）补记账本。三层防重复：① **accounted 守卫**（uid 已有完成态行 pass/partial/reverted → 跳过，排除「完成未流转」假阳性，属 `stale-scan` 域非 E1 域）② **orphaned (uid,claim_at) 写时去重**（claim_at=认领时刻，跨 dispatch 稳定，**非**刷新的 lastAt；重新认领=新尝试记新行）③ **blocked uid 去重**（任务级状态）。并发/`union` 重复由 `aggregate` **读时去重**兜底（orphaned 按 (uid,claim_at)、blocked 按 uid）——单 owner 串行非幂等证明，读时去重才是并发下的真保证。
  - **会话异常退出**经「认领先于实现」步留下 IN_PROGRESS 认领 → 超 TTL 无活动 → `released` → `orphaned`，故异常退出由孤儿路径覆盖（前提=已认领）。
  - **指标口径**：放弃率=（abandoned+orphaned）/n（blocked 单列阻塞率，BLOCKED 多为等待非放弃）；孤儿率=orphaned/n；阻塞率=blocked/n；governance 通过率分母=全部尝试（失败行计未过，诚实）。**残留诚实边界**：静默活跃长任务（>TTL 无事件但实际在做）会被记 orphaned，靠 accounted 守卫自愈（完成后不再记）+ reason 带陈旧时长，不做两阶段确认（既有 `released` 机制已判 TTL-stale=死，加状态复杂度过工程）。`env LOOP_LEDGER_PATH/LOOP_BACKLOG_LOG` 可覆盖路径（默认真实文件，供 e2e 隔离）。
- **E2 注入外部真相（治茧房3 自指闭环·2026-06-27）**：账本原只读自产自评，外部真相断在闭环外。E2 接两条外部真相线（均「事后外部真相·读时关联到任务·**不改 append-only 历史行**」，结构对称）：
  - **① git 史反查事后回滚**（`quality-report.{parseRevertedPrs,collectRevertedPrs,effectiveVerdict}`，纯函数可单测、`runGit` 可注入免 CI spawn git）：`git log -E -i --grep='(revert|回滚|hotfix)' --pretty=format:%s` 扫 revert 类提交解析「被回滚原 PR 号」——**`-E` 必须**（无则 `|` alternation 失效、命中 0·codex #812 P1）、**`-i` 必须**（GitHub squash revert 是大写 `Revert "...(#N)"`，无 -i 漏命中）。引号段内 #N = 被回滚原 PR（排除引号外 revert 自身号 #M）；无引号兜底仅 revert/回滚 动词 ≤80 窗口内取号 + lookbehind 排除紧贴 `PR#N` 来源标注。`aggregate({revertedPrs})` 读时把命中 ledger `pr` 的 pass/partial 行视为 reverted（仅完成态、`pr` 正整数、无 pr 不误标），**不改历史行**。新增 `post_revert_rate`（=有效回滚/n）+ reverted 三指标分源（`ledger_reverted_count` 字面 / `post_revert_count` 反查 / `reverted_count` 有效总数·codex 闸-1 P1-1 防语义漂移）。
  - **② owner「重做/不是我要的」返工 sink**（owner 2026-06-27 拍板）：专门 sink `.claude/workflow/user-rework-log.jsonl`（append-only，owner 反馈后由会话追加一行 `{uid?|pr?, count(严格正整数), reason, ts}`）。`aggregate({reworkRows})` 经 `pr→uid` 索引归一任务键（消除 uid/pr 拆分重复·codex 闸-1 P1-2），`post_rework_rate` = 有返工(count>0)任务数 / `task_count`（**任务维度**去重，区别于 n=尝试维度·codex 闸-1 P1-3）。`parseUserReworkLog` 跳坏行。
  - **env**：`LOOP_GIT_DIR`（反查目录，默认 ROOT）+ `LOOP_REWORK_PATH`（sink 路径）可覆盖，供端到端 oracle 隔离（与 E1 `LOOP_LEDGER_PATH` 同款）。
  - **诚实边界**：无引号兜底对**带空格** `PR #N` 来源标注有残留误命中（中文语境 `PR #N` 真 revert 引用 vs 来源标注无法正则区分；本仓来源标注实测均紧贴 `PR#N` 已排除，GitHub revert 走引号主路径精确不依赖兜底）；owner 返工依赖会话如实 append（提示遵从非 100%·`feedback_prompt_needs_code_backup`），E6 可加 governance 闸。
- **E5 样本主题集中度（治茧房2 单一工程过拟合·2026-06-27）**：账本原只按 `domain` 字段（技术域桶）看分布，但单一大工程（山西多省接入·~53% 样本）被打散到 etl/data-architecture/branch-derivation 等 30 桶 → 技术域 HHI 仅 0.06（1.8×均匀）→ **技术分桶口径掩盖"单一工程过拟合"**（茧房2 隐身机制）。E5 给 `aggregate` 增 `concentration`（**读时计算·不 mutate 历史行**，仿 E1/E2），双维度（codex 闸-1 D1-C）：
  - **topic（业务主题·oracle 主结论 + 打标依据）**：`classifyTopic` 按 `TOPIC_RULES`（单一事实源·68 样本实测）归一 task 到业务工程主题（省份接入/loop治理/外部集成/数据分析口径/产品前端/其他），优先级"业务工程 > 技术实现 > 其他"（省份接入证据族**首位**判定防技术词截胡）。codex 闸-2 两轮收窄**移除跨项目通用泛词**（RLS/Phase/裸派生/回填/backfill/地域），仅留 G3-G8（本仓省份网格编号）+ 省份词 + branch_code/prefix_map + current<省> + PR#753。**诚实局限**：关键词启发式非语义分类器，弱信号边界行（行13/44）漏判归其他（不污染 oracle）。
  - **domain（技术域·辅助·字面"按 domain 字段"）**：双口径 `label_hhi`（标签计数·兼容 byDomain）+ `task_weighted_hhi`（每任务权重 1、k 域各 1/k·codex 闸-2 P1-1）。
  - **打标 `overfitFlag`（纯函数·codex 闸-1 P0-4）**：① sample_count<2 → insufficient_cross_domain_evidence ② top=其他 → classifier_coverage_low（防伪高集中）③ top.share≥0.5 或 hhi_ratio≥2（相对判据·D4）→ overfit + 标"待跨域验证" ④ 否则 diverse。基于 topic（茧房2 是业务过拟合·D5）。
  - **oracle 实证**：`loop:quality` → 业务主题 top「省份接入」**51.5%**（68 样本验证时·HHI 0.3287·1.97×；rebase 合入 origin 最新后账本 71 样本 50.7%·1.93× 仍打标，可复现）→ 打标；技术域 top etl 14%（任务加权 HHI 0.074 < 主题 → 诊断触发）。茧房2 首次可量化可见。复用 `LOOP_LEDGER_PATH`（无新 env）。

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
- **meta（2026-06-22 · 本 PR · 用户指令）· 单任务 loop 的 P0/P1 复杂 PR：codex 闸-2 强制 + 三源过清后自动合并**：（⚠️ **2026-06-27 总废止**：本条 meta 全部 bullet 描述的「闸-2 三源（codex+evidence-verifier+CI）/ skill→CLI 降级 / 三源过清」流程，已被 2026-06-25「code review 单源=codex CLI」+ 2026-06-27「不经 skill」**整体取代**——闸-2 现 = codex CLI 单源、无 LLM 兜底、降级见 §2「调用方式」，**一律以 §2 为准**；以下 bullet 为 2026-06-22 历史记录，含当时三源实跑数据，**非现行流程**。）
  - **用户指令**：「单任务 loop 也应安排 codex 对 P0/P1 级复杂任务的 PR 做对抗性审查后自动合并」。即 ① 单任务 loop **不豁免**闸-2 的 codex 对抗（此前我对本 PR 只跑了 evidence-verifier，跳过 codex，属漏闸）；② 闸-2 三源 P0/P1 全清后**应自动合并**，不留人工交接——澄清「禁 auto-merge」**仅限部署链 PR**（`.claude/pr-checklist.md §4`），P0/P1 普通任务过了对抗就自动合。
  - **闸-2 的两层强度（按任务复杂度）**：**P0/P1 复杂任务 = codex 对抗强制不可跳**（§2 降级分层：codex skill → CLI `codex exec --sandbox read-only - < prompt 文件` → evidence-verifier+CI；本机 `/opt/homebrew/bin/codex` 0.141.0 可用，故走 CLI）；P2-P4 常规任务按需（evidence-verifier+CI 即可，codex 留给可疑口径/跨模块）。三源 = codex + evidence-verifier + CI auto-review。（⚠️ **本 bullet 的「skill→CLI→evidence-verifier+CI 降级」与「三源」是 2026-06-22 当时写法，已被 2026-06-25「codex CLI 单源」+ 2026-06-27「不经 skill」收敛废止**：闸-2 现 = codex CLI 单源、降级见 §2「调用方式」两级、无 LLM 兜底，**以 §2 为准**。）
  - **自动合并判据（全满足才 enable --auto）**：① 闸-2 三源 P0/P1 全修 + 复审通过；② CI 双绿（Production Gate + Governance Check）；③ **非部署链**（不碰 `deploy.yml`/`vps-wrapper/**`/`sync-vps.mjs`/`ecosystem.config.cjs`）；④ 合并门 slot holder（`bun run loop:dispatch --merge-gate`）。满足 → `gh pr merge --auto --squash`（队列/strict=false 下 = 加入合并门，CI 过即自动落地）。**部署链 PR** 恒禁 auto-merge，人工选窗口合并并盯 CI 前 5 分钟。合并判成功一律 `gh pr view --json state`（==MERGED），禁 grep "merged"。
  - **enable --auto 后禁再 push**（memory `feedback_auto_merge_no_followup_push`：跟进提交竞态丢失）→ codex 若抓 P0/P1，先全修 + 复审 + CI 再绿，**才** enable --auto；收尾 bundle（backlog/复盘/账本）也须在 enable 前一次推完。
  - **落地**：`sessionPrompt` 第 4 步标注「P0/P1 强制 codex 闸-2 + CLI 降级路径」，第 6 步改为「三源过清 + CI 双绿 + 非部署链 → `gh pr merge --auto --squash` 自动合并；部署链人工合」。本 PR 自身即首个按新流程执行者（P0 级 → 跑 codex CLI 对抗 → 三源清 → 自动合并）。
  - **needs_automation: false**（本条是把既有 §2 闸-2 + pr-checklist §4 部署链特例**显式编排进单任务收尾流**，非新机制；codex 调用已是 §2 降级分层覆盖的确定路径）。
  - **本 PR codex 闸-2 实跑结果（首个按新流程执行，证「强制 codex 对抗」有价值）**：codex CLI（read-only）判 PARTIAL，抓 **1 P1 + 2 P2，已全修**——① **P1（认领锁 TTL 据「认领时刻」而非「最后活动」）**：旧 `latestClaims` 只取最新 status 的 at 算 TTL，致「认领 8h+ 但 7.5h 前还在 note 心跳」的**活跃**会话被误释放→重复派单（与文档「无后续事件才释放」不符）。修：`latestClaims` 增 `lastAt`=该 uid **任意事件**最新时刻，`computeFrontier` TTL 据 `lastAt`（任何 note/amend/status 刷新锁）；codex 原始复现（IN_PROGRESS@00:00+note@07:30,now=08:00,ttl=8）修后 frontier=[]、claimed=1（锁住）。② **P2 ttl 校验**：`claimTtlHours` 为 `'bad'/0/负` 时静默释放所有认领→加非正有限数回退默认 8h。③ **P2 ref 上限**：`.slice(0,80)` 无新鲜度序，超限静默漏认领→提到 200 + 超限 `console.error` 告警（不静默截断）。+4 单测（lastAt 心跳刷新 / 活跃锁 / 真陈旧释放 / ttl 非法回退），全量 3719/3719、governance 44/44。**教训**：evidence-verifier 闸-2 已判 CONFIRMED 无 P0/P1，但 codex 窄范围对抗仍抓出 1 个真 P1（spec-vs-impl 不符）——印证「P0/P1 强制 codex（多模型对抗）」的增量价值，单一 verifier 会漏。
- **meta（2026-06-25 · 本 PR · 用户指令）· 双闸 code review 收敛为 codex CLI 单源（去 code-reviewer / evidence-verifier / CI auto-review）**：
  - **用户指令**：「loop v2 的单任务与多任务的 code review，只需要 codex cli，去掉 code-reviewer。」澄清确认（AskUserQuestion）：闸-2 从「codex + evidence-verifier 证伪 + CI auto-review 三源」**收敛为 codex CLI 单源**。
  - **背景**：协议 §2/§4 原写闸-2 三源；但实跑（PR-6 `2bb22d` / PR-1 `5f1545`，见 `pr-evolution.md` / `BACKLOG_ARCHIVE.md`）执行会话额外起了 **`code-reviewer` Claude 子代理**做对抗（"双对抗:code-reviewer+codex CLI"），与协议写的 evidence-verifier 都属于「在 codex 之外再叠 LLM 评审」。用户要求统一收敛到 codex CLI 一个 code-review 源。
  - **改了什么**：① §0 流程图 ⑥、§2 闸-2/降级/降级分层、§2 引言、§3 账本 `verifier_refuted` 弃用；② 单任务 wrapper `chexian-evidence-loop.md` §4 闸-2 + 降级 + Pre-flight 第 4 项；③ `dispatch.mjs` `sessionPrompt` 第 4/6 步（多任务会话实际遵循的指令）。**未动**：`evidence-verifier.md` agent 文件（frozen，仍可作 ad-hoc 正确性证伪，只是不再是 loop 闸必需源）；步骤 ⑤ 确定性闸（`verify:full`/`governance`/golden-baseline/duckdb 直查）= correctness oracle，与 code-review 闸正交，**不受影响**。
  - **降级语义变更**：单源后 codex 全不可用时**无 LLM 兜底闸**——标 `unavailable` + 向用户报缺口请授权（`feedback_no_giveup_ask_authorization`），**禁止**擅自回退 evidence-verifier/CI；确定性闸照跑。
  - **三问复盘**：① 重来更好？协议早该与实跑对齐——文档写 evidence-verifier、实跑用 code-reviewer，双轨漂移半个月才被用户拍平；写协议时应同步固化「code review 用哪个源」单一事实，别留两套。② 复用价值？「对抗源单一事实 + 确定性 oracle 与 LLM 对抗正交」这条边界对其它 review 编排通用。③ 自动化？本条是协议/提示词文本收敛，无运行时强制点；残留人工点 = 执行会话须真的只调 codex、不擅自加 code-reviewer——`sessionPrompt` 已固化措辞，但仍依赖会话遵从（`feedback_prompt_needs_code_backup`：提示遵从非 100%）。`needs_automation: true`（可加 governance 闸：扫 loop PR 的 pr-evolution/账本若出现 `code-reviewer`/`evidence-verifier` 作闸源即告警）`expires: 2026-09-25`。
- **meta（2026-06-27 · 本 PR · Loop v2 元复盘）· automation-due 补「疑似已机制化」检测 + expires 应绑可验证节点**：
  - **触发**：用户「做 loop v2 元复盘」。按 §4 跑 `loop:automation-due`+`loop:quality` → 处置 3 个缺 expires 存量项（详见 `pr-evolution.md` 2026-06-27 entry）：项1 cx UX harness **撤项**（`cli-ux-sentinel.yml` 已建、标记陈旧挂 9 天）；项2/3 `verify-branch-domain` harness **补 expires 2026-09-21** 与 R9-R11 合并。缺 expires 3→0、健康 28→30。
  - **洞察1（expires 归属）**：`verify-branch-domain` harness 被 R4/R5/R9/R10/R11 提 5 次未建，根因＝它依赖源 Excel+warehouse 数据，与 loop 隔离 worktree 无数据**结构性冲突**，只能在 GATED 上线（有数据的主目录）时落地。**自进化项 expires 应绑「该机制真能被验证的环境/节点」，非机械顺延 90 天。**
  - **洞察2（账本实证收敛）**：对抗命中 codex 281 ∶ verifier 2（58 样本，140 倍）——从量化角度实证 2026-06-25「code review 单源＝codex CLI」决策：verifier 独立边际价值极低，收敛未损对抗强度。一次过率 36.2% 偏低部分是 codex 闸-2 健康拦截返工（非质量退化），`quality-report.mjs` 暂不区分两类返工。
  - **本轮已修（代码）**：① `scanEntries` 格式漂移——`###` 标题行书写的 needs_automation 被标题分支吞掉、静默脱离催办网（尾部 6 条 entry + 本轮 entry 漏计近一月）；修＝needs_automation 检测移到标题前 + 单测（`loop.test.mjs` 60 passed）。② 本 entry 裸字符串自污染（误增幽灵健康项）一并修正。
  - **新机制登记（expires 2026-09-27）**：① automation-due「疑似已机制化」启发式（项1 闸建好挂 9 天没撤）；② meta-review 自动触发（免等用户触发）。属 loop-meta 代码改动，单 owner 串行落地，本轮仅登记。
- **meta（2026-06-27 · 本 PR · 用户指令）· §2 措辞落实：codex 评审「不经 skill、直接 CLI」彻底清理（兑现 2026-06-25 未改干净的主体）**：
  - **用户指令**：「请记住，安排 codex 做评审，就是让 codex CLI 做对抗性评审，不要再当成技能。」即 codex 评审默认**直接调 codex CLI**（`codex exec --sandbox read-only - < <prompt 文件>`），**不经 `codex` skill**。
  - **根因（为何改主体而非只追加 meta）**：上一节 2026-06-25 meta 声称已把「§2 闸-2/降级/降级分层/引言」收敛为 CLI 单源，但**实际只改了闸-2 的判定源措辞**——§2 引言、闸-1、降级分层①「skill 在→经 skill 调」、§7 关联「对抗第二模型：codex skill」**至今仍写「经 codex skill 调」**，主体与结论漂移留存近半月。append-only 文件里**主体即权威、§4 旁注 meta 易被忽略**，故下次会话读 §2 降级分层①仍会先试 skill。本次按用户指令**直接改 §2/§7 主体那几处措辞**，不再靠 meta 旁路声明。
  - **改了什么**：① §2 引言「CLI 经 skill 仍可手动调」→「评审一律走 codex CLI 直接调，不经 skill」；② 闸-1/闸-2 → 「直接调 codex CLI（不经 skill）」；③ 原「降级分层」三级（① skill 在→经 skill 调 ② CLI 在→codex exec ③ 都不可用→报缺口）**收敛为两级**（① CLI 在→`codex exec`；② 不可用→报用户请授权），标题改「调用方式」；④ §7 关联「对抗第二模型：codex skill」→「codex CLI」；⑤ `skills-map.md` E 段 codex 行标注「评审走 CLI 不经 skill」；⑥ 给第 148 行（2026-06-22 meta「闸-2 两层强度」）的「skill→CLI→evidence-verifier+CI 降级 / 三源」就地加**废止标注**（codex 闸-2 抓出的 P1 残留：旧 meta 措辞像当前有效流程、与 §2「单源/不经 skill」冲突），明确以 §2 为准。**未动**：闸-2 correctness 正交边界、确定性闸、`evidence-verifier.md`（frozen）、第 75-77 行「code review 单源=codex CLI」blockquote（已对，无需改）。
  - **新增 memory**：`codex-review-is-cli-adversarial`（feedback）固化「安排 codex 评审 = codex CLI 对抗，不当 skill」，供跨会话召回。
  - **append-only 处置（`[policy-override]`）**：本次**修改既有 §2/§7 主体内容**（非纯追加），按 AGENTS.md §8.2 frozen 处理。授权来源 = 用户 2026-06-27「改」/「好」指令（口头同意，AGENTS.md §8.1 认可的书面授权形式之一）；**`[policy-override]` 标记须落于本 PR 每条 commit message + PR 标题**（本 PR 已落实，非凭本 meta 自证）。旧措辞经本 meta + git 历史留痕，无信息丢失。
  - **三问复盘**：① 重来更好？2026-06-25 那次就该改主体而非只在 §4 追加 meta 声明——「声称改了」与「实际改了」漂移是协议类 append-only 文件高发坑（同 `feedback_codex_review_fix_sop`「修一处≠修一类」：声明一处≠落实全文）。② 复用价值？「append-only 协议的 meta 声明必须同步落实到主体，否则主体即权威、meta 被忽略」对所有 append-only 护栏通用。③ 自动化？`needs_automation: false`（本次为文字落实，无新运行时机制；2026-06-25 已登记的「扫 loop PR 出现 code-reviewer/evidence-verifier 作闸源即告警」governance 闸 expires 2026-09-25 已覆盖本方向）。
  - **本 PR codex CLI 闸-2 实跑（以身作则用 CLI 而非 skill）**：判 PARTIAL，抓 1 P1（第 148 行旧三源/skill 降级残留，本应 2026-06-25 一并清理）+ 2 P2（skills-map 第一列路由歧义、commit/PR 须带 `[policy-override]`），均已处置。又一个「修一处≠修一类」实例——改 §2 主体须连同 §4 历史 meta 的「当前性」措辞一起扫；也实证「评审走 codex CLI」能抓出单看 diff 易漏的跨节冲突。
  - **同 PR 追加（2026-06-27 · 用户追问「codex 自跑搜索扫到会话 JSONL、输出 81KB，怎么根治」）· §2 新增「评审 prompt 编排」铁律**：根因＝codex agentic CLI 自跑宽范围 grep，命中机器上记录本对话的 `~/.claude/projects/*.jsonl`（read-only sandbox 不挡读）。根治＝**任务自包含**（调用方备好 diff/片段喂 stdin）+ 硬禁令兜底 +「**消除搜索动机 > 下禁令**」。落到 §2「调用方式」后一条 + memory `codex-review-is-cli-adversarial` 的 How to apply。实证 81KB→23KB。`needs_automation: false`（prompt 编排属调用纪律，无运行时强制点；残留人工点＝执行会话须真的自包含喂入，依赖会话遵从）。
- **meta（2026-06-27 · 本 PR · Loop V2 进化 E1「账本记失败」治茧房1 幸存者偏差）**：承接 `开发文档/loop-v2-进化规划.md` §4 E1（PR #812 合同），落地「真相输入」阶段第一项。详细 schema 见 §3「E1 失败记账」bullet。
  - **诊断实证**：实测 58 样本顶层 verdict = 57 pass 系（pass×50 + 5 种 pass-* 变体×7）+ partial×1 + **0 fail/orphaned/blocked**——失败任务流程上走不到「成功收尾记账步」。北极星「一次过率 36.2%」是幸存样本上算的。
  - **落地（codex 闸-1 硬化后）**：① `normalizeVerdict` 单一事实源（读时归一历史 pass-* 变体：5 种顶层 + all_fixed/mergeable 同义词，**不迁移 append-only 历史行**）；② `aggregate` 非 pass 纳分母 + 放弃率/孤儿率/阻塞率 + verdict 分布 + 读时去重（并发安全）+ avg 只算完成行（缺失≠0）；③ `dispatch.failureLedgerRows` 纯函数把 `released`/`blocked` 幂等补记（accounted 守卫排假阳性 + (uid,claim_at)/uid 去重），**仅默认模式**写、不碰调度决策逻辑。
  - **codex 闸-1 价值**：7 P1/6 P2，关键修正进设计——并发幂等（读时去重兜底，非靠单 owner 串行）、blocked 拆独立阻塞率（非混入放弃）、avg 只算完成行、schema 漂移 uid/backlog_uid、默认模式才写。**最关键**：阶段 A 自查 + codex 共同发现「accounted 守卫」必要性——朴素记 orphaned 会把「完成但状态未流转」的 b244/b255/b320 误记孤儿（属 stale-scan 域）。
  - **oracle 实证**：构造孤儿→`loop:dispatch`→账本 +1 orphaned；连跑 3 次仍 1 条（幂等）；`loop:quality` 放弃率 100%（temp）。真实首次对账记 2 orphaned + 6 blocked（守卫排除 3 已完成者），北极星 **36.2%→30.3%**（含失败 + partial 口径修正）、放弃率 **0%→3.0%**、阻塞率 9.1%——幸存者偏差消除、放弃代价首次可见。22 新单测，loop 全量 82 passed。
  - **三问复盘**：① 重来更好？「accounted 守卫」本可更早识别——`released` 同时含「真孤儿」与「完成未流转」两类，设计时要先分清 E1 域 vs stale-scan 域，否则假阳性。② 复用价值？「失败记账纯函数 + 读时去重兜并发 + accounted 守卫分域」对任何「自产自评闭环装失败可见性」通用；「读时归一不迁移 append-only 历史」是 union 文件演进的标准手法。③ 自动化？本项即「把放弃率从不可见变机制化可见」。`needs_automation: true`（E6 拟把「账本必含失败记账维度，缺则告警」入 `bun run governance`，与 E4 死规则审计同窗）`expires: 2026-09-27`。
- **meta（2026-06-27 · 本 PR · Loop V2 进化 E2「注入外部真相」治茧房3 自指闭环）**：承接 `开发文档/loop-v2-进化规划.md` §4 E2（依赖 E1）。落地「真相输入」阶段第二项——给自产自评闭环接两条外部真相线。详细 schema 见 §3「E2 注入外部真相」bullet，evidence-loop scorecard（基线/oracle/双闸/决策）见 `pr-evolution.md` 同日 entry。
  - **落地**：① `quality-report` 加 git 事后回滚反查（`-E -i` 双 flag 实证必需）+ 读时把命中 ledger pr 的 pass/partial 行标 reverted（不改历史行）+ `post_revert_rate` + reverted 三指标分源；② owner 返工 sink `.claude/workflow/user-rework-log.jsonl`（owner 拍板：专门 sink + 整数次数 N）+ `post_rework_rate`（任务维度分母）；③ 北极星双率 render。**不碰 dispatch 调度逻辑**（风险低）。
  - **双闸价值**：闸-1 计划对抗 5 P1 全采纳（reverted 三指标分源、pr→uid 索引、task_count 任务维度分母、动词窗口+lookbehind 排除 PR#N、count 正整数）——**最关键**：阶段 B 端到端跑真实仓库数据当场暴露 `#391` 误报（「回滚命令…PR#391」来源标注），驱动 lookbehind 收紧（证据驱动迭代）；闸-2 完成对抗 0 P0/0 P1 + 4 P2（采纳严格整数 count + 文档化带空格 `PR #N` 残留局限）。
  - **oracle 实证**：真 git 仓造 GitHub 大写 Revert + 中文回滚 → `loop:quality` 自动标 reverted、事后回滚率 66.7%、owner 返工率 33.3%、706 未回滚不误标；`-E`/`-i` 双 flag 必要性实证（无则命中 0 / 漏 GitHub squash revert）。loop 单测 86→**116**、全量 **4288/4288**、verify:full 绿。
  - **三问复盘**：详见 `pr-evolution.md` 同日 entry。`needs_automation: true`（E6 拟把「账本失败记账 + 外部真相维度，缺则告警」入 `bun run governance`，与 E4 同窗）`expires: 2026-09-27`。
- **meta（2026-06-27 · 本 PR · Loop V2 进化 E5「样本多样性意识」治茧房2 单一工程过拟合）**：承接 `开发文档/loop-v2-进化规划.md` §4 E5（无依赖·增强阶段·P2）。详细 schema 见 §3「E5 样本主题集中度」bullet，evidence-loop scorecard 见 `pr-evolution.md` 同日 entry。
  - **诊断实证**：68 样本手工核对 ~36/68 属同一工程（山西多省接入）；但按 `domain` 字段（技术域桶）HHI 仅 0.06（1.8×均匀）——技术分桶口径把"一个工程"显示成"分散在 30 域的多样工作"，这本身就是茧房2 过拟合不可见的机制。
  - **codex 双闸价值**：闸-1（计划）PARTIAL → 全采纳 4 P0+4 P1+3 P2，**最关键**裁定 D1-C 双维度（domain 字面 vs oracle 主题张力：domain HHI 证明不了茧房2，topic 才是主结论 + 打标依据）+ overfitFlag 纯函数化 + 命名去 n 过载。闸-2（完成）三轮：轮1 抓 4 P1（topName guard / hhiOf 负数防护 / 变体补漏 / 泛词过宽）→ 轮2 P1-1 残留（裸"派生/回填/backfill/地域"跨项目通用，会误命中派生指标/数据回填/地域分析）→ **收窄移除泛词 + "派生"限定派生映射上下文 + 3 反例测试 → 轮3 PASS**。证「评审走 codex CLI」能逼出脆弱关键词分类器的过宽边界（单看 diff 易漏）。
  - **oracle 实证**：`loop:quality` 业务主题 top「省份接入」51.5%（68 样本验证时·rebase 后账本 71 样本 50.7%·均 >50% 打标·HHI ~0.32·~1.9×）→ 打标"待跨域验证"。loop 单测 116→**141**、governance 45/45。**残留诚实边界**：① 关键词启发式非语义分类器，行13(org_level_3 回填)/行44(Phase backfill) 弱信号边界行漏判归其他（不污染 oracle 主结论）；② `\bSX\b` 在 `/i` 下亦匹配小写 `sx`（如未来前端 MUI `sx` prop），当前账本零命中、codex 评估不阻断、后续观察。
  - **meta 写法约定（本协议落地·治茧房2 核心·task 动作2）**：meta-review 跑 `loop:quality` 时若 `concentration.overfit.flagged`（单一主题超阈），**本轮提炼的规则 / 协议改动须在 pr-evolution / 本 §4 meta 标注「待跨域验证」**——即该规则源于单一工程样本，须在其他工程验证成立后才升格为通用协议，避免把"山西多省这一个工程的经验"过拟合成"通用 loop 协议"。本条 meta 自身即一例：E1-E6 进化史几乎全在多省工程期间产生，其经验亦属「待跨域验证」。
  - **三问复盘**：① 重来更好？domain 字面要求 vs oracle 主题诉求的张力本应在闸-1 前自查更彻底（阶段 A 已用证据识别 domain HHI 仅 1.8× 均匀，但靠 codex 闸-1 才定死双维度方案）。② 复用价值？`hhiOf` / `overfitFlag` / `classifyTopic` 对任何"自产自评闭环装样本多样性意识"通用；"关键词启发式 + 诚实漏判边界 + 反例测试锁误命中"是脆弱分类器的标准工程化折中（codex 闸-2 两轮收窄实证）。③ 自动化？本项即"把过拟合从不可见变机制化可见 + 打标"；残留人工点 = meta-review 须真的据 flagged 打标。`needs_automation: true`（E6 拟把「账本必含集中度维度 + 单一主题超阈强制 meta-review 打标」入 `bun run governance`，与 E1/E4 同窗）`expires: 2026-09-27`。

- **meta（2026-06-29 · 用户指令 · `[policy-override]`）· codex 双闸从「强制」改为「🔴 默认关闭·显式才跑」**：
  - **用户指令**：用户问「如何切换开启/关闭 codex CLI 评审」。经两轮澄清确认：终态 =「**默认关闭·仅本次显式要求才跑**」+ 范围「单任务 wrapper + 多任务 dispatch + 两个 frozen rules 全改」+ 明确给 `[policy-override]` 授权（AskUserQuestion 选「授权·全部一起改」）。
  - **改了什么**：① 本文件 §0 流程图 ③⑥、§2 标题/引言/闸-1/闸-2/降级：「两道**强制**闸」→「**默认不跑**，仅用户本次显式要求才跑」；② 同步改 `chexian-evidence-loop.md`（§0 Pre-flight 第 4 项、§2 挂载表 verifier 行、§4 双闸节）、`evidence-loop.md`（「本项目特例」codex 单源 bullet）、`scripts/loop/dispatch.mjs` 的 `sessionPrompt`（第 1/4/6 步多任务会话提示词）。**未动**：显式跑时 code review 单源仍 = codex CLI、不经 skill、prompt 自包含铁律、阶段 ⑤ 确定性闸（correctness oracle·与 code-review 正交，不受影响）。
  - **连带后果 / 默认 code review 口径（按 memory `feedback_codex_review_off_by_default`，2026-06-29 用户指令「忽略 codex 对抗评审，没明示都关闭」）**：codex 2026-06-25 曾被收敛为唯一 LLM code-review 源；本次默认关闭后，**默认的 code review 回退为 Claude `/code-reviewer` 自审兜底**（fresh 自审 + 修复 SOP，不起 evidence-verifier），codex 仅用户明示时跑。即「默认 LLM 评审从 codex 换成 `/code-reviewer`」，**非「无 LLM 评审」**；正确性仍由确定性闸正交承担。
  - **governance 不拦**：已查 `check-governance.mjs` / `pr-checklist.md`，无任何检查反向强制「codex 闸必须存在」，关闭默认不触发治理失败。2026-06-25 登记的「扫 loop PR 出现 code-reviewer/evidence-verifier 作闸源即告警」闸（`expires: 2026-09-25`）尚未落地，且其方向是「禁误用其它 LLM 源」，与本次「codex 默认不跑」不冲突。
  - **append-only 处置（`[policy-override]`）**：本次**修改既有 §0/§2 主体**（非纯追加），按 AGENTS.md §8.2 frozen 处理。授权来源 = 用户 2026-06-29 AskUserQuestion 明确选择「授权·全部一起改」（口头同意的书面形式之一）；`[policy-override]` 标记须落于本 PR 每条 commit message + PR 标题。旧措辞经 git 历史 + 本 meta 留痕，无信息丢失。
  - **三问复盘**：① 重来更好？codex 双闸的「强制 / 默认 / 关闭」三态本应一开始就设计成可切换项（而非写死「强制」再反转），协议类文件的开关位宜显式留切换钩子。② 复用价值？「LLM 对抗闸默认开/关是产品决策、与确定性 correctness oracle 正交」对其它 review 编排通用。③ 自动化？本次为协议措辞反转、无运行时强制点；残留人工点 = 会话默认不跑 codex、仅在用户显式要求时跑——`sessionPrompt` / wrapper 已固化措辞，但仍依赖会话遵从（`feedback_prompt_needs_code_backup`：提示遵从非 100%）。`needs_automation: false`（关闭本就是「少做一步」，无需新机制保障；将来若要把「显式触发词→自动跑 codex」做成确定性钩子可另立项）。

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
- verifier：[`.claude/agents/evidence-verifier.md`](../agents/evidence-verifier.md)（frozen·非 loop 闸必需源）· 对抗第二模型：**codex CLI**（`codex exec`，不经 skill）
- scorecard/复盘 sink：`.claude/workflow/pr-evolution.md`（AGENTS.md §8.3 user-only 路径只读）
- 本文件 append-only（AGENTS.md §8.2）：新增独立护栏文件，无需 `[policy-override]`。
