import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

function readSourcesUnder(relativePath: string): string {
  const root = path.resolve(process.cwd(), relativePath);
  const sources: string[] = [];

  function walk(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.ts')) {
        const sourcePath = path.relative(process.cwd(), entryPath);
        sources.push(`// ${sourcePath}\n${fs.readFileSync(entryPath, 'utf-8')}`);
      }
    }
  }

  walk(root);
  return sources.sort().join('\n');
}

describe('Agent Stage 5 boundary audit', () => {
  it('documents the Stage 5 minimum LLM explanation contract before implementation', () => {
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

  it('keeps /api/agent routes free of LLM calls and explain endpoints in this audit PR', () => {
    const app = readSource('server/src/app.ts');
    const agentRuntimeSource = readSourcesUnder('server/src/agent');
    const readinessSchema = readSource('server/src/agent/schemas/agent-audit.schema.ts');
    const serverRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');
    const combinedAgentBoundary = [agentRuntimeSource, serverRoutes, frontendRoutes].join('\n');

    expect(app).toContain("app.use('/api/agent/audit', agentAuditRoutes)");
    expect(app).toContain("app.use('/api/agent/diagnosis', agentDiagnosisRoutes)");
    expect(app).not.toContain("app.use('/api/agent/explain'");
    expect(agentRuntimeSource).toContain('server/src/agent/services/agent-business-patrol-diagnosis-service.ts');
    expect(combinedAgentBoundary).not.toMatch(/agent\/explain|AGENT_EXPLAIN_ROUTES|explain\/diagnosis/i);
    expect(combinedAgentBoundary).not.toMatch(/getDefaultLlmProvider|generateNarrative|openrouter|chat\/completions/i);
    expect(combinedAgentBoundary).not.toMatch(/rawSql|freeSql|nl2sql|generateSqlWithZhipu/i);
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
