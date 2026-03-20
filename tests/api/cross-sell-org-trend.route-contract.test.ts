import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('cross-sell-org-trend route contract', () => {
  it('accepts all for seat coverage level and vehicle category in org trend schema', () => {
    const content = readSource('server/src/routes/query/cross-sell.ts');

    expect(content).toContain("const CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL = ['all', ...CROSS_SELL_SEAT_COVERAGE_LEVELS] as const;");

    const orgTrendStart = content.indexOf('const crossSellOrgTrendSchema = z.object({');
    const orgTrendEnd = content.indexOf('});', orgTrendStart);
    const orgTrendSchema = content.slice(orgTrendStart, orgTrendEnd);
    expect(orgTrendSchema).toContain("vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger')");
    expect(orgTrendSchema).toContain("seatCoverageLevel: z.enum(CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL).optional()");

  });

  it('locks cross-sell routes to passenger + all while keeping params compatible', () => {
    const content = readSource('server/src/routes/query/cross-sell.ts');

    const crossSellDimsStart = content.indexOf('const CROSS_SELL_DIMENSIONS = [');
    const crossSellDimsEnd = content.indexOf('] as const;', crossSellDimsStart);
    const crossSellDims = content.slice(crossSellDimsStart, crossSellDimsEnd);
    expect(crossSellDims).not.toContain('customer_category');

    const crossSellHeatmapDimsStart = content.indexOf('const CROSS_SELL_HEATMAP_DIMENSIONS = [');
    const crossSellHeatmapDimsEnd = content.indexOf('] as const;', crossSellHeatmapDimsStart);
    const crossSellHeatmapDims = content.slice(crossSellHeatmapDimsStart, crossSellHeatmapDimsEnd);
    expect(crossSellHeatmapDims).not.toContain('customer_category');
    expect(content).toContain('const CROSS_SELL_HEATMAP_DIMENSION_SET = new Set<string>(CROSS_SELL_HEATMAP_DIMENSIONS);');
    expect(content).toContain('.filter((item) => CROSS_SELL_HEATMAP_DIMENSION_SET.has(item.dimension))');

    expect(content).toContain("const normalizedVehicleCategory: VehicleCategory = 'passenger';");
    expect(content).toContain("const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';");
  });
});
