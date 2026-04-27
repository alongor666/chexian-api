# Agent 经营利润预测情景

## API

`POST /api/agent/forecast/profit-scenario`

该接口是确定性 calculator，不访问 DuckDB，不生成 SQL，不调用 LLM。调用方必须显式传入终极变动成本率、终极固定成本率和已赚率计划。

## 公式

- 终极综合成本率 = 终极变动成本率 + 终极固定成本率
- 预测经营利润率 = 100% - 终极综合成本率
- 当期预测经营利润 = 签单保费 x 当期已赚率 x 预测经营利润率
- 全周期预测经营利润 = 签单保费 x 预测经营利润率
- 成本率 1pct 敏感性 = 签单保费 x 当期已赚率 x 1%

## 示例

输入：

```json
{
  "premium": 20000000,
  "ultimateVariableCostRatio": 85,
  "ultimateFixedCostRatio": 9,
  "earningSchedule": [
    { "period": "2026", "earnedRatio": 52 },
    { "period": "2027", "earnedRatio": 48 }
  ],
  "scenarioName": "test",
  "assumptionSource": "caller_provided"
}
```

输出关键数字：

- 终极综合成本率：94%
- 预测经营利润率：6%
- 2026 预测经营利润：624000
- 2027 预测经营利润：576000
- 全周期预测经营利润：1200000

## 禁止解释

- 不得把预测经营利润说成财务报表利润。
- 不得把预测经营利润说成法定承保利润。
- 不得把预测经营利润说成审计利润。
- 不得隐藏终极成本率和已赚率假设。
