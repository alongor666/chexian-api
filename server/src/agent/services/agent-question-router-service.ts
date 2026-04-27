import { agentToolRegistry } from '../tools/tool-registry.js';
import {
  RouteQuestionInputSchema,
  RouteQuestionResultSchema,
  type RouteQuestionInput,
  type RouteQuestionResult,
} from '../schemas/agent-audit.schema.js';

const COST_WARNING = '变动成本率为项目内经营分析口径，不代表完整财务承保利润。';
const MARGIN_WARNING = '边际贡献额仅扣变动成本，不是承保利润、财务利润、净利润或财务盈亏。';
const FORECAST_WARNING = '本问题为经营预测利润情景测算，不是财务报表利润、法定承保利润或审计利润。';

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function toolIdsForCapability(capabilityId: string): string[] {
  return agentToolRegistry
    .filter((tool) => tool.capabilityId === capabilityId && tool.status !== 'blocked')
    .map((tool) => tool.id);
}

function parseResult(result: unknown): RouteQuestionResult {
  return RouteQuestionResultSchema.parse(result);
}

function isForecastQuestion(text: string): boolean {
  return (
    (text.includes('预测') && text.includes('利润')) ||
    includesAny(text, ['终极变动', '终极固定', '终极综合成本率', '情景假设', '盈亏平衡', '成本率敏感性', '边际空间'])
  );
}

export function routeAgentQuestion(input: RouteQuestionInput): RouteQuestionResult {
  const { question } = RouteQuestionInputSchema.parse(input);
  const normalized = question.trim().toLowerCase();

  if (includesAny(normalized, [
    '承保利润',
    '承保盈利',
    '承保亏损',
    '法定承保利润',
    '财务报表利润',
    '财务报表盈亏',
    '财务利润',
    '审计利润',
    '净承保利润',
    '实际承保盈利',
    '实际承保亏损',
  ])) {
    return parseResult({
      blocked: true,
      status: 'unsupported',
      reason: '当前项目数据不支持承保利润、财务利润、法定利润、审计利润或实际承保盈亏分析。',
      replacementSuggestions: ['经营利润预测情景测算', '成本指标诊断：变动成本率、赔付率、费用率、边际贡献额', '增长归因', '报价转化', '续保追踪', '赔案风险'],
    });
  }

  if (includesAny(normalized, ['财务综合成本率', '完整综合成本率', '承保综合成本率'])) {
    return parseResult({
      blocked: true,
      status: 'unsupported',
      reason: '当前项目数据不支持完整财务/精算口径综合成本率。',
      replacementSuggestions: ['使用 variable_cost_ratio、earned_claim_ratio、expense_ratio 做经营分析。'],
    });
  }

  if (isForecastQuestion(normalized)) {
    return parseResult({
      blocked: false,
      status: 'supported',
      matchedCapabilityId: 'forecast_operating_profit_scenario',
      recommendedMetrics: [
        'signed_premium',
        'ultimate_variable_cost_ratio',
        'ultimate_fixed_cost_ratio',
        'ultimate_combined_cost_ratio',
        'forecast_operating_profit_amount',
      ],
      recommendedTools: toolIdsForCapability('forecast_operating_profit_scenario'),
      warnings: [FORECAST_WARNING, '必须展示终极变动成本率、终极固定成本率和已赚率假设。'],
      replacementSuggestions: [],
    });
  }

  if (includesAny(normalized, ['利润额', 'earned_profit_amount'])) {
    return parseResult({
      blocked: true,
      status: 'unsupported',
      reason: 'earned_profit_amount 保持 unsupported，当前 Agent 不输出利润额或财务盈亏排序。',
      replacementSuggestions: ['改问边际贡献额', '改问经营利润预测情景测算', '改问变动成本率、赔付率、费用率'],
    });
  }

  if (includesAny(normalized, ['利润率', '盈利率', '净利润', '经营利润', '利润边际', '财务盈利', '财务亏损', '盈利', '亏损'])) {
    return parseResult({
      blocked: true,
      status: 'unsupported',
      reason: '当前项目数据不支持财务盈亏、利润率或净利润分析。',
      replacementSuggestions: ['经营利润预测情景测算', '成本指标诊断：变动成本率、赔付率、费用率、边际贡献额', '增长归因', '报价转化', '续保追踪', '赔案风险'],
    });
  }

  if (includesAny(normalized, ['综合成本率', '综合费用率', 'comprehensivecost'])) {
    return parseResult({
      blocked: false,
      status: 'caution',
      matchedCapabilityId: 'comprehensive_cost_indicator_review',
      recommendedMetrics: ['comprehensive_cost_ratio', 'variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'],
      recommendedTools: ['cost.comprehensive_cost', 'cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio'],
      warnings: ['综合成本率为模糊提法，只能作为项目已有经营指标审阅，不得解释为承保利润、财务综合成本率或盈亏判断。'],
      replacementSuggestions: ['改问变动成本率', '改问赔付率', '改问费用率', '项目已有 comprehensiveCost 历史指标审阅'],
    });
  }

  if (includesAny(normalized, ['边际贡献', '满期边际贡献额', '预估边际贡献额'])) {
    return parseResult({
      blocked: false,
      status: 'supported',
      matchedCapabilityId: 'cost_indicator_diagnosis',
      recommendedMetrics: ['earned_margin_amount', 'projected_margin_amount', 'variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'],
      recommendedTools: ['cost.comprehensive_cost', 'cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio'],
      warnings: [MARGIN_WARNING],
      replacementSuggestions: [],
    });
  }

  if (includesAny(normalized, ['变动成本', '成本指标', '赔付率', '费用率', '已赚保费', '满期保费', '案均赔款', '出险率'])) {
    return parseResult({
      blocked: false,
      status: 'supported',
      matchedCapabilityId: 'cost_indicator_diagnosis',
      recommendedMetrics: ['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio', 'earned_premium', 'avg_claim_amount', 'earned_loss_frequency'],
      recommendedTools: ['cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio', 'cost.earned_premium'],
      warnings: [COST_WARNING],
      replacementSuggestions: [],
    });
  }

  if (includesAny(normalized, ['增长', '同比', '环比', '保费增长', '增长来自'])) {
    return parseResult({
      blocked: false,
      status: 'supported',
      matchedCapabilityId: 'growth_diagnosis',
      recommendedMetrics: ['signed_premium', 'policy_count', 'growth_rate'],
      recommendedTools: toolIdsForCapability('growth_diagnosis'),
      warnings: [],
      replacementSuggestions: [],
    });
  }

  if (includesAny(normalized, ['报价', '转化', '承保率', '漏斗', '卡在哪里'])) {
    return parseResult({
      blocked: false,
      status: 'supported',
      matchedCapabilityId: 'quote_conversion_diagnosis',
      recommendedMetrics: ['quote_conversion_rate'],
      recommendedTools: toolIdsForCapability('quote_conversion_diagnosis'),
      warnings: [],
      replacementSuggestions: [],
    });
  }

  if (includesAny(normalized, ['续保', '续转保', '到期'])) {
    return parseResult({
      blocked: false,
      status: 'supported',
      matchedCapabilityId: 'renewal_tracker_diagnosis',
      recommendedMetrics: ['renewal_tracker_metrics'],
      recommendedTools: toolIdsForCapability('renewal_tracker_diagnosis'),
      warnings: ['使用 renewal-tracker 当前指标，不使用已下线 renewal funnel/v2。'],
      replacementSuggestions: [],
    });
  }

  if (includesAny(normalized, ['赔案', '理赔', '未决', '出险原因', '赔款'])) {
    return parseResult({
      blocked: false,
      status: 'supported',
      matchedCapabilityId: 'claims_risk_diagnosis',
      recommendedMetrics: ['reported_claims', 'claim_cases', 'avg_claim_amount', 'earned_loss_frequency'],
      recommendedTools: toolIdsForCapability('claims_risk_diagnosis'),
      warnings: ['赔案风险诊断不输出承保利润或财务盈亏。'],
      replacementSuggestions: [],
    });
  }

  if (includesAny(normalized, ['客户流', '流入', '流出', '流失'])) {
    return parseResult({
      blocked: false,
      status: 'supported',
      matchedCapabilityId: 'customer_flow_diagnosis',
      recommendedMetrics: ['customer_inflow', 'customer_outflow', 'customer_flow_trend'],
      recommendedTools: toolIdsForCapability('customer_flow_diagnosis'),
      warnings: [],
      replacementSuggestions: [],
    });
  }

  return parseResult({
    blocked: false,
    status: 'caution',
    warnings: ['当前问题未命中第一阶段确定性路由，请先限定到增长、成本、报价转化、续保追踪、赔案风险或客户流向。'],
    replacementSuggestions: ['增长归因', '成本指标诊断', '报价转化', '续保追踪', '赔案风险', '客户流向'],
  });
}
