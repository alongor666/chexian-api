import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent cost indicator diagnosis route contract', () => {
  it('registers route constants in server and frontend mirrors', () => {
    const serverRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');

    expect(serverRoutes).toContain("COST_INDICATORS: '/cost-indicators'");
    expect(frontendRoutes).toContain("COST_INDICATORS: 'agent/diagnosis/cost-indicators'");
  });

  it('keeps auth, permission, limiter, and ClaimsAgg lazy domain boundaries', () => {
    const app = readSource('server/src/app.ts');
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');

    expect(app).toContain("app.use('/api/agent/diagnosis', queryLimiter);");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
    expect(route).toContain("createDomainMiddleware('ClaimsAgg')");
  });

  it('validates request and response through Agent Zod schemas', () => {
    const schema = readSource('server/src/agent/schemas/agent-diagnosis.schema.ts');
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');

    expect(schema).toContain('CostIndicatorDiagnosisRequestSchema');
    expect(schema).toContain('CostIndicatorDiagnosisResultSchema');
    expect(route).toContain('CostIndicatorDiagnosisRequestSchema.parse(req.body)');
    expect(route).toContain('SuccessResponseSchema(CostIndicatorDiagnosisResultSchema).parse');
  });

  it('does not add LLM, NL2SQL, raw SQL, or implicit current-date behavior', () => {
    const combined = [
      readSource('server/src/agent/services/agent-cost-indicator-diagnosis-service.ts'),
      readSource('server/src/agent/routes/agent-diagnosis.ts'),
    ].join('\n');

    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(combined).not.toContain('CURRENT_DATE');
  });
});
