# Agent 能力适配审计

## 范围

本阶段新增 `/api/agent/audit/*`，用于审计 Agent 可用指标、能力、禁用指标和确定性问题路由。它不是聊天机器人，不调用 LLM，不生成 SQL，只映射到现有 API 与 SQL 生成器。

Stage 2 在审计框架之上新增 `/api/agent/diagnosis/cost-indicators`，用于执行 `cost_indicator_diagnosis` 的确定性成本指标诊断。该接口仍不接 LLM，不生成自由 SQL，只复用现有成本 SQL 生成器和权限边界。

Stage 3 PR1 新增 `/api/agent/diagnosis/growth`，用于执行 `growth_diagnosis` 的确定性增长诊断。该接口复用 `generateGrowthQuery` 与 `generateDailyGrowthWithContextQuery`，要求请求显式传入当前期和基期日期，不在 SQL 或服务层隐式取当天。

Stage 3 PR2 新增 `/api/agent/diagnosis/quote-conversion`，用于执行 `quote_conversion_diagnosis` 的确定性报价转化诊断。该接口仅复用 `kpi`、`funnel`、`drilldown`、`trend` 四类既有报价转化查询，不纳入 `heatmap`、`price`、`ranking`，也不输出利润、盈利、亏损或承保利润结论。

## API

- `GET /api/agent/audit/metrics`：返回 Agent 指标注册表、支持级别和口径边界。
- `GET /api/agent/audit/capabilities`：返回 Agent 能力注册表。
- `GET /api/agent/audit/unsupported`：返回必须拒绝的指标和替代建议。
- `GET /api/agent/audit/readiness`：返回第一阶段就绪状态。
- `POST /api/agent/audit/route-question`：确定性问题路由。

所有返回结构都经过 Zod schema 校验。路由挂载在 `/api/agent/audit`，继续使用全局审计中间件，并在路由内使用 `authMiddleware` 和 `permissionMiddleware`。

成本指标诊断路由挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件，并在路由内使用 `authMiddleware`、`permissionMiddleware` 和 `createDomainMiddleware('ClaimsAgg')`。

增长诊断路由同样挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件、查询级限流、`authMiddleware`、`permissionMiddleware` 和 `createDomainMiddleware('PolicyFact')`。请求和响应均通过 Agent schema 层 Zod 校验。

报价转化诊断路由同样挂载在 `/api/agent/diagnosis`，继续使用全局审计中间件、查询级限流、`authMiddleware`、`permissionMiddleware` 和 `createDomainMiddleware('QuoteConversion')`。请求和响应均通过 Agent schema 层 Zod 校验，并将机构用户、电销用户的权限边界转为既有报价转化 SQL 生成器支持的筛选参数。

## 支持能力

- `business_patrol_diagnosis`：经营巡检。
- `growth_diagnosis`：增长归因。确定性接口为 `POST /api/agent/diagnosis/growth`，输出增长异常、主要维度贡献和下钻建议；禁止输出利润、盈利、亏损或承保利润结论。
- `cost_indicator_diagnosis`：成本指标诊断。
- `quote_conversion_diagnosis`：报价转化诊断。确定性接口为 `POST /api/agent/diagnosis/quote-conversion`，输出转化率概览、漏斗卡点、机构/团队/业务员差异和趋势异常；本阶段仅接入 `quote_conversion.kpi`、`quote_conversion.funnel`、`quote_conversion.drilldown`、`quote_conversion.trend`，不接入 heatmap、price、ranking；禁止输出利润、盈利、亏损或承保利润结论。
- `renewal_tracker_diagnosis`：续保追踪诊断。
- `claims_risk_diagnosis`：赔案风险诊断。
- `customer_flow_diagnosis`：客户流向诊断。

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
