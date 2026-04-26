import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent quote conversion diagnosis route contract', () => {
  it('exposes /api/agent/diagnosis/quote-conversion in backend and frontend route registries', () => {
    const backend = readSource('server/src/config/api-routes.ts');
    expect(backend).toContain("QUOTE_CONVERSION: '/quote-conversion'");

    const frontend = readSource('src/shared/api/routes.ts');
    expect(frontend).toContain("QUOTE_CONVERSION: 'agent/diagnosis/quote-conversion'");
  });

  it('mounts quote conversion diagnosis on the protected agent diagnosis router', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');

    expect(route).toContain("'/quote-conversion'");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
    expect(route).toContain("createDomainMiddleware('QuoteConversion')");
  });

  it('locks request and response validation to the Agent schema layer', () => {
    const route = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const schema = readSource('server/src/agent/schemas/agent-diagnosis.schema.ts');

    expect(route).toContain('QuoteConversionDiagnosisRequestSchema.parse(req.body)');
    expect(route).toContain('SuccessResponseSchema(QuoteConversionDiagnosisResultSchema).parse');
    expect(schema).toContain('QuoteConversionDiagnosisRequestSchema');
    expect(schema).toContain('QuoteConversionDiagnosisResultSchema');
    expect(schema).toContain("z.literal('quote_conversion_diagnosis')");
  });

  it('keeps this PR scoped to kpi/funnel/drilldown/trend only', () => {
    const service = readSource('server/src/agent/services/agent-quote-conversion-diagnosis-service.ts');
    const combined = `${service}\n${readSource('server/src/agent/routes/agent-diagnosis.ts')}`;

    expect(service).toContain('generateQuoteKpiQuery');
    expect(service).toContain('generateQuoteFunnelQuery');
    expect(service).toContain('generateQuoteDrilldownQuery');
    expect(service).toContain('generateQuoteTrendQuery');
    expect(service).not.toContain('generateQuoteHeatmapQuery');
    expect(service).not.toContain('generateQuotePriceQuery');
    expect(service).not.toContain('generateQuoteRankingQuery');
    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(combined).not.toContain('CURRENT_DATE');
  });
});
