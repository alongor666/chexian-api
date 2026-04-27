# Agent 化升级总览

> 本文档定义 chexian-api 从 API-only 数据平台升级为 Agent-ready 系统的边界、阶段和验收口径。

## 1. 当前运行时基线

chexian-api 当前是 API-only + DuckDB native 架构：

- 前端：React + TypeScript + Vite，仅通过 `src/shared/api/client.ts` 调用后端。
- 后端：Express REST API，负责认证、权限、路由、缓存、AI 能力和数据查询。
- 分析引擎：DuckDB native 运行在后端 Node.js 进程中，入口为 `server/src/services/duckdb.ts`，依赖 `@duckdb/node-api`。
- 数据：Parquet / 预聚合文件由后端加载，前端不直接读取 Parquet。
- 已下线边界：浏览器 DuckDB-WASM、Local SQL 查询模式、前端直接 SQL 执行链路。

任何 Agent 化升级都必须保持这条运行时边界：Agent 调用 API 或受控后端工具，不把 DuckDB 查询能力重新搬回浏览器。

## 2. 升级目标

Agent 化升级的目标不是替换现有业务系统，而是在现有 API-only 架构上增加可治理、可审计、可回滚的智能操作层：

- 面向业务用户：把自然语言问题转成受权限控制的数据查询、解释和下钻建议。
- 面向运营人员：把数据刷新、快照验证、发布验收等流程编排成可追踪任务。
- 面向开发协作：让 Agent 使用指标注册表、字段注册表、业务规则字典和现有 API 合约，而不是绕过治理直接拼 SQL。
- 面向风险控制：保留认证、RBAC、行级过滤、限流、审计日志和只读查询边界。

## 3. 分层设计

| 层级 | 职责 | 关键边界 |
|------|------|----------|
| L0 现有业务系统 | 页面、API、SQL 生成器、DuckDB native 查询 | 保持 API-only，不新增浏览器 SQL 引擎 |
| L1 Agent API Facade | 暴露可被 Agent 调用的后端能力清单 | 只封装稳定 API/服务，不直接开放任意 SQL |
| L2 Task Orchestrator | 编排多步任务，如诊断、刷新、验收、报告生成 | 每一步写入任务状态、输入、输出和错误 |
| L3 Knowledge & Policy | 指标、字段、业务规则、权限、数据契约 | 以注册表和知识库为事实源，不让提示词自造口径 |
| L4 Audit & Guardrails | 权限、限流、审计、回放、人工确认 | 高风险动作必须可追踪、可中断、可回滚 |

## 4. 阶段路线

### PR-0：运行时文档对齐

- 修正残留的 DuckDB-WASM / Local 模式描述。
- 统一 README、TECH_STACK、ARCHITECTURE 的系统定位。
- 明确当前系统是 API-only + DuckDB native。
- 新增本文档作为后续 Agent 化升级入口。

### PR-1：Agent 能力目录

- 梳理现有 API、脚本、数据管道、治理命令，形成 Agent 可调用能力目录。
- 区分只读查询、低风险操作、高风险操作和禁止操作。
- 为每类能力定义输入、输出、权限、审计字段和失败语义。

### PR-2：受控查询与解释

- 基于指标注册表和字段注册表暴露受控查询能力。
- 禁止 Agent 任意拼接生产 SQL；复杂查询必须走后端白名单生成器或专用服务。
- 查询结果必须附带口径、过滤条件、数据时间范围和权限范围。

### PR-3：任务编排与状态机

- 引入任务状态模型，覆盖 pending/running/succeeded/failed/cancelled。
- 将数据刷新、快照构建、发布验收、诊断报告纳入可观测任务。
- 所有任务记录操作者、输入参数、产物路径、验证结果和错误摘要。

### PR-4：人工确认与生产护栏

- 对数据写入、部署、权限变更、批量导出等动作增加确认门。
- 生产动作必须绑定验证命令和回滚说明。
- 审计日志需要能回答：谁触发、触发了什么、影响了哪些数据、验证是否通过。

### PR-5：Agent LLM 解释层

- 进入实现前必须先满足 Stage 1-4 的确定性诊断、生产 observability、30 天错误率和调用方展示 `warnings` / `forbiddenInterpretations` 的验收要求。
- 未来最小入口为 `POST /api/agent/explain/diagnosis`，只解释确定性诊断 API 返回的数据，不触发查询、工作流或任意工具。
- LLM 解释层必须复用 `routeAgentQuestion`、`unsupportedMetricRegistry`、Agent 指标注册表、诊断响应中的 `warnings` / `forbiddenInterpretations` 和 LLM sql-guard。
- 现有 `/api/copilot/runs/:runId/report?includeNarrative=1` 是 workflow report 的可选 narrative，不是 Agent Stage 5 解释层。
- 详细边界以 [`docs/AGENT_STAGE5_LLM_BOUNDARY_AUDIT.md`](./AGENT_STAGE5_LLM_BOUNDARY_AUDIT.md) 为准；在单独实现 PR 之前，`/api/agent/audit/readiness` 必须保持 `readyForLlm=false`。

## 5. 验收原则

- 不破坏现有 API-only 数据链路。
- 不重新引入 DuckDB-WASM 或前端 Local 查询模式。
- 不绕过 JWT、RBAC、行级过滤、限流和审计。
- 每个 Agent 能力都有明确的输入输出契约和失败语义。
- 每个高风险动作都有验证证据和回滚路径。
- 文档、注册表、脚本索引和运行时代码保持一致。
- LLM 只能解释确定性 API 返回的数据，不生成 SQL，不自创指标，不输出承保利润、利润率、边际贡献、财务盈利或财务亏损。
