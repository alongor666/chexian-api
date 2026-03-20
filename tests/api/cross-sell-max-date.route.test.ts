import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('cross-sell maxDate route contract', () => {
  it('uses CrossSellDailyAgg as maxDate source for cross-sell summary and bundle', () => {
    // After route split, cross-sell logic lives in cross-sell.ts and bundles.ts
    const crossSellPath = path.resolve(process.cwd(), 'server/src/routes/query/cross-sell.ts');
    const bundlesPath = path.resolve(process.cwd(), 'server/src/routes/query/bundles.ts');
    const content = fs.readFileSync(crossSellPath, 'utf-8') + fs.readFileSync(bundlesPath, 'utf-8');

    const maxDateSqlBlocks = content.match(/const maxDateSql = `[\s\S]*?`;/g) ?? [];
    expect(maxDateSqlBlocks.length).toBeGreaterThanOrEqual(2);

    const [summaryBlock, bundleBlock] = maxDateSqlBlocks;
    expect(summaryBlock).toContain('FROM CrossSellDailyAgg');
    expect(bundleBlock).toContain('FROM CrossSellDailyAgg');
    expect(summaryBlock).not.toContain('FROM PolicyFact');
    expect(bundleBlock).not.toContain('FROM PolicyFact');
  });
});
