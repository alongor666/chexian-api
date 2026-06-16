---
name: chexian-evidence-loop
description: 当用户要把任何复杂工作（性能优化/SQL口径修改/重构/新功能/安全加固/数据ETL）做成"可验证闭环"而非"宽泛审查"时使用 — 先建 harness 合同，再绕证据迭代。强制证据驱动、独立 verifier、停止/回滚条件。
category: workflow
scope: project
last_updated: "2026-06-15"
---

# 证据闭环驱动（/chexian-evidence-loop）

把"做一次复杂工作"升级为"在可验证闭环里工作"。协议见 [`.claude/rules/evidence-loop.md`](../../.claude/rules/evidence-loop.md)，本命令是执行器。

**用法**：`/chexian-evidence-loop <任务一句话> [--type perf|sql|refactor|feature|security|etl]`
未给 `--type` 时先自行判定并回显。

---

## 阶段 A — HARNESS 就绪报告（只读，不改代码）

先 `/plan` 只读模式。先按 `evidence-loop.md §4` 适配表查**该类型已有的项目 harness**，核实其现状，**不重新设计**。

输出：

1. **当前状态**：已实现 / 部分 / 未实现 / 未知（每项附文件路径或命令输出）
2. **harness 现状核对**：基线命令、正确性 oracle、回归门禁、发布安全机制——逐个确认能否跑、最近产物在哪、容差/阈值是多少
3. **证据表**：每条结论附 路径 / 命令输出 / 测试结果 / commit，否则标"未验证"
4. **缺口清单**：缺什么才能诚实声称做成了
5. **最小有用实验**：1 个假设 + 用哪个命令验证 + 通过阈值

铁律：凭记忆总结 / 从代码结构推断效果 / 无基线就建议改代码 —— 一律禁止。说不出"什么证据能证明做成了"就停在阶段 A。

---

## 阶段 B — LOOP 迭代（每轮固定输出 checkpoint）

按 `evidence-loop.md §2` 八步走。每轮结束**只输出**这个 checkpoint，避免长程漂移：

```
轮次：
假设：
改动文件：
跑的命令：
正确性结果：
度量结果：
基线 vs 候选：
verifier 结果：
决策：continue / promote / rollback / blocked
下一步：
未验证声明：
```

阶段性证据必须显式打出命令输出（`/goal` 的 verifier 只看会话里已呈现的证据）。

---

## 阶段 C — 收尾

1. 跑回归门禁（`evidence-loop.md §4` 对应列），贴输出
2. 调 `evidence-verifier` agent（fresh context）试图证伪本轮改进
3. 发布安全评估：现有灰度 / 健康检查 / sentinel / rollback 能否支撑；无机制则报"推进受阻"
4. scorecard 写入 `.claude/shared-memory/`（基线 / 候选 / 测试 / 风险 / 决策 / 下一实验），**不新建目录**

---

## 停止 / 回滚

命中 `evidence-loop.md §6` 任一条 → 报 **BLOCKED** 并说明，不硬推进。需破坏性 / 生产改动且未授权时暂停等用户；其余可逆且在范围内的下一步直接用工具执行，不要停在"计划"。

## 配套 /goal 模板（按类型替换 §4 的命令）

```
/goal <任务> 的证据闭环完成，当且仅当 transcript 含工具证据满足：
1 基线已建/取回（命令+环境+数据规模+≥3 次重复，或说明为何不能重复）
2 正确性 oracle 通过（该类型对应的 影子对账/golden-baseline/duckdb 直查/测试）
3 瓶颈假设绑定到代码路径或工具产物，纯猜测标未验证
4 最小改动，无无关重构
5 前后同命令/同数据/同环境并排打印
6 回归门禁通过（bun run verify:full 或 governance）
7 发布安全：灰度/sentinel/rollback 可支撑，否则报推进受阻
8 scorecard 写入 .claude/shared-memory/
遇 无法建基线/正确性不过/噪声过大/数据缺失/需未授权破坏性改动 → 报 BLOCKED。
无命令输出或产物路径不得宣称成功。
```
