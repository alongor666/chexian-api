import type { UnsupportedMetricDefinition } from '../schemas/agent-audit.schema.js';
import { UnsupportedMetricDefinitionSchema } from '../schemas/agent-audit.schema.js';

export const unsupportedMetricRegistry = UnsupportedMetricDefinitionSchema.array().parse([
  {
    id: 'underwriting_profit',
    name: '承保利润',
    blockedTerms: ['承保利润', '承保盈利', '承保亏损'],
    reason: '当前项目缺少完整财务收入、准备金、再保、税费、固定费用分摊等口径，不能输出承保利润结论。',
    replacementSuggestion: '可分析保费增长、赔案风险、费用率、变动成本率、报价转化、续保追踪。',
  },
  {
    id: 'profit_margin',
    name: '利润率',
    blockedTerms: ['利润率', '盈利率', '净利润', '盈利', '亏损'],
    reason: '当前项目不是完整财务利润系统，不能输出利润率、净利润或财务盈亏判断。',
    replacementSuggestion: '可分析经营指标异常、变动成本率、边际贡献额、费用率、赔付率、增长归因。',
  },
  {
    id: 'financial_statement_profit',
    name: '财务报表利润',
    blockedTerms: ['财务报表利润', '财务报表盈亏', '法定承保利润', '审计利润'],
    reason: '当前项目不是完整财务/审计/法定报表系统。',
    replacementSuggestion: '可分析经营变动成本率、边际贡献额、forecast 经营利润情景。',
  },
  {
    id: 'unqualified_actual_profit_or_loss',
    name: '实际承保盈亏',
    blockedTerms: ['实际承保盈利', '实际承保亏损', '实际盈利', '实际亏损'],
    reason: '"实际"一词暗示已确认的财务结论，当前项目无此口径。',
    replacementSuggestion: '请改问 forecast 经营利润情景或边际贡献额。',
  },
  {
    id: 'financial_combined_ratio',
    name: '财务综合成本率',
    blockedTerms: ['财务综合成本率', '完整综合成本率', '承保综合成本率'],
    reason: '当前项目支持项目内成本类经营指标，但不支持完整财务/精算口径综合成本率。',
    replacementSuggestion: '可使用 variable_cost_ratio、earned_claim_ratio、expense_ratio 做经营分析。',
  },
] satisfies UnsupportedMetricDefinition[]);
