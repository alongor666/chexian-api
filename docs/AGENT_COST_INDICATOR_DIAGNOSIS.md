# Agent 成本指标确定性诊断

## 范围

Stage 2 新增 `cost_indicator_diagnosis` 确定性工作流，对外暴露：

- `POST /api/agent/diagnosis/cost-indicators`

该接口不接 LLM，不生成自由 SQL，只调用现有成本 SQL 生成器：

- `generateVariableCostQuery`
- `generateClaimRatioQuery`
- `generateExpenseRatioQuery`

## 输入

请求体经过 Zod 校验：

- `cutoffDate`：必填，`YYYY-MM-DD`。
- `dimension`：默认 `org_level_3`，支持 `customer_category`、`org_level_3`、`coverage_combination`、`org_customer`、`org_coverage`。
- `limit`：默认 `10`，最大 `50`。
- `minPremium`：默认 `0`。
- `filters`：复用现有 `commonFilterSchema`。

路由继续使用 `authMiddleware`、`permissionMiddleware`、`auditMiddleware`，并通过 `createDomainMiddleware('ClaimsAgg')` 进入赔付域权限边界。

## 输出

响应结构经过 `CostIndicatorDiagnosisResultSchema` 校验，核心内容包括：

- `capabilityId = cost_indicator_diagnosis`
- 推荐工具：`cost.variable_cost`、`cost.claim_ratio`、`cost.expense_ratio`
- 异常维度排序：按 `variable_cost_ratio` 从高到低
- 风险等级：`critical`、`warning`、`observe`、`normal`
- 驱动拆解：赔付驱动、费用驱动、均衡或未知
- 下钻建议：机构、客户类别、险别组合等确定性维度

## 口径边界

本工作流分析项目内经营成本指标，不是完整财务承保利润分析。

- `variable_cost_ratio` 是项目内经营分析口径，不代表完整财务综合成本率。
- 不输出承保利润、利润率、财务盈利、财务亏损。
- 不把 cost 模块中的指标解释为机构盈利或亏损。
- 如用户需要财务综合成本率，应回到 Stage 1 的 unsupported/caution 路由提示。
