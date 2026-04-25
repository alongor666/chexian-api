import { describe, expect, it } from 'vitest';

import { getAgentCapabilityAudit } from '../../server/src/agent/services/agent-adaptation-audit-service';
import { routeAgentQuestion } from '../../server/src/agent/services/agent-question-router-service';

describe('agent adaptation audit routing', () => {
  it('returns cost_indicator_diagnosis in capability audit', () => {
    const audit = getAgentCapabilityAudit();

    expect(audit.capabilities.map((item) => item.id)).toContain('cost_indicator_diagnosis');
    expect(audit.capabilities.find((item) => item.id === 'cost_indicator_diagnosis')?.supportLevel)
      .toBe('supported');
  });

  it('routes variable cost questions to cost indicator diagnosis', () => {
    const result = routeAgentQuestion({ question: '变动成本率为什么升高？' });

    expect(result.blocked).toBe(false);
    expect(result.status).toBe('supported');
    expect(result.matchedCapabilityId).toBe('cost_indicator_diagnosis');
    expect(result.recommendedMetrics).toEqual(
      expect.arrayContaining(['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'])
    );
    expect(result.recommendedTools).toEqual(
      expect.arrayContaining(['cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio'])
    );
  });

  it('blocks underwriting profit questions', () => {
    const result = routeAgentQuestion({ question: '承保利润怎么样？' });

    expect(result.blocked).toBe(true);
    expect(result.status).toBe('unsupported');
    expect(result.reason).toContain('不支持承保利润');
  });

  it('blocks financial loss questions', () => {
    const result = routeAgentQuestion({ question: '哪个机构亏损？' });

    expect(result.blocked).toBe(true);
    expect(result.status).toBe('unsupported');
    expect(result.reason).toContain('财务盈亏');
  });

  it('routes generic cost indicator anomaly questions without blocking variable cost ratio', () => {
    const result = routeAgentQuestion({ question: '哪个机构成本指标异常？' });

    expect(result.blocked).toBe(false);
    expect(result.matchedCapabilityId).toBe('cost_indicator_diagnosis');
    expect(result.recommendedMetrics).toEqual(
      expect.arrayContaining(['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'])
    );
  });

  it('returns caution for ambiguous comprehensive cost ratio questions', () => {
    const result = routeAgentQuestion({ question: '哪个机构综合成本率最高？' });

    expect(result.blocked).toBe(false);
    expect(result.status).toBe('caution');
    expect(result.warnings.join('')).toContain('不得解释为承保利润');
    expect(result.replacementSuggestions).toEqual(
      expect.arrayContaining(['改问变动成本率', '改问赔付率', '改问费用率'])
    );
  });

  it('routes common business questions to existing capabilities', () => {
    expect(routeAgentQuestion({ question: '本月保费增长来自哪里？' }).matchedCapabilityId)
      .toBe('growth_diagnosis');
    expect(routeAgentQuestion({ question: '报价转化卡在哪里？' }).matchedCapabilityId)
      .toBe('quote_conversion_diagnosis');
    expect(routeAgentQuestion({ question: '续保情况怎么样？' }).matchedCapabilityId)
      .toBe('renewal_tracker_diagnosis');
  });
});
