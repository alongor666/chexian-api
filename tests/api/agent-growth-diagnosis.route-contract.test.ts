import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent growth diagnosis route contract', () => {
  it('exposes /api/agent/diagnosis/growth in backend and frontend route registries', () => {
    const backend = readSource('server/src/config/api-routes.ts');
    expect(backend).toContain("GROWTH: '/growth'");

    const frontend = readSource('src/shared/api/routes.ts');
    expect(frontend).toContain("GROWTH: 'agent/diagnosis/growth'");
  });

  it('mounts the growth diagnosis endpoint on the protected agent diagnosis router', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');

    expect(route).toContain("'/growth'");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
    expect(route).toContain("createDomainMiddleware('PolicyFact')");
    expect(route).toContain('buildWhereFromFilterParamsWithoutDate');
  });

  it('locks request and response validation to the Agent schema layer', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const schema = readSource('server/src/agent/schemas/agent-diagnosis.schema.ts');

    expect(route).toContain('GrowthDiagnosisRequestSchema.parse(req.body)');
    expect(route).toContain('SuccessResponseSchema(GrowthDiagnosisResultSchema).parse');
    expect(schema).toContain('GrowthDiagnosisRequestSchema');
    expect(schema).toContain('GrowthDiagnosisResultSchema');
    expect(schema).toContain("z.literal('growth_diagnosis')");
  });

  it('does not add LLM, NL2SQL, free SQL, or implicit CURRENT_DATE usage', () => {
    const service = readSource('server/src/agent/services/agent-growth-diagnosis-service.ts');
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const combined = `${service}\n${route}`;

    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(combined).not.toContain('CURRENT_DATE');
  });
});
