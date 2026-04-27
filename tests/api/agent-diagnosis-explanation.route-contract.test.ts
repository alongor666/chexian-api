import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent diagnosis explanation route contract', () => {
  it('registers /api/agent/explain route constants in server and frontend mirrors', () => {
    const serverRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');

    expect(serverRoutes).toContain('AGENT_EXPLAIN_ROUTES');
    expect(serverRoutes).toContain("DIAGNOSIS: '/diagnosis'");
    expect(frontendRoutes).toContain('AGENT_EXPLAIN_ROUTES');
    expect(frontendRoutes).toContain("DIAGNOSIS: 'agent/explain/diagnosis'");
  });

  it('mounts the route with auth, permission and query limiter boundaries', () => {
    const app = readSource('server/src/app.ts');
    const route = readSource('server/src/agent/routes/agent-explain.ts');

    expect(app).toContain("app.use('/api/agent/explain', queryLimiter);");
    expect(app).toContain("app.use('/api/agent/explain', agentExplainRoutes)");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
  });

  it('validates request and response through Agent explanation Zod schemas', () => {
    const schema = readSource('server/src/agent/schemas/agent-explanation.schema.ts');
    const route = readSource('server/src/agent/routes/agent-explain.ts');

    expect(schema).toContain('AgentDiagnosisExplanationRequestSchema');
    expect(schema).toContain('AgentDiagnosisExplanationResultSchema');
    expect(route).toContain('AgentDiagnosisExplanationRequestSchema.parse(req.body)');
    expect(route).toContain('SuccessResponseSchema(AgentDiagnosisExplanationResultSchema).parse');
  });

  it('uses the LLM adapter only for narrative explanation and does not add SQL execution paths', () => {
    const combined = [
      readSource('server/src/agent/routes/agent-explain.ts'),
      readSource('server/src/agent/services/agent-diagnosis-explanation-service.ts'),
    ].join('\n');

    expect(combined).toContain("from '../../skills/adapters/llm/index.js'");
    expect(combined).toContain('getDefaultLlmProvider');
    expect(combined).toContain('generateNarrative');
    expect(combined).toContain('inspectForSql');
    expect(combined).not.toMatch(/duckdbService|\.query\(|generate[A-Za-z]+Query|rawSql|freeSql|nl2sql|generateSqlWithZhipu/i);
    expect(combined).not.toContain('CURRENT_DATE');
  });

  it('routes user questions through Agent guardrails before explaining', () => {
    const service = readSource('server/src/agent/services/agent-diagnosis-explanation-service.ts');

    expect(service).toContain('routeAgentQuestion');
    expect(service).toContain('unsupportedMetricRegistry');
    expect(service).toContain('agentMetricRegistry');
  });
});
