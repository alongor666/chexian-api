import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent customer flow diagnosis route contract', () => {
  it('exposes /api/agent/diagnosis/customer-flow in backend and frontend route registries', () => {
    const backend = readSource('server/src/config/api-routes.ts');
    expect(backend).toContain("CUSTOMER_FLOW: '/customer-flow'");

    const frontend = readSource('src/shared/api/routes.ts');
    expect(frontend).toContain("CUSTOMER_FLOW: 'agent/diagnosis/customer-flow'");
  });

  it('mounts customer flow diagnosis on the protected agent diagnosis router', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');

    expect(route).toContain("'/customer-flow'");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
    expect(route).toContain("createDomainMiddleware('CustomerFlow')");
    expect(route).toContain('ensureCustomerFlowDiagnosisAccess(req.user)');
  });

  it('locks request and response validation to the Agent schema layer', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const schema = readSource('server/src/agent/schemas/agent-diagnosis.schema.ts');

    expect(route).toContain('CustomerFlowDiagnosisRequestSchema.parse(req.body)');
    expect(route).toContain('SuccessResponseSchema(CustomerFlowDiagnosisResultSchema).parse');
    expect(schema).toContain('CustomerFlowDiagnosisRequestSchema');
    expect(schema).toContain('CustomerFlowDiagnosisResultSchema');
    expect(schema).toContain("z.literal('customer_flow_diagnosis')");
  });

  it('keeps this PR scoped to deterministic customer-flow tools only', () => {
    const service = readSource('server/src/agent/services/agent-customer-flow-diagnosis-service.ts');
    const combined = `${service}\n${readSource('server/src/agent/routes/agent-diagnosis.ts')}`;

    expect(service).toContain('generateFlowSummaryQuery');
    expect(service).toContain('generateInflowQuery');
    expect(service).toContain('generateOutflowQuery');
    expect(service).toContain('generateFlowTrendQuery');
    expect(service).toContain('generateFlowMetadataQuery');
    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(combined).not.toContain('CURRENT_DATE');
  });
});
