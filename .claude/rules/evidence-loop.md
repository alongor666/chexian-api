# 证据闭环协议（通用·RED LINE）

policy: append-only

> 任何复杂工作（性能优化 / SQL 口径修改 / 重构 / 新功能 / 安全加固 / 数据 ETL）一律按此协议执行：**把"完成"的定义交给外部证据，不交给模型感觉。** 这是 `CLAUDE.md §0`"验证不声称"的可操作化展开。
> 入口：`/chexian-evidence-loop`（命令）· 独立验证：`evidence-verifier`（agent）。

## 1. 合同公式

> 业务目标 + 可度量终止条件 + 证据要求 + loop 迭代协议 + 独立 verifier + 停止/回滚条件

缺任一项 = 不是闭环，会退化成"看起来专业的自然语言报告"。开工前先把这六项写出来，写不出"什么证据能证明做成了"就先别动代码。

## 2. 通用 loop

1. 建立 / 确认基线（baseline）
2. 改动前先定义正确性不变量（correctness invariants）
3. 提出瓶颈 / 缺陷假设，绑定到代码路径或工具产物
4. 实现**最小有用改动**（只改假设必需文件，无无关重构）
5. 跑正确性验证 + 该任务类型的回归 / 度量
6. 同命令、同数据、同环境做前后对比
7. 决策：promote / rollback / continue
8. 结论沉淀到 `.claude/shared-memory/`（**不新建 `docs/perf/` 等目录**）

## 3. 证据要求（每条声明都要挂证据）

命令 + 文件路径 + 运行输出 + 前后度量 + 数据规模 + 环境 + commit/工作树状态 + 回归结果 + 风险与回滚条件。

任何声明若无 工具结果 / 测试输出 / 度量输出 / 日志 / 文件 diff / 已提交产物 支撑 → 必须显式标 **"未验证"**。**禁止凭记忆总结、从代码结构推断效果。**

## 4. 任务类型 → 项目现成 harness（别另造）

| 任务类型 | 基线 / 度量 | 正确性 oracle | 回归门禁 | 发布安全 |
|---|---|---|---|---|
| 性能优化（通用） | `scripts/benchmark-key-routes.mjs`（HTTP 路由 p50/p95/p99）、`scripts/golden-baseline.mjs`（落 `.planning/golden-baseline/`）、按需 profiler | `golden-baseline.mjs --compare` 零差异 / 相关单测 | `bun run verify:full` | 视改动而定（有灰度 flag 则用） |
| └ 立方体专项（perf 的一个实例，非全部 perf） | `scripts/perf/bench-universal-cube.mjs`（L0→L3） | `server/src/services/cube-shadow.ts` 影子对账（容差见 `NUMERIC_TOLERANCE`，不在此复述数值）+ `duckdb-cube-*.test.ts` | `bun run verify:full` | `cube-promote.mjs` / `cube-rollback.mjs` / sentinel |
| SQL / 口径修改 | `curl .../api/query/* \| jq` 前后对比 | `duckdb -c "..."` 直查 Parquet vs API（§6）+ `verify-cross-sell.py` 等 | `bun run governance` + 单测 | 灰度 flag（如适用） |
| 重构 | 无（行为不变） | `golden-baseline.mjs --compare`（黄金基线零差异） | `bun run verify:full` | — |
| 新功能 | — | 新增测试 + §6 curl/duckdb 验证 | `bun run verify:full` + route 契约测试 | 灰度 flag |
| 安全加固 | — | **修补不拆除**（§0）；`/chexian-security-review` | `bun run governance` | — |
| 数据 ETL | 转换质量报告 | `duckdb` 直查值域/对账（万分之一） | `node scripts/check-data-readiness.mjs` | sentinel |

> 度量与门禁脚本以仓库实际为准，跑前 `--help` 确认签名；找不到现成 harness 才提议新建，并先说明缺口。

## 5. verifier 隔离原则

- 实现 agent **不得**作为自己工作的唯一验证者。
- correctness / 度量 / 发布风险优先交给**确定性脚本**（影子对账 / bench / governance / sentinel），不用 LLM subagent 去做。
- 探索用只读 subagent；收尾用 1 个 **fresh-context** `evidence-verifier` 试图证伪。**不要 7 个 verifier**——多数验证已是脚本。

## 6. 停止 / 回滚条件（命中即报 BLOCKED，不硬推进）

无法建立稳定基线 · 正确性无法验证（oracle 失效）· 度量噪声过大（CV>10% 标"噪声大"）· 测试数据缺失 · 权限不足跑不了必要命令 · 下一步需未授权的破坏性 / 生产改动（部署 / 数据库 / 外部服务 / 生产配置——除非任务明确授权，且优先用现有灰度 / 回滚机制）。

## 7. 默认阈值（可改，不可没有）

无正确性回归 · 无 route/测试回归 · 目标 median 或 p95 改善 ≥20%（性能类）· 内存峰值增幅 ≤10%（否则需说明）· 度量 CV ≤10%。没阈值 = loop 没刹车。

## 关联

- 命令：[`.claude/commands/chexian-evidence-loop.md`](../commands/chexian-evidence-loop.md)
- agent：[`.claude/agents/evidence-verifier.md`](../agents/evidence-verifier.md)
- 上位红线：`CLAUDE.md §0`（验证不声称）· §6（验证协议）
- 立方体 harness 设计：`开发文档/架构设计/通用立方体查询加速方案.md`
- AGENTS.md §8.2 append-only：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权
