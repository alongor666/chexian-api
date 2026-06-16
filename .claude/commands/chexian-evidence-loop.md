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

## 执行（读基座 + 注入项目内容）

### 1. 读基座协议

读 `~/.claude/skills/evidence-loop-core/SKILL.md`，按其 §8 三阶段执行编排（A 只读 harness 报告 → B loop checkpoint → C 收尾 + verifier 证伪）执行。
合同六要素 / 8 步 loop / 默认阈值 / 停止-回滚 / `/goal` 模板 / verifier 隔离原则——**全部以基座为准**，本 wrapper 不重复。

### 2. 注入本项目挂载点（基座会按 §10 wrapper 接入清单读取）

| 基座挂载点 | 本项目提供 |
|---|---|
| §4 harness 映射表 | [.claude/rules/evidence-loop.md §4](../rules/evidence-loop.md) — 6 类任务的实际命令（bench / golden-baseline / cube-shadow / duckdb 直查 / verify:full / governance / sentinel） |
| verifier agent | [.claude/agents/evidence-verifier.md](../agents/evidence-verifier.md)（项目级，提示词源自基座 `verifier-agent-template.md`） |
| scorecard 落位 | `.claude/workflow/pr-evolution.md`（append；与 `commit-push-pr-core` 自进化日志同位置）。**禁止** `.claude/shared-memory/**` / `~/.claude/projects/**/memory/**` —— AGENTS.md §8.3 user-only |
| 项目治理 / 回归门禁 | `bun run governance`（聚合 32+ 项）/ `bun run verify:full`（governance + 单元测试） |

### 3. 本项目特例（覆盖基座通用项）

- **scorecard 不新建 `docs/perf/` 等目录**，append 到 `.claude/workflow/pr-evolution.md`（AI 可写；与 commit-push-pr-core 自进化日志共享文件）。AGENTS.md §8.3 列的 user-only 路径（`.claude/shared-memory/**` 等）**只读不写**。
- **发布安全机制**：立方体专项有 `cube-promote.mjs` / `cube-rollback.mjs` / sentinel；其他类型按本项目 rule §4 表的"发布安全"列。
- **验证证据红线**：声明"完成"前必须出现 `curl` / `duckdb` / `bun run verify:full` 等命令的真实输出（`CLAUDE.md §0` / §6）。

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
