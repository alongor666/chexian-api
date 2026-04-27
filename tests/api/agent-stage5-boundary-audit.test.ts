import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('Agent Stage 5 boundary audit', () => {
  it('documents the Stage 5 minimum LLM explanation contract and runtime boundary', () => {
    const doc = readSource('docs/AGENT_STAGE5_LLM_BOUNDARY_AUDIT.md');

    expect(doc).toContain('POST /api/agent/explain/diagnosis');
    expect(doc).toContain('只解释确定性诊断 API 返回的数据');
    expect(doc).toContain('不生成 SQL');
    expect(doc).toContain('不自创指标');
    expect(doc).toContain('承保利润');
    expect(doc).toContain('forbiddenInterpretations');
    expect(doc).toContain('unsupportedMetricRegistry');
    expect(doc).toContain('routeAgentQuestion');
    expect(doc).toContain('readyForLlm=false');
  });

  it('keeps /api/agent explanation runtime free of SQL execution paths', () => {
    const app = readSource('server/src/app.ts');
    const explanationRuntimeSource = [
      readSource('server/src/agent/routes/agent-explain.ts'),
      readSource('server/src/agent/services/agent-diagnosis-explanation-service.ts'),
      readSource('server/src/agent/schemas/agent-explanation.schema.ts'),
    ].join('\n');
    const existingDiagnosisRuntimeSource = readSource('server/src/agent/services/agent-business-patrol-diagnosis-service.ts');
    const readinessSchema = readSource('server/src/agent/schemas/agent-audit.schema.ts');
    const serverRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');
    const combinedAgentBoundary = [explanationRuntimeSource, serverRoutes, frontendRoutes].join('\n');

    expect(app).toContain("app.use('/api/agent/audit', agentAuditRoutes)");
    expect(app).toContain("app.use('/api/agent/diagnosis', agentDiagnosisRoutes)");
    expect(app).toContain("app.use('/api/agent/explain', queryLimiter);");
    expect(app).toContain("app.use('/api/agent/explain', agentExplainRoutes)");
    expect(existingDiagnosisRuntimeSource).toContain('runBusinessPatrolTasks');
    expect(combinedAgentBoundary).toContain('AGENT_EXPLAIN_ROUTES');
    expect(combinedAgentBoundary).toContain('agent/explain/diagnosis');
    expect(combinedAgentBoundary).not.toMatch(/duckdbService|\.query\(|generate[A-Za-z]+Query|rawSql|freeSql|nl2sql|generateSqlWithZhipu/i);
    expect(readinessSchema).toContain('readyForLlm: z.literal(false)');
  });

  it('distinguishes existing Copilot narrative from Agent Stage 5 explanation', () => {
    const copilotRoute = readSource('server/src/routes/copilot.ts');
    const doc = readSource('docs/AGENT_STAGE5_LLM_BOUNDARY_AUDIT.md');

    expect(copilotRoute).toContain("req.query.includeNarrative === '1'");
    expect(copilotRoute).toContain('NARRATIVE_SYSTEM_PROMPT');
    expect(doc).toContain('/api/copilot/runs/:runId/report?includeNarrative=1');
    expect(doc).toContain('不是 Agent Stage 5 解释层');
  });
});
