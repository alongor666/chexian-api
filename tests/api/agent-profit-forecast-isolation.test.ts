import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent profit forecast isolation', () => {
  it('keeps forecast service and route free from LLM, DuckDB, fetch, and SQL execution', () => {
    const source = [
      readSource('server/src/agent/services/agent-profit-forecast-service.ts'),
      readSource('server/src/agent/routes/agent-forecast.ts'),
    ].join('\n');

    expect(source).not.toMatch(/duckdb/i);
    expect(source).not.toMatch(/@anthropic|openai|chatCompletion|completion\.create/i);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bSELECT\b|\bselect\b/);
    expect(source).not.toMatch(/rawSql|freeSql|nl2sql/i);
  });
});
