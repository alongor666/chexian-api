---
name: chexian-evidence-loop
description: 当用户要把任何复杂工作（性能优化/SQL口径修改/重构/新功能/安全加固/数据ETL）做成"可验证闭环"而非"宽泛审查"时使用 — 先建 harness 合同，再绕证据迭代。本命令是 evidence-loop-core 基座的本项目薄 wrapper：调用基座协议，按本项目 §4 harness 表执行。
category: workflow
scope: project
last_updated: "2026-06-16"
---

# 证据闭环驱动（/chexian-evidence-loop · 薄 wrapper）

把"做一次复杂工作"升级为"在可验证闭环里工作"。

**用法**：`/chexian-evidence-loop <任务一句话> [--type perf|sql|refactor|feature|security|etl]`
未给 `--type` 时先自行判定并回显。

---

## 0. Pre-flight Checklist（动手前必勾，缺则 BLOCKED）

> 来源：PR #662 复盘 — wrapper 头部明文规则**会**被 AI 跳过。强制 checklist 形式让"必读"变成"必勾"。

```
□ 1. scorecard 落位：本任务最终 sink 必为 .claude/workflow/pr-evolution.md
     —— 禁 .claude/shared-memory/** / ~/.claude/projects/**/memory/**
□ 2. CI 闸预测：若改动涉及 cli/ 顶层 import 或 cold path → 预先算
     本地 A p95 × 14 ≤ 250ms，否则 push 前 BLOCKED
□ 3. pr-evolution 最近 7 天 entry：tail -100 .claude/workflow/pr-evolution.md
     看是否已记录同类失败模式（避免 24h 内复发）
□ 4. verifier 计划：阶段 C 必跑 evidence-verifier（fresh context）
     不可跳过，否则属流程违规
□ 5. 凭据/数据缺口：若任务需 E2E_PASSWORD / admin token / baseline 文件
     等而当前缺失 → 先向用户索取，不要默认绕过
     （memory feedback_no_giveup_ask_authorization）
```

未勾完 5 项 → 进入阶段 A 之前显式声明跳过的项与理由。

---

## 执行（读基座 + 注入项目内容）

### 1. 读基座协议

读 `~/.claude/skills/evidence-loop-core/SKILL.md`，按其 §8 三阶段执行编排（A 只读 harness 报告 → B loop checkpoint → C 收尾 + verifier 证伪）执行。
合同六要素 / 8 步 loop / 默认阈值 / 停止-回滚 / `/goal` 模板 / verifier 隔离原则——**全部以基座为准**，本 wrapper 不重复。

### 2. 注入本项目挂载点（基座会按 §10 wrapper 接入清单读取）

| 基座挂载点 | 本项目提供 |
|---|---|
| §4 harness 映射表 | [.claude/rules/evidence-loop.md §4](../rules/evidence-loop.md) — 6 类任务的实际命令（bench / golden-baseline / cube-shadow / duckdb 直查 / verify:full / governance / sentinel） |
| verifier agent | [.claude/agents/evidence-verifier.md](../agents/evidence-verifier.md)（项目级，提示词源自基座 `verifier-agent-template.md`） |
| scorecard 落位 | `.claude/workflow/pr-evolution.md`（append；与 `commit-push-pr-core` 自进化日志同位置）。**禁止** `.claude/shared-memory/**` / `~/.claude/projects/**/memory/**` —— AGENTS.md §8.3 user-only。**SSOT**: [`.claude/pr-checklist.md`](../pr-checklist.md) "sink/scorecard 落位" 行，三处同步由 governance "evidence-loop SSOT 漂移" 强制 |
| 项目治理 / 回归门禁 | `bun run governance`（聚合 32+ 项）/ `bun run verify:full`（governance + 单元测试） |

### 3. 本项目特例（覆盖基座通用项）

- **scorecard 不新建 `docs/perf/` 等目录**，append 到 `.claude/workflow/pr-evolution.md`（AI 可写；与 commit-push-pr-core 自进化日志共享文件）。AGENTS.md §8.3 列的 user-only 路径（`.claude/shared-memory/**` 等）**只读不写**。
- **发布安全机制**：立方体专项有 `cube-promote.mjs` / `cube-rollback.mjs` / sentinel；其他类型按本项目 rule §4 表的"发布安全"列。
- **验证证据红线**：声明"完成"前必须出现 `curl` / `duckdb` / `bun run verify:full` 等命令的真实输出（`CLAUDE.md §0` / §6）。

---

### 4. 对抗审计双闸（Loop v2 · codex）

> 来源：2026-06-21 三会话并行复盘 —— 规划后无人证伪设计、完成后无独立模型对抗审计完成质量。
> 固化为单任务闭环内的**两道强制闸**（详见 [.claude/rules/loop-orchestration.md §2](../rules/loop-orchestration.md)）。

- **🛡 闸-1（计划对抗）**：合同/计划（阶段 A 后、动手前）→ 调 `codex` skill 对抗审查**设计**（缺陷/遗漏/更优解/边界）→ 修 P0/P1 再实现。结论计入质量账本 `codex_plan`。
- **🛡 闸-2（完成对抗）**：实现 + 确定性闸（verify:full/governance）绿后、**enable --auto 前** → 调 `codex` skill 审 **diff 完成质量** + `evidence-verifier` agent 证伪（fresh context）+ `claude-code.yml` CI auto-review；三源 P0/P1 全修 + 复审通过才合并。计入 `codex_done` / `verifier_refuted`。
- codex CLI 不可用 → 降级为 evidence-verifier + CI auto-review 双源，账本标 `codex_*:{"unavailable":true}`，**不得静默跳过对抗**（`feedback_no_giveup_ask_authorization`）。

### 5. 收尾三件套（与基座 scorecard 同步）

阶段 C 收尾，**一次 commit 同时**写：① backlog 状态流转（`bun scripts/backlog.mjs status`）② `pr-evolution.md` 三问复盘（`needs_automation:true` 紧跟 `expires:YYYY-MM-DD`）③ `loop-quality-ledger.jsonl` 追加一行结构化指标（schema 见 loop-orchestration §3）。多任务编排/并行调度见 [loop-orchestration.md](../rules/loop-orchestration.md)。

---

## 降级（基座不可读时）

若 `~/.claude/skills/evidence-loop-core/SKILL.md` 未安装 / 不可读：

```bash
# 1) 装基座
npx skills add alongor666/alongor666-skills -g --skill evidence-loop-core
# 2) 验证软链直连
~/alongor666-skills/skills/sync-skills/sync-skills.sh doctor
```

或按本项目 rule §4 表 + 通用 8 步 loop（基线 → 不变量 → 假设 → 最小改动 → 正确性+回归 → 前后对比 → 决策 → 沉淀）手动走，但**禁止跳过证据要求**（每条声明挂证据，否则标"未验证"）。

---

## 停止 / 回滚

命中基座 §6 任一条 → 报 **BLOCKED** 并说明，不硬推进。需破坏性 / 生产改动且未授权时暂停等用户；其余可逆且在范围内的下一步直接用工具执行，不要停在"计划"。
