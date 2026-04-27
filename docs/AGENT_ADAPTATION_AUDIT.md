# Agent 能力适配审计

## 范围

本阶段新增 `/api/agent/audit/*`，用于审计 Agent 可用指标、能力、禁用指标和确定性问题路由。它不是聊天机器人，不调用 LLM，不生成 SQL，只映射到现有 API 与 SQL 生成器。

Stage 2 在审计框架之上新增 `/api/agent/diagnosis/cost-indicators`，用于执行 `cost_indicator_diagnosis` 的确定性成本指标诊断。该接口仍不接 LLM，不生成自由 SQL，只复用现有成本 SQL 生成器和权限边界。

Stage 3 PR1 新增 `/api/agent/diagnosis/growth`，用于执行 `growth_diagnosis` 的确定性增长诊断。该接口复用 `generateGrowthQuery` 与 `generateDailyGrowthWithContextQuery`，要求请求显式传入当前期和基期日期，不在 SQL 或服务层隐式取当天。

Stage 3 PR2 新增 `/api/agent/diagnosis/quote-conversion`，用于执行 `quote_conversion_diagnosis` 的确定性报价转化诊断。该接口仅复用 `kpi`、`funnel`、`drilldown`、`trend` 四类既有报价转化查询，不纳入 `heatmap`、`price`、`ranking`，也不输出利润、盈利、亏损或承保利润结论。

Stage 3 PR3 新增 `/api/agent/diagnosis/renewal-tracker`，用于执行 `renewal_tracker_diagnosis` 的确定性续保追踪诊断。该接口仅复用当前 `/api/query/renewal-tracker` 背后的 `generateRenewalTrackerQuery` 与 `generateRenewalTrackerMetaQuery`，按 `expiry_date` 到期范围和 `cutoff` 截至日解释 A/B/C 指标，不接入旧 renewal funnel/v2。

Stage 3 PR4 新增 `/api/agent/diagnosis/claims-risk`，用于执行 `claims_risk_diagnosis` 的确定性赔案风险诊断。该接口仅复用 ClaimsDetail 的 `pending-overview`、`cause-analysis`、`frequency-yoy` 三类既有查询，不纳入 `pending-by-org`、`pending-aging`、地理风险、理赔周期、赔付率发展或热力图子路由。ClaimsDetail 是当前快照视图，本能力只做经营风险提示，不做完整准备金、IBNR、精算终极赔付或财务盈亏判断。

Stage 3 PR5 新增 `/api/agent/diagnosis/customer-flow`，用于执行 `customer_flow_diagnosis` 的确定性客户流向诊断。该接口仅复用 CustomerFlow 的 `summary`、`inflow`、`outflow`、`trend` 四类既有查询；`metadata` 只用于数据新鲜度和 readiness 判断，不作为诊断指标主输出。CustomerFlow 当前 SQL 生成器只支持年度过滤，没有机构或业务员级权限筛选字段，因此 Agent 诊断端点对机构用户和电销用户返回 403，不降级为无权限过滤的全量查询。

Stage 4 新增 `/api/agent/diagnosis/business-patrol`，用于执行 `business_patrol_diagnosis` 的确定性经营巡检聚合。该接口并行调用增长、成本指标、报价转化、续保追踪、赔案风险、客户流向六个已注册诊断能力，设置子诊断超时，单个子诊断失败或超时时返回 warning 而不是让整体 500。不新增 SQL 生成器，不接 LLM，不生成自由 SQL。

Stage 4.5 对 `/api/agent/audit/readiness` 做确定性能力总验收硬化。该接口明确暴露 Stage 1-4 已完成、7 个确定性诊断端点已具备 HTTP 集成测试与 route contract 证据，并列出 Stage 5 LLM 解释层仍被生产 audit log、30 天错误率和调用方展示 `warnings` / `forbiddenInterpretations` 的验收证据阻塞。

Stage 4.6 新增 `/api/agent/audit/observability`，用于读取既有 audit log，统计最近 30 天 `/api/agent/diagnosis/*` 调用量、错误数、错误率和各确定性诊断端点覆盖情况。请求路径只异步读取审计日志尾部的限量样本；如果尾部样本不能证明覆盖完整 30 天窗口，则只能证明有生产调用记录，不能解除 30 天 error rate 阻塞。该阶段只建立生产观测与验收证据闭环，不接 LLM，不新增 SQL，不改变诊断口径；`readiness` 会引用该观测证据，但在缺少生产日志、30 天 error rate 或调用方展示证据时仍保持 `readyForLlm=false`。

Stage 4.7 新增 `scripts/verify-agent-production-smoke.mjs`，用于把 Stage 5 前置条件变成可执行验收命令。该脚本只调用固定 Agent API：7 个确定性诊断端点、`/api/agent/audit/observability` 和 `/api/agent/audit/readiness`；请求时间参数必须显式传入，报告中不写入 bearer token。脚本会分别记录诊断接口可用性、调用方是否收到 `warnings` / `forbiddenInterpretations`、observability 状态和 readiness 中的 Stage 5 阻塞项。

Stage 4.8 关闭调用方展示证据缺口。`/api/agent/audit/observability` 的 `displayContract.status` 现在返回 `verified_by_caller_smoke_harness`，证据来自固定 smoke harness 和对应测试；`/api/agent/audit/readiness` 中 `warnings_and_forbidden_interpretations_displayed` 前置项标记为 `met=true`。这只证明调用方接收并展示所需字段，不启动 LLM，不放开聊天窗口，也不改变 `readyForLlm=false` 的显式关闭状态。

Stage 5 preflight 新增边界审计文档 [`docs/AGENT_STAGE5_LLM_BOUNDARY_AUDIT.md`](./AGENT_STAGE5_LLM_BOUNDARY_AUDIT.md)，用于定义未来 `POST /api/agent/explain/diagnosis` 的最小输入输出合同、必须复用的 `routeAgentQuestion` / `unsupportedMetricRegistry` / Agent 指标注册表 / `warnings` / `forbiddenInterpretations` / sql-guard，以及现有 `/api/copilot/runs/:runId/report?includeNarrative=1` 与 Agent Stage 5 解释层的区别。该 preflight 只做设计边界和源扫描测试，不新增 LLM 调用，不注册 `/api/agent/explain` 路由，不改变 `readyForLlm=false`。

Stage 5A 新增 `/api/agent/explain/diagnosis`，用于解释调用方已取得的确定性诊断 API 响应。该接口不触发 DuckDB 查询、不调用 SQL 生成器、不执行工作流或任意工具；请求和响应均通过 Agent explanation schema Zod 校验。解释前先通过 `routeAgentQuestion` 识别 unsupported/caution 语义，并复用 `unsupportedMetricRegistry`、Agent 指标注册表、输入诊断结果的 `warnings` / `forbiddenInterpretations` 和 LLM `sql-guard`。本阶段仍不做聊天窗口，且 `/api/agent/audit/readiness` 继续保持 `readyForLlm=false`，等待解释入口生产 smoke 与观测证据闭环后再单独释放。

## API

- `GET /api/agent/audit/metrics`：返回 Agent 指标注册表、支持级别和口径边界。
- `GET /api/agent/audit/capabilities`：返回 Agent 能力注册表。
- `GET /api/agent/audit/unsupported`：返回必须拒绝的指标和替代建议。
- `GET /api/agent/audit/observability`：返回 Agent 诊断接口审计日志覆盖、30 天错误率和 Stage 5 证据状态。
- `GET /api/agent/audit/readiness`：返回 Agent 阶段化就绪状态、确定性诊断端点验收清单和 Stage 5 前置阻塞项。
- `POST /api/agent/audit/route-question`：确定性问题路由。
- `POST /api/agent/explain/diagnosis`：解释确定性诊断 API 返回的数据；不触发查询，不生成 SQL，不自创指标。

所有返回结构都经过 Zod schema 校验。路由挂载在 `/api/agent/audit`，继续使用全局审计中间件，并在路由内使用 `authMiddleware` 和 `permissionMiddleware`。

`/api/agent/audit/readiness` 当前应显示 `currentStage=stage_4_8_display_contract_ready`，`readyForLlm=false`。Stage 5A 已注册 `POST /api/agent/explain/diagnosis`，但 readiness 开关仍需单独生产释放；在本阶段 readiness 只继续将以下生产运行证据缺口作为 LLM 前置阻塞项：

- 生产 audit log 能看到 `/api/agent/diagnosis/*` 调用记录。
- 最近 30 天 `/api/agent/diagnosis/*` error rate < 1%。

调用方展示证据已由 `scripts/verify-agent-production-smoke.mjs` 和 `tests/api/agent-production-smoke-harness.test.mjs` 锁定。底层确定性诊断接口必须继续返回 `warnings` 与 `forbiddenInterpretations`，调用方不得忽略这些字段。

`/api/agent/audit/observability` 只把 `NODE_ENV=production` 且最近 30 天存在 `/api/agent/diagnosis/*` 调用的日志视为生产审计证据；本地开发日志或无调用日志只能证明统计链路可用，不能解除 Stage 5 阻塞。30 天 error rate < 1% 还要求 `windowComplete=true`，避免用截断的日志尾部样本替代完整观测窗口。

## 生产验收 smoke

运行示例：

```bash
bun run verify:agent:smoke -- --token "$AGENT_SMOKE_TOKEN" --base-url https://chexian.cretvalu.com --start-date 2026-04-01 --end-date 2026-04-26 --baseline-start-date 2025-04-01 --baseline-end-date 2025-04-26
```

该命令会在 `output/agent-smoke/` 生成 JSON 报告。报告只用于验收确定性接口和 Stage 5 前置证据，不会触发 LLM、NL2SQL 或自由 SQL。

2026-04-27 的线上 smoke 验收已确认 7 个确定性诊断端点、observability 和 readiness 均返回 200 JSON；调用方展示契约 `callerDisplayContractVerified=true`，生产 audit log 可观测，最近 30 天错误率低于 1%。本地 `output/agent-smoke/` 报告属于运行产物，不纳入仓库。

成本指标诊断路由挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件，并在路由内使用 `authMiddleware`、`permissionMiddleware` 和 `createDomainMiddleware('ClaimsAgg')`。

增长诊断路由同样挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件、查询级限流、`authMiddleware`、`permissionMiddleware` 和 `createDomainMiddleware('PolicyFact')`。请求和响应均通过 Agent schema 层 Zod 校验。

报价转化诊断路由同样挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件、查询级限流、`authMiddleware`、`permissionMiddleware` 和 `createDomainMiddleware('QuoteConversion')`。请求和响应均通过 Agent schema 层 Zod 校验，并将机构用户、电销用户的权限边界转为既有报价转化 SQL 生成器支持的筛选参数。

续保追踪诊断路由同样挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件、查询级限流、`authMiddleware`、`permissionMiddleware` 和 `createDomainMiddleware('RenewalTracker')`。请求和响应均通过 Agent schema 层 Zod 校验，时间参数必须显式传入 `start`、`end`、`cutoff`，不在 SQL 或服务层隐式取当天。

赔案风险诊断路由同样挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件、查询级限流、`authMiddleware`、`permissionMiddleware` 和 `createDomainMiddleware('ClaimsDetail', 'ClaimsAgg')`。请求和响应均通过 Agent schema 层 Zod 校验。机构用户权限会转换为 ClaimsDetail SQL 生成器支持的 `orgName` 过滤；电销用户因 ClaimsDetail 当前筛选集没有电销字段，路由返回 403，不降级为无权限过滤的全量查询。

客户流向诊断路由同样挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件、查询级限流、`authMiddleware`、`permissionMiddleware` 和 `createDomainMiddleware('CustomerFlow')`。请求和响应均通过 Agent schema 层 Zod 校验。由于 CustomerFlow 当前视图和 SQL 生成器缺少机构、电销、业务员级过滤字段，机构用户和电销用户请求会返回 403，避免把全局客户流向误暴露给受限角色。

经营巡检聚合路由同样挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件、查询级限流、`authMiddleware` 和 `permissionMiddleware`。请求和响应均通过 Agent schema 层 Zod 校验。该路由不在进入 handler 前预加载所有子域，而是在各子诊断 task 内按需加载自身依赖域；单个子域加载失败或超时时会进入对应子诊断的 partial/warning 降级逻辑。该路由只编排已有确定性诊断能力；各子诊断仍复用自身权限过滤、口径警示和禁止解释边界。

## 支持能力

- `business_patrol_diagnosis`：经营巡检。确定性接口为 `POST /api/agent/diagnosis/business-patrol`，并行聚合增长、成本指标、报价转化、续保追踪、赔案风险和客户流向六类诊断，输出经营异常优先级、受影响指标、推荐下钻能力、子诊断失败/超时 warning 和禁止解释汇总；不新增 SQL 生成器，不输出利润、盈利、亏损、边际贡献或承保利润结论。
- `growth_diagnosis`：增长归因。确定性接口为 `POST /api/agent/diagnosis/growth`，输出增长异常、主要维度贡献和下钻建议；禁止输出利润、盈利、亏损或承保利润结论。
- `cost_indicator_diagnosis`：成本指标诊断。
- `quote_conversion_diagnosis`：报价转化诊断。确定性接口为 `POST /api/agent/diagnosis/quote-conversion`，输出转化率概览、漏斗卡点、机构/团队/业务员差异和趋势异常；本阶段仅接入 `quote_conversion.kpi`、`quote_conversion.funnel`、`quote_conversion.drilldown`、`quote_conversion.trend`，不接入 heatmap、price、ranking；禁止输出利润、盈利、亏损或承保利润结论。
- `renewal_tracker_diagnosis`：续保追踪诊断。确定性接口为 `POST /api/agent/diagnosis/renewal-tracker`，输出续保追踪概览、到期/报价/续保 cutoff 口径说明、机构/团队/业务员弱项、客户类别/险别组合/能源/新旧过户/续转新车维度风险；仅使用当前 renewal-tracker，不接入旧 renewal funnel/v2；禁止输出利润、盈利、亏损或承保利润结论。
- `claims_risk_diagnosis`：赔案风险诊断。确定性接口为 `POST /api/agent/diagnosis/claims-risk`，输出未决风险、出险原因、频度变化、案均/赔案强度提示和下钻建议；本阶段仅接入 `claims_detail.pending_overview`、`claims_detail.cause_analysis`、`claims_detail.frequency_yoy`，不接入未列出的 ClaimsDetail 子路由；禁止输出完整准备金、IBNR、利润、盈利、亏损或承保利润结论。
- `customer_flow_diagnosis`：客户流向诊断。确定性接口为 `POST /api/agent/diagnosis/customer-flow`，输出客户流入、客户流出、净流向、趋势异常、主要来源/去向保险公司和数据 readiness；本阶段仅接入 `customer_flow.summary`、`customer_flow.inflow`、`customer_flow.outflow`、`customer_flow.trend`，`customer_flow.metadata` 仅用于 freshness/readiness；禁止输出利润、盈利、亏损或承保利润结论。

## 谨慎能力

- `comprehensive_cost_indicator_review`：综合费用/综合成本历史指标审阅。仅用于项目已有经营指标口径审阅，不作为财务综合成本率 Agent。

## 下线或禁用能力

- `renewal_funnel_diagnosis`：deprecated。
- `renewal_v2_diagnosis`：deprecated。
- `underwriting_profit_diagnosis`：unsupported。
- `profit_margin_diagnosis`：unsupported。
- `financial_combined_ratio_diagnosis`：unsupported。

## 路由行为

问题“变动成本率为什么升高？”会路由到 `cost_indicator_diagnosis`，推荐：

- 指标：`variable_cost_ratio`、`earned_claim_ratio`、`expense_ratio`
- 工具：`cost.variable_cost`、`cost.claim_ratio`、`cost.expense_ratio`
- 警示：变动成本率是项目内经营分析口径，不代表完整财务承保利润。

问题“哪个机构承保利润最低？”会直接 blocked，原因是当前项目不支持承保利润分析，并返回成本指标诊断、增长归因、报价转化、续保追踪、赔案风险等替代方向。

问题“哪个机构综合成本率最高？”如果没有明确说财务、承保或完整综合成本率，则返回 `caution`，建议改问变动成本率、赔付率、费用率或项目已有 comprehensiveCost 历史指标审阅。不得输出利润或盈亏结论。

问题“本月保费增长来自哪里？”路由到 `growth_diagnosis`。

问题“报价转化卡在哪里？”路由到 `quote_conversion_diagnosis`。

问题“续保情况怎么样？”路由到 `renewal_tracker_diagnosis`。
