# Loop V2 进化规划 — 打破信息茧房

> **状态**：规划（2026-06-27 立项）
> **触发**：owner 要求「进化 Loop V2，先搞清楚工作流 / 自进化进程 / 本身的问题，别让它在信息茧房里打转」
> **诊断证据**：本会话审视——质量账本 58 样本体检 + `loop-orchestration.md §4` meta 演化史 + `scripts/loop/{dispatch,quality-report,automation-due}.mjs` 源码核实
> **承接 main #809（2026-06-27 元复盘）**：#809 已修 `scanEntries` 格式漂移 + 处置 3 缺 expires + 实证「一次过率 36.2% / codex 281∶verifier 2」。本规划**承接其碎片化处置、上升为系统框架**，并据其数据订正茧房 4/5 与 E4（避免重复 #809 已做）。指标一律以 `bun run loop:quality` 实跑为准，禁口算。
> **复盘 / scorecard sink**：`.claude/workflow/pr-evolution.md`（本规划落地时每项收尾写三问复盘）
> **协议本体**：`.claude/rules/loop-orchestration.md`（append-only · 本规划的进化项最终回写于此）

---

## 1. 一句话结论

Loop V2 是一台**真在转的自进化引擎**（8 条 meta 实证 loop 改 loop，codex 闸抓到过单一 verifier 漏掉的真 P1），但它在一个**封闭回路**里进化——自进化的全部燃料（质量账本 `loop-quality-ledger.jsonl` / 三问复盘 `pr-evolution.md` / 催办 `automation-due`）都是引擎**自产自评**，三条本应接入的外部真相线（生产后果 / 用户满意 / 失败记账）**断在闭环之外**。

**进化方向 = 给自指闭环装外部校准点**，而不是在闭环内继续优化过程指标。

---

## 2. 诊断：6 个信息茧房（证据驱动）

| # | 茧房 | 类别 | 硬证据 | 后果 |
|---|------|------|--------|------|
| 1 | **账本对失败失明** | 输入有偏 | 58 样本 verdict = 57 pass 系 + 1 partial + **0 fail + 0 reverted**；schema 设计了 `pass\|partial\|reverted`（`quality-report.mjs:12`），但记账绑定「成功收尾步」，失败 / 孤儿任务流程上走不到记账点（wave-2 的 b244 限流零产出、b331 被抢先只在散文复盘里） | 北极星「一次过率 **36.2%**」（main #809 实测）已是**幸存样本**上算的——失败/放弃/孤儿根本不在 58 样本里，连 36.2% 都不含放弃代价；meta-review 永远看不到「放弃了多少、为什么」 |
| 2 | **单一工程过拟合** | 输入有偏 | ledger 59% task 直接含多省关键词，实际几乎整个 R9→R41 史 = 「山西多省接入」一个工程 | 调度 / 冲突 / 认领规则全为「高度同构大型重构」调优；自认通用协议，实则专用；样本 N=1 个工程非 N=58 |
| 3 | **自指闭环零外部真相** | 输入有偏 | `quality-report.mjs` 只读 ledger（`:24/:113`）；`dispatch.mjs` 对生产 / 回滚 / 孤儿 0 概念；meta-review 两输入全自产自评 | 自进化在过程指标里打转，与真实价值脱节 |
| 4 | **对抗源单一化（残留假设·数据已部分回应）** | 机制缺陷 | 2026-06-25 收敛 codex 单源；**main #809 实测 codex 281∶verifier 2（140 倍）→ verifier 冗余**，恢复无意义。残留真问题：codex 成唯一 LLM 源后其**系统盲区无机制发现**（281∶2 只证 verifier 同质冗余，不证 codex 无盲区） | 优先级低；E3 若做须**正交**视角而非恢复 verifier，且与 owner 单源指令冲突 |
| 5 | **meta-review 脉冲 + 处置可空转（main #809 已起步）** | 机制缺陷 | meta 曾 7 条挤在一天；**main #809 已修 `scanEntries` 漂移（曾致 6 条 entry 漏计催办网近一月）+ 登记 automation「疑似已机制化」启发式 + meta-review 自动触发** | 节律问题 main 已在处理；剩余＝「是否真升级为机制」的**强**校验尚未落地 |
| 6 | **只前向 append，从不证伪旧规则** | 机制缺陷（元层） | meta entry 只增不减（`policy: append-only`）；合并队列方案连发三条自我更正（启用 → 个人仓不可用 → strict=false）= 闭环内推导没先核外部约束 | 规则越积越多无人回头砍；本仓有 `extract-backlog-governance` skill 能算规则命中率，但 Loop V2 没接这道反身审计 |

> 类别说明：**输入有偏**（1/2/3）= 喂给自进化的信号本身失真；**机制缺陷**（4/5/6）= 自进化引擎自己的毛病。

---

## 3. 进化总原则

1. **先看见真相，再谈优化**——没有失败记账（茧房 1）与外部后果（茧房 3）作校准基准，其余进化都是闭环内打转。故阶段 0 = 真相输入，是一切的前提。
2. **每个进化项必须带 harness**——遵循 evidence-loop 精神：动手前先定义「怎么证明这个茧房真被堵」（验收 oracle），而非声称已修。
3. **自进化要能减，不只能增**——引入反身审计（茧房 6），让死规则 / 过度设计可被发现并撤项。
4. **诚实边界**——E3 与 owner 2026-06-25「code review 收敛 codex 单源」指令存在张力，**须 owner 拍板**是否要「高风险任务例外升级双源」，不擅自违背。

---

## 4. 分阶段路线图

| 阶段 | 进化项 | 治茧房 | 优先级 | 工程量 | 依赖 |
|------|--------|--------|--------|--------|------|
| **0 · 真相输入** | E1 账本记失败 | 1 | P1 | M | 无（根） |
| **0 · 真相输入** | E2 注入外部真相 | 3 | P1 | M-L | E1 |
| **1 · 增强** | E5 样本多样性意识 | 2 | P2 | S | 无 |
| **1 · 增强** | E3 高风险双源对抗 | 4 | P2 ⚠ | S-M | 须 owner 拍板 |
| **2 · 反身** | E4 砍死规则 + 真升级校验 | 5+6 | P2 | M | E1 |
| **3 · 元闸** | E6 固化防复发 | 全部回归 | P3 | S | E1·E4 |

### E1 · 账本记失败（治茧房 1 · 幸存者偏差）

- **动作**：① ledger schema `verdict` 扩 `abandoned / orphaned / blocked` + `reason`；② `dispatch.mjs` 认领锁 TTL 释放孤儿任务时**自动 append 一条 `verdict:orphaned` 记账**（释放点已存在，加记账逻辑）；③ `quality-report.mjs` 北极星把非 pass 纳入分母 + 新增「放弃率 / 孤儿率」；④ BLOCKED / 会话异常退出补记账路径。
- **落点**：`scripts/loop/{dispatch,quality-report}.mjs` · ledger schema · `loop-orchestration.md §3`。
- **验收 oracle**：构造一个孤儿任务（认领后超 TTL 无事件）→ 跑 `loop:dispatch` → ledger 自动多一条 `orphaned` 行；`loop:quality` 放弃率 > 0；单测覆盖失败记账路径。
- **风险**：低（纯增量记账，不改调度决策逻辑）。

### E2 · 注入外部真相（治茧房 3 · 自指闭环）

- **动作**：① `quality-report` 增 `git log --grep 'revert|回滚|hotfix'` 反查，比对 ledger `pr` 号，自动把被回滚的 loop PR 标 `reverted`；② 定义 owner「重做 / 不是我要的」信号采集口径（pr-evolution 增 `user_rework:N` 字段或专门 sink）；③ 北极星加「事后回滚率」。
- **落点**：`scripts/loop/quality-report.mjs`（git 反查）+ owner 信号采集约定。
- **验收 oracle**：人为在某 loop PR 后加一个 revert commit → `loop:quality` 自动检出并标该 PR `reverted`；owner 返工计数可聚合。
- **风险**：中（owner 信号源口径需 owner 参与定义）。

### E3 · 高风险双源对抗（治茧房 4 · 单一化）⚠ 须 owner 拍板 · 紧迫性已降

- **main #809 数据回应**：codex 281∶verifier 2 已证 verifier 冗余 → 本项**紧迫性大幅下降**，建议**观察/暂缓**；若做，必须是**正交**视角（不同失败模式的检查，非恢复同质的 verifier）。
- **动作**：定义「高风险任务」判据（碰 RLS / 安全 / 部署链 / 跨模块）→ 这类任务的闸-2 **例外升级**保留第二正交对抗源；或周期性用第二模型抽检 codex 判断一致性，度量对抗源分歧率。
- **张力**：owner 2026-06-25 明确「code review 收敛 codex 单源、去 evidence-verifier」。E3 是「高风险例外升级双源」，**与该指令直接冲突**——**须 owner 确认是否要**，否则不动。
- **落点**：`loop-orchestration.md §2` + `dispatch.mjs sessionPrompt`。
- **验收 oracle**：高风险判据 + 抽检记录可度量；对抗源分歧率有数据。
- **风险**：中（协议张力，需用户决策）。

### E4 · 砍死规则 + 真升级校验（治茧房 5+6 · 只增不减）

- **承接 main #809**：automation「疑似已机制化」启发式已由 #809 登记（expires 2026-09-27）→ E4 聚焦其**未做部分**：① rule-hit-rate.mjs 砍死规则（#809 未碰）；② 把「疑似已机制化」从启发式提示**升级为 governance 硬校验**。
- **动作**：① 新脚本 `scripts/loop/rule-hit-rate.mjs`——扫 `loop-orchestration` 各 meta 规则 / `dispatch` 各闸，统计每条在 ledger / pr-evolution 的触发次数，输出「命中率 0 = 死规则 / 过度设计」清单；② `automation-due` 增「是否真升级为机制」校验（needs_automation 处置后须有对应 hook/governance/脚本，识别「处置=又写一条文档」的假处置）。借 `extract-backlog-governance` skill 方法。
- **落点**：`scripts/loop/rule-hit-rate.mjs`（新）+ `automation-due.mjs` 增强。
- **验收 oracle**：跑一次输出死规则清单；automation 校验能识别假处置样本。
- **风险**：低。

### E5 · 样本多样性意识（治茧房 2 · 过拟合）

- **动作**：`quality-report` 增「样本主题集中度」指标（域分布 + 单一主题占比 / HHI 集中度指数）；meta-review 在样本单一时给提炼的规则打「待跨域验证」标签。
- **落点**：`scripts/loop/quality-report.mjs` + meta-review 约定。
- **验收 oracle**：`loop:quality` 输出主题集中度（当前应显示「山西多省 ~59%+」高集中）；规则可打标。
- **风险**：低。

### E6 · 固化防复发（元闸 · 治全部回归）

- **动作**：把 E1 / E4 能力固化成 governance 强制——① ledger 必含失败记账维度（缺则告警）；② 死规则季度审计入 meta-review 强制项；③ automation「真升级」校验入 `bun run governance`。防进化成果回退。
- **落点**：`scripts/check-governance.mjs` + `loop-orchestration.md §4`。
- **验收 oracle**：回退（删失败记账 / 跳审计）即 governance fail。
- **风险**：低（依赖 E1/E4 先落地）。

---

## 5. 验收总纲（怎么证明「茧房被堵」）

| 茧房 | 堵死判据（可执行 oracle） |
|------|--------------------------|
| 1 幸存者偏差 | `loop:quality` 放弃率 / 孤儿率 > 0，且孤儿任务能自动入账 |
| 2 过拟合 | `loop:quality` 输出样本主题集中度，单一主题占比可见 |
| 3 自指闭环 | `loop:quality` 能从 git 史自动标 `reverted` + owner 返工可聚合 |
| 4 单一化 | （紧迫性已被 main #809 的 281∶2 降低）若做：高风险任务有**正交**对抗源记录 + 分歧率可度量（须 owner 先批 E3） |
| 5+6 只增不减 | `rule-hit-rate.mjs` 输出死规则清单；automation 假处置可识别 |
| 全部回归 | E1/E4 能力进 governance，回退即 fail |

---

## 6. 关联

- 诊断 sink：`.claude/workflow/pr-evolution.md`
- 协议本体：`.claude/rules/loop-orchestration.md`
- 质量账本：`.claude/workflow/loop-quality-ledger.jsonl` · 聚合 `scripts/loop/quality-report.mjs`
- 催办：`scripts/loop/automation-due.mjs` · governance #703 `checkPrEvolutionExpired`
- 反身审计方法源：`extract-backlog-governance` skill（规则命中率 / 找死规则）
- BACKLOG 立项：E1-E6 六条（section「Loop v2 进化」）
