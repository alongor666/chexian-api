import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

import { getAgentMetricAudit } from '../../server/src/agent/services/agent-metric-audit-service';
import { getUnsupportedMetricAudit } from '../../server/src/agent/services/agent-adaptation-audit-service';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent metric audit registry', () => {
  it('returns variable_cost_ratio as a supported metric', () => {
    const audit = getAgentMetricAudit();
    const metric = audit.metrics.find((item) => item.id === 'variable_cost_ratio');

    expect(metric).toBeDefined();
    expect(metric?.name).toBe('变动成本率');
    expect(metric?.category).toBe('cost');
    expect(metric?.supportLevel).toBe('supported');
    expect(metric?.sourceEndpoints).toContain('/api/query/cost');
    expect(metric?.sourceSqlGenerators).toContain('generateVariableCostQuery');
  });

  it('keeps variable_cost_ratio forbidden interpretations focused on profit and financial conclusions', () => {
    const audit = getAgentMetricAudit();
    const metric = audit.metrics.find((item) => item.id === 'variable_cost_ratio');

    expect(metric?.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['承保利润', '利润率', '盈利', '亏损'])
    );
    expect(metric?.cautionNotes.join('')).toContain('不代表完整财务综合成本率');
  });

  it('does not classify variable_cost_ratio as unsupported', () => {
    const unsupported = getUnsupportedMetricAudit();

    expect(unsupported.metrics.map((item) => item.id)).toEqual(
      expect.not.arrayContaining(['variable_cost_ratio'])
    );
    expect(unsupported.metrics.map((item) => item.id)).toEqual(
      expect.arrayContaining(['underwriting_profit', 'profit_margin', 'financial_combined_ratio'])
    );
  });

  it('mounts agent audit routes without changing the query route permission chain', () => {
    const app = readSource('server/src/app.ts');
    const queryRouter = readSource('server/src/routes/query.ts');
    const agentRoute = readSource('server/src/agent/routes/agent-audit.ts');

    expect(app).toContain("app.use('/api/agent/audit', agentAuditRoutes)");
    expect(queryRouter).toContain('router.use(authMiddleware);');
    expect(queryRouter).toContain('router.use(permissionMiddleware);');
    expect(agentRoute).toContain('router.use(authMiddleware);');
    expect(agentRoute).toContain('router.use(permissionMiddleware);');
  });

  it('does not add LLM calls or free SQL execution in the agent audit layer', () => {
    const agentFiles = [
      'server/src/agent/registry/agent-metric-registry.ts',
      'server/src/agent/registry/agent-data-capability-registry.ts',
      'server/src/agent/registry/unsupported-metric-registry.ts',
      'server/src/agent/registry/metric-capability-mapping.ts',
      'server/src/agent/tools/tool-registry.ts',
      'server/src/agent/services/agent-question-router-service.ts',
      'server/src/agent/services/agent-metric-audit-service.ts',
      'server/src/agent/services/agent-adaptation-audit-service.ts',
    ].map(readSource).join('\n');

    expect(agentFiles).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(agentFiles).not.toMatch(/duckdbService\.query|generate.*SQL|rawSql|sql\s*:/i);
  });
});
