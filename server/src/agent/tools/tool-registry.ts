import { z } from 'zod';

const AgentToolStatusSchema = z.enum(['available', 'caution', 'blocked']);

const AgentToolDefinitionSchema = z.object({
  id: z.string().min(1),
  status: AgentToolStatusSchema,
  endpoint: z.string().optional(),
  params: z.record(z.string(), z.string()).default({}),
  capabilityId: z.string().optional(),
  metrics: z.array(z.string()).default([]),
  blockedInterpretations: z.array(z.string()).default([]),
  allowedInterpretations: z.array(z.string()).default([]),
  note: z.string().optional(),
});

export type AgentToolDefinition = z.infer<typeof AgentToolDefinitionSchema>;

export const agentToolRegistry = AgentToolDefinitionSchema.array().parse([
  { id: 'business_patrol.query', status: 'available', endpoint: '/api/agent/diagnosis/business-patrol', capabilityId: 'business_patrol_diagnosis', metrics: ['signed_premium', 'growth_rate', 'variable_cost_ratio', 'quote_conversion_rate', 'renewal_tracker_metrics', 'reported_claims', 'customer_flow_trend'] },
  { id: 'cost.claim_ratio', status: 'available', endpoint: '/api/query/cost', params: { analysisType: 'claimRatio' }, capabilityId: 'cost_indicator_diagnosis', metrics: ['earned_claim_ratio', 'earned_loss_frequency', 'avg_claim_amount'] },
  { id: 'cost.expense_ratio', status: 'available', endpoint: '/api/query/cost', params: { analysisType: 'expenseRatio' }, capabilityId: 'cost_indicator_diagnosis', metrics: ['expense_ratio'] },
  { id: 'cost.variable_cost', status: 'available', endpoint: '/api/query/cost', params: { analysisType: 'variableCost' }, capabilityId: 'cost_indicator_diagnosis', metrics: ['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'] },
  { id: 'cost.earned_premium', status: 'available', endpoint: '/api/query/cost', params: { type: 'earned' }, capabilityId: 'cost_indicator_diagnosis', metrics: ['earned_premium'] },
  { id: 'forecast.profit_scenario', status: 'available', endpoint: '/api/agent/forecast/profit-scenario', capabilityId: 'forecast_operating_profit_scenario', metrics: ['forecast_operating_profit_amount'] },
  { id: 'forecast.profit_segment', status: 'available', endpoint: '/api/agent/forecast/profit-segment', capabilityId: 'forecast_operating_profit_segment', metrics: ['forecast_operating_profit_by_segment', 'forecast_operating_profit_amount'] },
  { id: 'forecast.baseline', status: 'available', endpoint: '/api/agent/forecast/baseline', capabilityId: 'forecast_baseline', metrics: ['signed_premium', 'earned_premium', 'reported_claims', 'expense_ratio', 'earned_claim_ratio'] },
  { id: 'growth.query', status: 'available', endpoint: '/api/query/growth', capabilityId: 'growth_diagnosis', metrics: ['signed_premium', 'policy_count', 'growth_rate'] },
  { id: 'growth.daily_context', status: 'available', endpoint: '/api/query/growth', params: { type: 'daily-context' }, capabilityId: 'growth_diagnosis', metrics: ['signed_premium', 'growth_rate'] },
  { id: 'quote_conversion.kpi', status: 'available', endpoint: '/api/query/quote-conversion/kpi', capabilityId: 'quote_conversion_diagnosis', metrics: ['quote_conversion_rate'] },
  { id: 'quote_conversion.funnel', status: 'available', endpoint: '/api/query/quote-conversion/funnel', capabilityId: 'quote_conversion_diagnosis', metrics: ['quote_conversion_rate'] },
  { id: 'quote_conversion.drilldown', status: 'available', endpoint: '/api/query/quote-conversion/drilldown', capabilityId: 'quote_conversion_diagnosis', metrics: ['quote_conversion_rate'] },
  { id: 'quote_conversion.trend', status: 'available', endpoint: '/api/query/quote-conversion/trend', capabilityId: 'quote_conversion_diagnosis', metrics: ['quote_conversion_rate'] },
  { id: 'renewal_tracker.query', status: 'available', endpoint: '/api/query/renewal-tracker', capabilityId: 'renewal_tracker_diagnosis', metrics: ['renewal_tracker_metrics'] },
  { id: 'claims_detail.pending_overview', status: 'available', endpoint: '/api/query/claims-detail/pending-overview', capabilityId: 'claims_risk_diagnosis', metrics: ['reported_claims', 'claim_cases'] },
  { id: 'claims_detail.cause_analysis', status: 'available', endpoint: '/api/query/claims-detail/cause-analysis', capabilityId: 'claims_risk_diagnosis', metrics: ['reported_claims', 'claim_cases'] },
  { id: 'claims_detail.frequency_yoy', status: 'available', endpoint: '/api/query/claims-detail/frequency-yoy', capabilityId: 'claims_risk_diagnosis', metrics: ['earned_loss_frequency', 'claim_cases'] },
  { id: 'customer_flow.summary', status: 'available', endpoint: '/api/query/customer-flow/summary', capabilityId: 'customer_flow_diagnosis', metrics: ['customer_outflow'] },
  { id: 'customer_flow.inflow', status: 'blocked', endpoint: '/api/query/customer-flow/inflow', capabilityId: 'customer_flow_diagnosis', metrics: ['customer_inflow'], note: '当前 customer_flow 源已移除转入字段，不能把转入解释为 0。' },
  { id: 'customer_flow.outflow', status: 'available', endpoint: '/api/query/customer-flow/outflow', capabilityId: 'customer_flow_diagnosis', metrics: ['customer_outflow'] },
  { id: 'customer_flow.trend', status: 'available', endpoint: '/api/query/customer-flow/trend', capabilityId: 'customer_flow_diagnosis', metrics: ['customer_flow_trend'] },
  { id: 'customer_flow.metadata', status: 'available', endpoint: '/api/query/customer-flow/metadata', capabilityId: 'customer_flow_diagnosis', metrics: [] },
  {
    id: 'cost.comprehensive_cost',
    status: 'caution',
    endpoint: '/api/query/cost',
    params: { analysisType: 'comprehensiveCost' },
    capabilityId: 'comprehensive_cost_indicator_review',
    metrics: ['comprehensive_expense_ratio', 'earned_claim_ratio', 'expense_ratio', 'variable_cost_ratio'],
    blockedInterpretations: ['承保利润', '财务综合成本率', '盈亏判断'],
    allowedInterpretations: ['项目已有综合费用/综合成本类经营指标审阅', '与赔付率、费用率、变动成本率进行口径对照'],
    note: '必须显示口径警示。',
  },
  { id: 'underwriting_profit.query', status: 'blocked', metrics: ['underwriting_profit'] },
  { id: 'profit_margin.query', status: 'blocked', metrics: ['profit_margin'] },
  { id: 'financial_combined_ratio.query', status: 'blocked', metrics: ['financial_combined_ratio'] },
]);
