import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('cross-sell-org-trend route contract', () => {
  it('accepts all for seat coverage level and vehicle category', () => {
    const content = readSource('server/src/routes/query.ts');

    expect(content).toContain("const CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL = ['all', ...CROSS_SELL_SEAT_COVERAGE_LEVELS] as const;");
    expect(content).toContain("seatCoverageLevel: z.enum(CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL).optional()");
    expect(content).toContain("vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger')");
  });
});
