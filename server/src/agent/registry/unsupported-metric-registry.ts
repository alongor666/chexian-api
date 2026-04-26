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
    blockedTerms: ['利润率', '盈利率', '净利润', '利润额', '边际贡献', '满期边际贡献额', '预估边际贡献额', '盈利', '亏损'],
    reason: '当前项目不是完整财务利润系统，不能输出利润率、边际贡献或财务盈亏判断。',
    replacementSuggestion: '可分析经营指标异常、变动成本率、费用率、赔付率、增长归因。',
  },
  {
    id: 'financial_combined_ratio',
    name: '财务综合成本率',
    blockedTerms: ['财务综合成本率', '完整综合成本率', '承保综合成本率'],
    reason: '当前项目支持项目内成本类经营指标，但不支持完整财务/精算口径综合成本率。',
    replacementSuggestion: '可使用 variable_cost_ratio、earned_claim_ratio、expense_ratio 做经营分析。',
  },
] satisfies UnsupportedMetricDefinition[]);
