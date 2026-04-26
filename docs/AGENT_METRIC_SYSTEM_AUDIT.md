# Agent 指标体系适配审计

## 为什么先做指标审计

Agent 化前必须先回答“能分析什么、只能谨慎解释什么、必须拒绝什么”。当前系统已经有固定 API、字段注册表、指标注册表和 SQL 生成器，如果直接接聊天或让模型自由解释，最容易把经营成本指标误读成财务利润指标。

第一阶段只建立确定性的 Agent 指标体系适配审计框架，不接 LLM，不做聊天窗口，不让模型生成 SQL。

## 复用现有口径

Agent 指标体系复用现有实现：

- 指标唯一事实源：`server/src/config/metric-registry/`
- 成本 SQL 来源：`server/src/sql/cost/cost-ratios.ts`
- 查询能力来源：`server/src/routes/query/*`
- 字段来源：`server/src/config/field-registry/`

Agent 层只做结构化注册、口径说明、能力映射和问题路由，不另造一套指标计算口径。

## 支持级别

- `supported`：可以进入确定性经营诊断。
- `caution`：项目已有指标或专题可审阅，但必须显示口径警示。
- `unsupported`：禁止输出或禁止推断。
- `deprecated`：历史能力或下线路由，不作为新 Agent 能力。

## 第一批 supported 指标

变动成本率是 supported 指标，不得因为禁止承保利润或财务综合成本率而误伤。

成本、赔付、费用类 supported 指标包括：

- `earned_premium`：满期/已赚保费，按项目 SQL 口径解释。
- `reported_claims`：已报告赔款。
- `claim_cases`：赔案件数。
- `avg_claim_amount`：案均赔款。
- `earned_claim_ratio`：满期赔付率。
- `earned_loss_frequency`：满期出险率。
- `expense_ratio`：费用率。
- `variable_cost_ratio`：变动成本率，项目内经营分析口径。

`variable_cost_ratio` 的解释边界：

- 公式按现有 SQL 生成器口径：满期赔付率 + 费用率。
- 不是完整财务综合成本率。
- 不包含完整准备金、再保、税费、固定费用分摊等财务/精算口径。
- 不得据此输出承保利润、利润率、盈利、亏损或机构财务盈亏。

## caution 指标

如果项目存在 `comprehensiveCost` / 综合费用率 / 综合成本相关历史指标，应注册为 `caution`：

- 可以作为项目已有经营指标审阅。
- 可以与赔付率、费用率、变动成本率做口径对照。
- 不得解释为完整财务综合成本率。
- 不得用于承保利润、盈利、亏损判断。

费用发展指标也属于 `caution`：可用于费用趋势和费用压力分析，不得外推为完整费用分摊或利润指标。

底层指标注册表存在某个成本指标，不等于 Agent 可以输出利润、边际贡献或盈亏结论。Agent 层必须逐项登记真实 metric id 的支持级别：

- `comprehensive_expense_ratio`、`combined_cost_amount`、`combined_cost_ratio`、`fixed_cost_amount`、`fixed_cost_ratio`：标记为 `caution`，仅作为历史或扩展经营成本口径审阅，不进入 `cost_indicator_diagnosis` 主路径，不解释为财务综合成本率。
- `earned_profit_amount`、`earned_margin_amount`、`projected_margin_amount`：标记为 `unsupported`，禁止 Agent 输出利润额、边际贡献额、盈利、亏损或财务盈亏结论。

## unsupported 指标

以下指标在第一阶段必须拒绝：

- 承保利润、承保盈利、承保亏损。
- 利润率、盈利率、净利润、边际贡献。
- 财务综合成本率、完整综合成本率、承保综合成本率。
- 财务盈利、财务亏损、盈亏判断。

拒绝的原因是当前项目缺少完整财务收入、准备金、再保、税费、固定费用分摊等口径。可替代分析方向是保费增长、赔案风险、费用率、变动成本率、报价转化、续保追踪。

## 后续路线

1. 阶段 1：指标体系适配审计。
2. 阶段 2：确定性指标诊断工作流。
3. 阶段 3：增长归因、成本指标、报价转化、续保追踪、赔案风险 Agent。
4. 阶段 4：LLM 解释层，只解释工具返回数据，不生成指标。
5. 阶段 5：经营工作台与反馈复盘。
