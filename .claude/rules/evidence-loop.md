# 证据闭环协议（本项目 wrapper · RED LINE）

policy: append-only

> **基座**：通用协议骨架（合同六要素 / 8 步 loop / verifier 隔离 / 停止-回滚 / 默认阈值 / 三阶段执行编排 / `/goal` 模板）下沉到全局 skill **`evidence-loop-core`**（仓库 `alongor666/alongor666-skills`，本机 `~/.claude/skills/evidence-loop-core/SKILL.md`）。本文件**只保留本项目专属内容**：§4 harness 映射表 + chexian-api 红线引用。
> 入口：`/chexian-evidence-loop`（命令）· 独立验证：`evidence-verifier`（项目级 agent，提示词模板源自基座 `verifier-agent-template.md`）。

## 0. 本协议在 chexian-api 的定位

任何复杂工作（性能优化 / SQL 口径修改 / 重构 / 新功能 / 安全加固 / 数据 ETL）一律按基座协议执行：**把"完成"的定义交给外部证据，不交给模型感觉**。这是 `CLAUDE.md §0` "验证不声称" 的可操作化展开。

执行流程、阈值、停止条件、checkpoint 格式、verifier 隔离原则 → **去基座 `evidence-loop-core/SKILL.md` 读**，本文件不重复。

## 4. 任务类型 → 项目现成 harness（本项目专属注入）

> 这是基座 §4 表的本项目实现。基座只给空表 + 填法说明；本表是 chexian-api 实际能跑的脚本/命令。

| 任务类型 | 基线 / 度量 | 正确性 oracle | 回归门禁 | 发布安全 |
|---|---|---|---|---|
| 性能优化（通用） | `scripts/benchmark-key-routes.mjs`（HTTP 路由 p50/p95/p99）、`scripts/golden-baseline.mjs`（落 `.planning/golden-baseline/`）、按需 profiler | `golden-baseline.mjs --compare` 零差异 / 相关单测 | `bun run verify:full` | 视改动而定（有灰度 flag 则用） |
| └ 立方体专项（perf 的一个实例，非全部 perf） | `scripts/perf/bench-universal-cube.mjs`（L0→L3） | `server/src/services/cube-shadow.ts` 影子对账（容差见 `NUMERIC_TOLERANCE`，不在此复述数值）+ `duckdb-cube-*.test.ts` | `bun run verify:full` | `cube-promote.mjs` / `cube-rollback.mjs` / sentinel |
| SQL / 口径修改 | `curl .../api/query/* \| jq` 前后对比 | `duckdb -c "..."` 直查 Parquet vs API（`CLAUDE.md §6`）+ `verify-cross-sell.py` 等 | `bun run governance` + 单测 | 灰度 flag（如适用） |
| 重构 | 无（行为不变） | `golden-baseline.mjs --compare`（黄金基线零差异） | `bun run verify:full` | — |
| 新功能 | — | 新增测试 + `CLAUDE.md §6` curl/duckdb 验证 | `bun run verify:full` + route 契约测试 | 灰度 flag |
| 安全加固 | — | **修补不拆除**（`CLAUDE.md §0`）；`/chexian-security-review` | `bun run governance` | — |
| 数据 ETL | 转换质量报告 | `duckdb` 直查值域/对账（万分之一） | `node scripts/check-data-readiness.mjs` | sentinel |

> 度量与门禁脚本以仓库实际为准，跑前 `--help` 确认签名；找不到现成 harness 才提议新建，并先说明缺口。

## 本项目特例

- **scorecard 落位**：基座 §8 阶段 C 步骤 4 写入 `.claude/shared-memory/`（**不新建 `docs/perf/` 等目录**）。
- **verifier 隔离**：correctness / 度量 / 发布风险优先交给**确定性脚本**（影子对账 / bench / `bun run governance` / sentinel），不用 LLM subagent 去做。收尾时调本项目 `.claude/agents/evidence-verifier.md`（fresh-context）。
- **立方体专项**作为"性能 → 项目特化"实例，其 cube-shadow / cube-promote / cube-rollback 是发布安全机制的具体实现，不是基座要求。

## 关联

- 基座：`~/.claude/skills/evidence-loop-core/SKILL.md`（仓库 `alongor666/alongor666-skills`）
- 命令：[`.claude/commands/chexian-evidence-loop.md`](../commands/chexian-evidence-loop.md)（薄 wrapper）
- agent：[`.claude/agents/evidence-verifier.md`](../agents/evidence-verifier.md)（提示词模板源自基座 `verifier-agent-template.md`）
- 上位红线：`CLAUDE.md §0`（验证不声称）· §6（验证协议）
- 立方体 harness 设计：`开发文档/架构设计/通用立方体查询加速方案.md`
- AGENTS.md §8.2 append-only：本文件**结构性重构**（通用骨架上移至基座 `evidence-loop-core`，本文件降为本项目特例表），需 `[policy-override]` 授权——见本次 PR 描述。新增本项目内容仍 append-only。
