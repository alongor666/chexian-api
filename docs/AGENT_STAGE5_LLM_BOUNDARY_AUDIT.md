# Agent Stage 5 LLM 解释层边界审计

## 结论

Stage 5A 已进入最小实现：`POST /api/agent/explain/diagnosis` 是受保护的解释入口，只解释确定性诊断 API 返回的数据，不触发查询、工作流或任意工具。当前 `/api/agent/audit/readiness` 仍保持 `readyForLlm=false`，直到解释入口完成生产 smoke 与观测证据闭环后再单独释放 readiness 开关。

本阶段不新增聊天窗口，不生成 SQL，不自创指标。LLM 只用于 narrative explanation，且必须经过 Agent registry、unsupported metric registry、`routeAgentQuestion` 和 sql-guard 约束。

## 当前代码事实

- `/api/agent/audit/*` 和 `/api/agent/diagnosis/*` 是 Agent 指标体系与确定性诊断的主路径。
- `/api/agent/explain/diagnosis` 是 Stage 5A 最小解释入口，挂载 `authMiddleware`、`permissionMiddleware` 和 `queryLimiter`。
- `server/src/agent/` 只允许在 `agent-explain` / `agent-diagnosis-explanation-service` 中通过 LLM adapter 做 narrative explanation，不允许 DuckDB 查询、SQL generator、NL2SQL、rawSql/freeSql。
- `server/src/agent/schemas/agent-audit.schema.ts` 仍声明 `readyForLlm=false`。
- `/api/copilot/runs/:runId/report?includeNarrative=1` 已存在可选 LLM narrative，但它解释的是 workflow report，不是 Agent Stage 5 解释层。
- `server/src/skills/adapters/llm/` 已有 narrative adapter 和 sql-guard，可复用为 Stage 5 的底层 provider 边界。
- `server/src/skills/red-line-policy.ts` 保护的是 skill/workflow 输出，不等价于 Agent 指标注册表、unsupported metric registry 或诊断 API 的禁止解释边界。

## Stage 5 最小入口

Stage 5A 只新增一个受保护入口：

`POST /api/agent/explain/diagnosis`

该入口只解释确定性诊断 API 返回的数据。调用方必须先调用以下之一：

- `POST /api/agent/diagnosis/cost-indicators`
- `POST /api/agent/diagnosis/growth`
- `POST /api/agent/diagnosis/quote-conversion`
- `POST /api/agent/diagnosis/renewal-tracker`
- `POST /api/agent/diagnosis/claims-risk`
- `POST /api/agent/diagnosis/customer-flow`
- `POST /api/agent/diagnosis/business-patrol`

Stage 5A 不直接查询 DuckDB，不调用 SQL generator，不接受自然语言生成 SQL，不执行任意工具。

## 输入合同

请求必须通过 Agent schema 层 Zod parse，建议结构：

```json
{
  "sourceCapabilityId": "cost_indicator_diagnosis",
  "userQuestion": "变动成本率为什么升高？",
  "diagnosisResult": {
    "capabilityId": "cost_indicator_diagnosis",
    "status": "supported",
    "requestedTools": ["cost.variable_cost"],
    "summary": {},
    "diagnostics": [],
    "warnings": ["项目内经营分析口径，不代表完整财务综合成本率。"],
    "forbiddenInterpretations": ["承保利润", "利润率", "财务盈利", "财务亏损"]
  }
}
```

约束：

- `diagnosisResult` 必须来自确定性诊断 API 的响应形状，不能由 LLM 自造。
- `warnings` 与 `forbiddenInterpretations` 必须原样传入解释层。
- `sourceCapabilityId` 必须存在于 `agent-data-capability-registry.ts`。
- 如果带 `userQuestion`，必须先走 `routeAgentQuestion`；命中 unsupported 时直接拒绝解释。
- 如果解释涉及指标 id，必须能在 `agent-metric-registry.ts` 或 `unsupportedMetricRegistry` 中找到边界说明。

## 输出合同

响应也必须通过 Zod parse，建议结构：

```json
{
  "capabilityId": "cost_indicator_diagnosis",
  "status": "explained",
  "summary": "变动成本率上升主要来自费用率与满期赔付率共同变化。",
  "referencedMetricIds": ["variable_cost_ratio", "earned_claim_ratio", "expense_ratio"],
  "evidence": [
    {
      "metricId": "variable_cost_ratio",
      "source": "diagnosis.summary",
      "note": "只引用确定性诊断返回的数据"
    }
  ],
  "warnings": ["项目内经营分析口径，不代表完整财务综合成本率。"],
  "forbiddenInterpretations": ["承保利润", "利润率", "财务盈利", "财务亏损"],
  "unsupportedRefusals": [],
  "narrativeMeta": {
    "provider": "mock-or-zhipu",
    "blockedBySqlGuard": false
  }
}
```

约束：

- 输出必须保留输入中的全部 `warnings` 和 `forbiddenInterpretations`。
- `referencedMetricIds` 只能来自确定性诊断结果或 Agent 指标注册表。
- `unsupportedRefusals` 必须记录被 `unsupportedMetricRegistry` 或 `routeAgentQuestion` 拦截的内容。
- 如果 sql-guard 命中，返回占位解释并设置 `blockedBySqlGuard=true`。
- 不得输出 SQL、字段名推理、表名、查询计划或底层错误细节。

## 禁止输出

以下内容必须保持 blocked 或 refusal：

- 承保利润、承保盈利、承保亏损。
- 利润率、净利润、财务盈利、财务亏损。边际贡献额可解释为项目经营指标，但必须声明其仅扣除变动成本，不得等同承保利润。
- 财务综合成本率、完整综合成本率、承保综合成本率。
- 把变动成本率解释成完整财务综合成本率。
- 把成本指标诊断解释成机构盈利或亏损。
- LLM 自创指标、公式、维度或 SQL；解释层必须明确不自创指标。

## 必须复用的护栏

- `routeAgentQuestion`：在解释前识别用户问题是否 unsupported 或 caution。
- `unsupportedMetricRegistry`：承保利润、利润率、财务综合成本率等禁止语义的唯一来源。
- `agent-metric-registry.ts`：supported / caution / unsupported / deprecated 口径边界。
- 确定性诊断响应中的 `warnings` 和 `forbiddenInterpretations`。
- `server/src/skills/adapters/llm/sql-guard.ts`：拦截 LLM 输出中的 SQL 形态。
- `authMiddleware`、`permissionMiddleware`、`auditMiddleware`、`queryLimiter`。

## 与 Copilot 的关系

`/api/copilot/runs/:runId/report?includeNarrative=1` 是 workflow report 的可选 narrative 增强。它不是 Agent Stage 5 解释层，不能替代 `POST /api/agent/explain/diagnosis`。

主要差异：

- Copilot narrative 的输入是 report-template markdown；Agent Stage 5 的输入必须是确定性诊断 API 的结构化响应。
- Copilot narrative 不负责 Agent 指标注册表映射；Agent Stage 5 必须引用 metric id、warnings、forbiddenInterpretations。
- Copilot narrative 是 opt-in 报告摘要；Agent Stage 5 是受 Agent registry 约束的指标解释层。

## Stage 5A 实现建议

新增文件：

- `server/src/agent/schemas/agent-explanation.schema.ts`
- `server/src/agent/services/agent-diagnosis-explanation-service.ts`
- `server/src/agent/routes/agent-explain.ts`
- `tests/api/agent-diagnosis-explanation.test.ts`
- `tests/api/agent-diagnosis-explanation.route-contract.test.ts`

新增路由常量：

- `server/src/config/api-routes.ts`
- `src/shared/api/routes.ts`

路由挂载：

- `app.use('/api/agent/explain', agentExplainRoutes)`

Stage 5A 只允许解释，不允许触发诊断、查询、工作流或任意工具。调用方需要先拿到诊断结果，再提交给解释层。

## Stage 5A 验收

必须新增测试覆盖：

- 输入缺少 `warnings` 或 `forbiddenInterpretations` 时拒绝。
- 用户问题包含承保利润、利润率、财务盈亏时拒绝；边际贡献额问题必须路由到成本指标边界说明。
- 用户问题包含财务综合成本率或承保综合成本率时拒绝。
- 用户问题模糊说综合成本率时返回 caution，不输出利润或盈亏结论。
- 变动成本率解释必须保留“项目内经营分析口径”警示。
- 输出必须包含 `referencedMetricIds`、`warnings`、`forbiddenInterpretations`、`unsupportedRefusals`。
- 源码扫描确认 Agent explain 服务不调用 SQL generator、DuckDB query、rawSql/freeSql/NL2SQL。
- LLM 输出命中 SQL guard 时返回占位解释。

## 后续释放条件

Stage 5A 入口合并后，释放 `readyForLlm=true` 前必须保持以下事实：

- `/api/agent/audit/readiness` 的 Stage 5 前置项全部为 true。
- `POST /api/agent/explain/diagnosis` 具备生产 smoke 与审计日志证据。
- `readyForLlm=false` 仍是显式开关，直到单独 readiness release PR 修改。
- 生产 smoke 报告可验证 `callerDisplayContractVerified=true`。
- 解释输出仍保留 `warnings` 与 `forbiddenInterpretations`，并通过 sql-guard。
