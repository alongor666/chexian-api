import { AgentMetricDefinitionSchema } from '../schemas/agent-metric.schema.js';

export const agentForecastOutputRegistry = AgentMetricDefinitionSchema.array().parse([
  {
    id: 'forecast_operating_profit_amount',
    name: '预测经营利润',
    aliases: ['预测利润', '经营利润预测', '预测经营利润额', 'forecast_operating_profit_amount'],
    category: 'cost',
    supportLevel: 'supported',
    businessDefinition: '基于调用方提供的终极变动成本率、终极固定成本率和已赚率计划做确定性情景计算的经营预测输出。',
    formula: '签单保费 × (100% - 终极变动成本率 - 终极固定成本率)',
    sourceMetrics: [
      'signed_premium',
      'ultimate_variable_cost_ratio',
      'ultimate_fixed_cost_ratio',
      'earning_schedule',
    ],
    sourceEndpoints: ['/api/agent/forecast/profit-scenario'],
    sourceRoutes: ['server/src/agent/routes/agent-forecast.ts'],
    sourceSqlGenerators: [],
    requiredParams: [
      'premium',
      'ultimateVariableCostRatio',
      'ultimateFixedCostRatio',
      'earningSchedule',
    ],
    supportedDimensions: [],
    supportedUseCases: ['forecast_operating_profit_scenario'],
    cautionNotes: ['基于调用方假设的情景计算，不是财务报表利润。'],
    forbiddenInterpretations: ['财务报表利润', '法定承保利润', '审计利润', '承保利润'],
    metricKind: 'forecast_output',
    metricNature: 'forecast_output',
    forecastRole: 'output',
    requiresAssumptions: true,
    actualFinancialInterpretation: 'forbidden',
  },
]);
