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
    const forecastRuntimeSource = readSource('server/src/agent/services/agent-profit-forecast-service.ts');

    expect(app).toContain("app.use('/api/agent/audit', agentAuditRoutes)");
    expect(app).toContain("app.use('/api/agent/diagnosis', agentDiagnosisRoutes)");
    expect(app).toContain("app.use('/api/agent/explain', queryLimiter);");
    expect(app).toContain("app.use('/api/agent/explain', agentExplainRoutes)");
    expect(app).toContain("app.use('/api/agent/forecast', queryLimiter);");
    expect(app).toContain("app.use('/api/agent/forecast', agentForecastRoutes)");
    expect(existingDiagnosisRuntimeSource).toContain('runBusinessPatrolTasks');
    expect(combinedAgentBoundary).toContain('AGENT_EXPLAIN_ROUTES');
    expect(combinedAgentBoundary).toContain('agent/explain/diagnosis');
    expect(combinedAgentBoundary).toContain('AGENT_FORECAST_ROUTES');
    expect(combinedAgentBoundary).toContain('agent/forecast/profit-scenario');
    expect(combinedAgentBoundary).not.toMatch(/duckdbService|\.query\(|generate[A-Za-z]+Query|rawSql|freeSql|nl2sql|generateSqlWithZhipu/i);
    expect(forecastRuntimeSource).not.toMatch(/duckdb|rawSql|freeSql|nl2sql|SELECT |select /i);
    expect(readinessSchema).toContain('readyForLlm: z.literal(false)');
  });

  it('keeps forecast as a deterministic capability instead of an LLM entrypoint', () => {
    const capabilityRegistry = readSource('server/src/agent/registry/agent-data-capability-registry.ts');
    const forecastService = readSource('server/src/agent/services/agent-profit-forecast-service.ts');
    const readinessSchema = readSource('server/src/agent/schemas/agent-audit.schema.ts');

    expect(capabilityRegistry).toContain('forecast_operating_profit_scenario');
    expect(capabilityRegistry).toContain('forecast_operating_profit_segment');
    expect(forecastService).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(forecastService).not.toMatch(/duckdb|rawSql|freeSql|nl2sql/i);
    expect(readinessSchema).toContain('readyForLlm: z.literal(false)');
  });

  it('keeps the profit-segment capability deterministic, role-gated, and SQL-free', () => {
    const route = readSource('server/src/agent/routes/agent-forecast.ts');
    const service = readSource('server/src/agent/services/agent-profit-forecast-service.ts');
    const schema = readSource('server/src/agent/schemas/agent-forecast.schema.ts');

    expect(route).toContain('UserRole.BRANCH_ADMIN');
    expect(route).toContain("'/profit-segment'");
    expect(service).toContain('calculateProfitSegment');
    expect(service).not.toMatch(/duckdb|rawSql|freeSql|nl2sql|fetch\s*\(/i);
    expect(schema).toContain('SegmentDimensionSchema');
    expect(schema).not.toMatch(/duckdb|rawSql|freeSql|nl2sql/i);
  });

  it('keeps the forecast-baseline capability deterministic and free of LLM/NL2SQL paths', () => {
    const route = readSource('server/src/agent/routes/agent-forecast.ts');
    const service = readSource('server/src/agent/services/agent-forecast-baseline-service.ts');
    const sql = readSource('server/src/sql/forecast/baseline.ts');
    const schema = readSource('server/src/agent/schemas/agent-forecast-baseline.schema.ts');

    expect(route).toContain("'/baseline'");
    expect(service).toContain('buildForecastBaseline');
    expect(sql).toContain('generateBaselineActualQuery');
    expect(sql).toContain('generateHistoricalLossRatioQuery');
    expect(sql).toContain('generateYoYGrowthQuery');
    expect(sql).toContain('generateRecentExpenseRatioQuery');
    // Deterministic only — no free-form SQL, no LLM clients, no current-date fallback
    const combined = [route, service, schema].join('\n');
    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toContain('CURRENT_DATE');
    expect(schema).toContain('ForecastBaselineRequestSchema');
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
