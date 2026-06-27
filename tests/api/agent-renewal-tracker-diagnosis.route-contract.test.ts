import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent renewal tracker diagnosis route contract', () => {
  it('exposes /api/agent/diagnosis/renewal-tracker in backend and frontend route registries', () => {
    const backend = readSource('server/src/config/api-routes.ts');
    expect(backend).toContain("RENEWAL_TRACKER: '/renewal-tracker'");

    const frontend = readSource('src/shared/api/routes.ts');
    expect(frontend).toContain("RENEWAL_TRACKER: 'agent/diagnosis/renewal-tracker'");
  });

  it('mounts renewal tracker diagnosis on the protected agent diagnosis router', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');

    expect(route).toContain("'/renewal-tracker'");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
    expect(route).toContain("createDomainMiddleware('RenewalTracker')");
    expect(route).toContain("telemarketing_user is not supported for renewal tracker diagnosis");
  });

  it('locks request and response validation to the Agent schema layer', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const schema = readSource('server/src/agent/schemas/agent-diagnosis.schema.ts');

    expect(route).toContain('RenewalTrackerDiagnosisRequestSchema.parse(req.body)');
    expect(route).toContain('SuccessResponseSchema(RenewalTrackerDiagnosisResultSchema).parse');
    expect(schema).toContain('RenewalTrackerDiagnosisRequestSchema');
    expect(schema).toContain('RenewalTrackerDiagnosisResultSchema');
    expect(schema).toContain("z.literal('renewal_tracker_diagnosis')");
  });

  it('scopes the universe metadata query by branch_code (防 branch_admin 元数据跨省串读)', () => {
    const service = readSource('server/src/agent/services/agent-renewal-tracker-diagnosis-service.ts');
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');

    // service：meta 查询必须把分省码下推（不得再裸调 generateRenewalTrackerMetaQuery()）
    expect(service).toContain('generateRenewalTrackerMetaQuery(input.branchCode)');
    expect(service).not.toMatch(/generateRenewalTrackerMetaQuery\(\s*\)/);

    // route：两处 runRenewalTrackerDiagnosis 调用都从已 fail-closed 收窄的局部 permissionFilter 派生 branchCode
    // B326：两个 handler 入口先 requirePermissionFilter(req.permissionFilter)，下游不再裸传 req.permissionFilter
    expect(route).toContain('deriveRenewalBranchCode');
    const branchCodeDerivations = route.match(/branchCode: deriveRenewalBranchCode\(permissionFilter\)/g) ?? [];
    expect(branchCodeDerivations.length).toBe(2);
    expect(route).not.toContain('deriveRenewalBranchCode(req.permissionFilter)');
  });

  it('keeps this PR scoped to current renewal-tracker only', () => {
    const service = readSource('server/src/agent/services/agent-renewal-tracker-diagnosis-service.ts');
    const combined = `${service}\n${readSource('server/src/agent/routes/agent-diagnosis.ts')}`;

    expect(service).toContain('generateRenewalTrackerQuery');
    expect(service).toContain('generateRenewalTrackerMetaQuery');
    expect(combined).not.toMatch(/renewal[-_]?funnel|renewal[-_]?v2/i);
    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(combined).not.toContain('CURRENT_DATE');
  });
});
