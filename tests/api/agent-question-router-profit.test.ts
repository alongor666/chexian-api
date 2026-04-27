import { describe, expect, it } from 'vitest';

import { routeAgentQuestion } from '../../server/src/agent/services/agent-question-router-service';

describe('agent profit and margin question routing', () => {
  it('keeps variable cost questions on the cost diagnosis path', () => {
    const result = routeAgentQuestion({ question: '变动成本率为什么升高？' });

    expect(result.blocked).toBe(false);
    expect(result.status).toBe('supported');
    expect(result.matchedCapabilityId).toBe('cost_indicator_diagnosis');
  });

  it('routes deterministic operating profit scenario questions to forecast capability', () => {
    for (const question of [
      '按终极变动85%、固定9%、保费2000万、已赚52/48预测利润',
      '终极综合成本率怎么算？',
    ]) {
      const result = routeAgentQuestion({ question });

      expect(result.blocked).toBe(false);
      expect(result.status).toBe('supported');
      expect(result.matchedCapabilityId).toBe('forecast_operating_profit_scenario');
      expect(result.recommendedTools).toContain('forecast.profit_scenario');
      expect(result.warnings.join('')).toContain('不是财务报表利润');
    }
  });

  it('blocks actual and financial profit or loss questions', () => {
    for (const question of ['哪个机构实际亏损？', '哪个机构承保利润最低？', '财务报表利润多少？', '经营利润边际多少？', '哪个机构利润额最高？']) {
      const result = routeAgentQuestion({ question });

      expect(result.blocked).toBe(true);
      expect(result.status).toBe('unsupported');
    }
  });

  it('keeps ambiguous combined cost ratio as caution', () => {
    const result = routeAgentQuestion({ question: '哪个机构综合成本率最高？' });

    expect(result.blocked).toBe(false);
    expect(result.status).toBe('caution');
    expect(result.matchedCapabilityId).toBe('comprehensive_cost_indicator_review');
  });

  it('routes margin contribution questions to cost diagnosis with margin warning', () => {
    const result = routeAgentQuestion({ question: '边际贡献是多少？' });

    expect(result.blocked).toBe(false);
    expect(result.status).toBe('supported');
    expect(result.matchedCapabilityId).toBe('cost_indicator_diagnosis');
    expect(result.recommendedMetrics).toEqual(
      expect.arrayContaining(['earned_margin_amount', 'projected_margin_amount'])
    );
    expect(result.warnings.join('')).toContain('边际贡献额仅扣变动成本');
  });
});
