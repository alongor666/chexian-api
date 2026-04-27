# Agent 指标语义边界

## 观察层 vs 预测层

观察层指标来自现有 SQL、ETL、字段注册表和指标注册表，例如 `variable_cost_ratio`、`earned_margin_amount`、`projected_margin_amount`。这些指标反映项目内经营分析口径，不是财务报表口径。

预测层输出来自确定性 calculator，例如 `forecast_operating_profit_amount`。预测层必须显式展示调用方输入的终极变动成本率、终极固定成本率和已赚率计划，不自动创造指标、不访问 DuckDB、不生成 SQL、不调用 LLM。

## 边际 vs 利润

`earned_margin_amount` 和 `projected_margin_amount` 是合法 L4 经营指标：

- 满期边际贡献额 = 满期保费 x (1 - 满期赔付率 - 费用率)
- 预估边际贡献额 = 签单保费 x (1 - 满期赔付率 - 费用率)

边际贡献额仅扣除变动成本（赔付+费用），不等于承保利润。承保利润或财务利润还需要固定成本、准备金、再保、税费和财务确认口径，本项目 Agent 不输出该类结论。

`earned_profit_amount` 保持 unsupported，因为它包含固定成本并直接进入利润语义，容易与财务利润、法定承保利润或审计盈亏混淆。

## Stage 5 兼容性

经营利润 forecast calculator 是确定性层能力，不开启 Stage 5 LLM 解释层。Stage 5 仍保持 `readyForLlm=false`，未来如启动 LLM，只能解释确定性工具返回的数据，不能生成 SQL、不能创造指标、不能绕过权限链。

## Follow-up

- `/api/agent/audit/route-question` 当前仍返回裸 route result；响应包装一致性单独处理。
- `profit-by-segment` 分群预测不在本轮实现。
- 前端 Copilot 对接 forecast capability 等 Stage 6 工作台规划。
