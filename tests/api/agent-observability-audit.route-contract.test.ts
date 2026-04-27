import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent observability audit route contract', () => {
  it('registers observability route constants in server and frontend mirrors', () => {
    const serverRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');

    expect(serverRoutes).toContain("OBSERVABILITY: '/observability'");
    expect(frontendRoutes).toContain("OBSERVABILITY: 'agent/audit/observability'");
  });

  it('mounts the observability audit endpoint on the protected agent audit router', () => {
    const app = readSource('server/src/app.ts');
    const route = readSource('server/src/agent/routes/agent-audit.ts');

    expect(app).toContain("app.use('/api/agent/audit', agentAuditRoutes)");
    expect(route).toContain("'/observability'");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
  });

  it('validates the observability response through Agent Zod schemas', () => {
    const schema = readSource('server/src/agent/schemas/agent-audit.schema.ts');
    const route = readSource('server/src/agent/routes/agent-audit.ts');

    expect(schema).toContain('AgentObservabilityAuditSchema');
    expect(schema).toContain('verified_by_caller_smoke_harness');
    expect(schema).toContain('stage_4_8_display_contract_ready');
    expect(schema).toContain('stage_4_9_deterministic_profit_forecast');
    expect(route).toContain('SuccessResponseSchema(AgentObservabilityAuditSchema).parse');
  });

  it('does not add LLM, NL2SQL, raw SQL, or implicit current-date behavior', () => {
    const combined = [
      readSource('server/src/agent/services/agent-adaptation-audit-service.ts'),
      readSource('server/src/agent/routes/agent-audit.ts'),
    ].join('\n');

    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(combined).not.toContain('CURRENT_DATE');
    expect(combined).not.toContain('readFileSync');
  });
});
