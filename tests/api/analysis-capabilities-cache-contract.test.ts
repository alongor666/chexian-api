import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('analysis capabilities cache contract', () => {
  it('uses response-body ETag instead of ETL-version route cache', () => {
    const source = readFileSync(resolve('server/src/routes/discover.ts'), 'utf8');
    const start = source.indexOf("'/analysis-capabilities'");
    const end = source.indexOf("'/schema'", start);
    const block = source.slice(start, end);
    expect(block).toContain('sendWithEtag(req, res, body');
    expect(block).not.toContain('withRouteCache(');
  });
});
