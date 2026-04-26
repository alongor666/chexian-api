import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent claims risk diagnosis route contract', () => {
  it('exposes /api/agent/diagnosis/claims-risk in backend and frontend route registries', () => {
    const backend = readSource('server/src/config/api-routes.ts');
    expect(backend).toContain("CLAIMS_RISK: '/claims-risk'");

    const frontend = readSource('src/shared/api/routes.ts');
    expect(frontend).toContain("CLAIMS_RISK: 'agent/diagnosis/claims-risk'");
  });

  it('mounts claims risk diagnosis on the protected agent diagnosis router', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');

    expect(route).toContain("'/claims-risk'");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
    expect(route).toContain("createDomainMiddleware('ClaimsDetail', 'ClaimsAgg')");
  });

  it('locks request and response validation to the Agent schema layer', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const schema = readSource('server/src/agent/schemas/agent-diagnosis.schema.ts');

    expect(route).toContain('ClaimsRiskDiagnosisRequestSchema.parse(req.body)');
    expect(route).toContain('SuccessResponseSchema(ClaimsRiskDiagnosisResultSchema).parse');
    expect(schema).toContain('ClaimsRiskDiagnosisRequestSchema');
    expect(schema).toContain('ClaimsRiskDiagnosisResultSchema');
    expect(schema).toContain("z.literal('claims_risk_diagnosis')");
  });

  it('keeps this PR scoped to pending overview, cause analysis, and frequency yoy only', () => {
    const service = readSource('server/src/agent/services/agent-claims-risk-diagnosis-service.ts');
    const combined = `${service}\n${readSource('server/src/agent/routes/agent-diagnosis.ts')}`;

    expect(service).toContain('generatePendingOverviewQuery');
    expect(service).toContain('generateCauseAnalysisQuery');
    expect(service).toContain('generateFrequencyYoyQuery');
    expect(service).not.toContain('generatePendingByOrgQuery');
    expect(service).not.toContain('generatePendingAgingQuery');
    expect(service).not.toContain('generateGeoRiskByAccidentQuery');
    expect(service).not.toContain('generateGeoRiskByPlateQuery');
    expect(service).not.toContain('generateGeoComparisonQuery');
    expect(service).not.toContain('generateClaimCycleQuery');
    expect(service).not.toContain('generateLossRatioDevelopmentQuery');
    expect(service).not.toContain('generateClaimsHeatmapQuery');
    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(combined).not.toContain('CURRENT_DATE');
  });
});
