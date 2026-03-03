import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('cross-sell maxDate route contract', () => {
  it('uses CrossSellDailyAgg as maxDate source for cross-sell summary and bundle', () => {
    const queryRoutePath = path.resolve(process.cwd(), 'server/src/routes/query.ts');
    const content = fs.readFileSync(queryRoutePath, 'utf-8');

    const maxDateSqlBlocks = content.match(/const maxDateSql = `[\s\S]*?`;/g) ?? [];
    expect(maxDateSqlBlocks.length).toBeGreaterThanOrEqual(2);

    const [summaryBlock, bundleBlock] = maxDateSqlBlocks;
    expect(summaryBlock).toContain('FROM CrossSellDailyAgg');
    expect(bundleBlock).toContain('FROM CrossSellDailyAgg');
    expect(summaryBlock).not.toContain('FROM PolicyFact');
    expect(bundleBlock).not.toContain('FROM PolicyFact');
  });
});
