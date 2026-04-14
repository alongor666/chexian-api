import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  parseFiltersAndBuildWhere, parseFiltersAndBuildBothWhere,
  logger, QUERY_CACHE, createDomainMiddleware,
} from './shared.js';
import { generateCrossSellQuery, type CrossSellDimension, type DrilldownStep } from '../../sql/cross-sell.js';
import { generateCrossSellTimePeriodQuery, getVehicleCategoryFilter, type VehicleCategory } from '../../sql/cross-sell-summary.js';
import { generateCrossSellTrendQuery, type TrendGranularity } from '../../sql/cross-sell-trend.js';
import { generateCrossSellOrgTrendQuery, type CoverageCombinationFilter } from '../../sql/cross-sell-org-trend.js';
import { generateCrossSellHeatmapQuery, type CrossSellHeatmapGroupDimension, type CrossSellHeatmapDrillStep } from '../../sql/cross-sell-heatmap.js';
import { generateCrossSellTopSalesmanQuery, type TopSalesmanCoverage } from '../../sql/cross-sell-top-salesman.js';

export const CROSS_SELL_DIMENSIONS = [
  'org_level_3', 'team', 'salesman',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
  'insurance_grade',
] as const;

export const CROSS_SELL_SEAT_COVERAGE_LEVELS = ['eq_1w', 'gte_2w', 'lt_1w'] as const;
export const CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL = ['all', ...CROSS_SELL_SEAT_COVERAGE_LEVELS] as const;
export type CrossSellSeatCoverageLevel = typeof CROSS_SELL_SEAT_COVERAGE_LEVELS[number] | 'all';

export function getSeatCoverageClause(level?: CrossSellSeatCoverageLevel): string {
  if (!level || level === 'all') return '';
  switch (level) {
    case 'eq_1w':
      return 'COALESCE(driver_coverage, 0) = 10000 AND COALESCE(passenger_coverage, 0) = 10000';
    case 'gte_2w':
      return 'COALESCE(driver_coverage, 0) >= 20000 AND COALESCE(passenger_coverage, 0) >= 20000';
    case 'lt_1w':
      return '(COALESCE(driver_coverage, 0) > 0 OR COALESCE(passenger_coverage, 0) > 0) AND COALESCE(driver_coverage, 0) < 10000 AND COALESCE(passenger_coverage, 0) < 10000';
    default:
      return '';
  }
}

function parseInsuranceTypeFlag(raw: unknown): boolean | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

export function buildPolicyFactInsuranceClause(raw: unknown): string {
  const insuranceType = parseInsuranceTypeFlag(raw);
  if (insuranceType === true) return "insurance_type = '交强险'";
  if (insuranceType === false) return "insurance_type IN ('商业险', '商业保险', '商车统保', '商业险+交强险')";
  return '';
}

export function buildCrossSellAggInsuranceClause(raw: unknown): string {
  const insuranceType = parseInsuranceTypeFlag(raw);
  if (insuranceType === true) return 'COALESCE(compulsory_premium, 0) > 0';
  if (insuranceType === false) return 'COALESCE(commercial_premium, 0) > 0';
  return '';
}

export async function ensureCrossSellAggregateTablesReady(): Promise<void> {
  return;
}

const router = Router();

// 集中式惰性域加载中间件（per MAT-01）：CrossSell + ClaimsAgg
router.use(createDomainMiddleware('CrossSell', 'ClaimsAgg'));

const crossSellExtraSchema = z.object({
  drillPath: z.string().max(2000).optional().default('[]'),
  groupBy: z.enum(CROSS_SELL_DIMENSIONS).optional(),
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).optional(),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
  timePeriod: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
});

router.get('/cross-sell', asyncHandler(async (req, res) => {
  const crossSellResult = crossSellExtraSchema.safeParse(req.query);
  if (!crossSellResult.success) {
    throw new AppError(400, crossSellResult.error.issues[0].message);
  }

  let drillPath: DrilldownStep[] = [];
  try {
    const parsed = JSON.parse(crossSellResult.data.drillPath);
    if (Array.isArray(parsed)) {
      drillPath = parsed.map((s: any) => ({
        dimension: String(s.dimension) as CrossSellDimension,
        value: String(s.value).slice(0, 255),
      }));
    }
  } catch {
    throw new AppError(400, 'Invalid drillPath JSON');
  }

  const groupBy = crossSellResult.data.groupBy as CrossSellDimension | undefined;
  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';
  await ensureCrossSellAggregateTablesReady();

  let { whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

  finalWhereClause += ` AND ${getVehicleCategoryFilter(normalizedVehicleCategory)}`;
  const seatCoverageClause = getSeatCoverageClause(normalizedSeatCoverageLevel);
  if (seatCoverageClause) {
    finalWhereClause += ` AND ${seatCoverageClause}`;
  }
  const insuranceClause = buildCrossSellAggInsuranceClause(req.query.insuranceType);
  if (insuranceClause) {
    finalWhereClause += ` AND ${insuranceClause}`;
  }

  const [summaryResult, drilldownResult] = await Promise.all([
    duckdbService.query(generateCrossSellQuery(finalWhereClause, drillPath, null), QUERY_CACHE.hotspotShort),
    groupBy
      ? duckdbService.query(generateCrossSellQuery(finalWhereClause, drillPath, groupBy), QUERY_CACHE.hotspotShort)
      : Promise.resolve([]),
  ]);

  res.json({
    success: true,
    data: {
      summary: summaryResult[0] || null,
      rows: drilldownResult,
      drillPath,
      groupBy: groupBy || null,
    },
  });
}));

const crossSellTrendSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
});

router.get('/cross-sell-trend', asyncHandler(async (req, res) => {
  const extraResult = crossSellTrendSchema.safeParse(req.query);
  if (!extraResult.success) {
    throw new AppError(400, extraResult.error.issues[0].message);
  }
  const { granularity } = extraResult.data;
  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';
  await ensureCrossSellAggregateTablesReady();

  const { whereClause } = parseFiltersAndBuildWhere(req);
  let finalWhereClause = whereClause;
  const seatCoverageClause = getSeatCoverageClause(normalizedSeatCoverageLevel);
  if (seatCoverageClause) {
    finalWhereClause += ` AND ${seatCoverageClause}`;
  }
  const insuranceClause = buildCrossSellAggInsuranceClause(req.query.insuranceType);
  if (insuranceClause) {
    finalWhereClause += ` AND ${insuranceClause}`;
  }

  const sql = generateCrossSellTrendQuery(
    finalWhereClause,
    normalizedVehicleCategory,
    granularity as TrendGranularity
  );

  logger.debug('[cross-sell-trend] Generated SQL', { sqlLength: sql.length });

  const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

  res.json({
    success: true,
    data: { rows },
  });
}));

const crossSellSummarySchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
});

router.get('/cross-sell-summary', asyncHandler(async (req, res) => {
  const extraResult = crossSellSummarySchema.safeParse(req.query);
  if (!extraResult.success) {
    throw new AppError(400, extraResult.error.issues[0].message);
  }

  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';
  await ensureCrossSellAggregateTablesReady();

  const { whereClause } = parseFiltersAndBuildWhere(req);
  let finalWhereClause = whereClause;
  const seatCoverageClause = getSeatCoverageClause(normalizedSeatCoverageLevel);
  if (seatCoverageClause) {
    finalWhereClause += ` AND ${seatCoverageClause}`;
  }
  const insuranceClause = buildCrossSellAggInsuranceClause(req.query.insuranceType);
  if (insuranceClause) {
    finalWhereClause += ` AND ${insuranceClause}`;
  }

  const sql = generateCrossSellTimePeriodQuery(
    finalWhereClause,
    normalizedVehicleCategory
  );

  logger.debug('[cross-sell-summary] Generated SQL', { sqlLength: sql.length });

  const result = await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

  const maxDateSql = `
    SELECT MAX(CAST(policy_date AS DATE)) AS max_date
    FROM CrossSellDailyAgg
    WHERE ${finalWhereClause}
      AND ${getVehicleCategoryFilter(normalizedVehicleCategory)}
  `;
  const maxDateResult = await duckdbService.query(maxDateSql, QUERY_CACHE.hotspotMedium);
  const maxDate = maxDateResult[0]?.max_date || null;

  res.json({
    success: true,
    data: {
      maxDate,
      rows: result,
    },
  });
}));

const crossSellOrgTrendSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  coverageCombination: z.enum(['整体', '交三', '主全', '单交']).default('整体'),
  days: z.coerce.number().int().min(1).max(90).default(14),
  seatCoverageLevel: z.enum(CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
});

router.get('/cross-sell-org-trend', asyncHandler(async (req, res) => {
  const extraResult = crossSellOrgTrendSchema.safeParse(req.query);
  if (!extraResult.success) {
    throw new AppError(400, extraResult.error.issues[0].message);
  }
  const { coverageCombination, days } = extraResult.data;
  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';

  const { whereWithDate, dateField } = parseFiltersAndBuildBothWhere(req);
  let finalWhereClause = whereWithDate;
  const seatCoverageClause = getSeatCoverageClause(normalizedSeatCoverageLevel);
  if (seatCoverageClause) {
    finalWhereClause += ` AND ${seatCoverageClause}`;
  }
  const insuranceClause = buildPolicyFactInsuranceClause(req.query.insuranceType);
  if (insuranceClause) {
    finalWhereClause += ` AND ${insuranceClause}`;
  }

  const sql = generateCrossSellOrgTrendQuery(
    finalWhereClause,
    normalizedVehicleCategory,
    coverageCombination as CoverageCombinationFilter,
    days,
    dateField
  );

  logger.debug('[cross-sell-org-trend] Generated SQL', { sqlLength: sql.length });

  const rows = await duckdbService.query(sql);

  res.json({
    success: true,
    data: { rows },
  });
}));

const CROSS_SELL_HEATMAP_DIMENSIONS = ['org_level_3', 'team', 'salesman', 'coverage_combination', 'energy_type', 'business_nature'] as const;
const CROSS_SELL_HEATMAP_DIMENSION_SET = new Set<string>(CROSS_SELL_HEATMAP_DIMENSIONS);
const crossSellHeatmapSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  seatCoverageLevel: z.enum(CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter']).default('day'),
  groupByDimension: z.enum(CROSS_SELL_HEATMAP_DIMENSIONS).default('org_level_3'),
  drillFilter: z.string().optional().default('[]'),
});

router.get('/cross-sell-heatmap', asyncHandler(async (req, res) => {
  const extraResult = crossSellHeatmapSchema.safeParse(req.query);
  if (!extraResult.success) {
    throw new AppError(400, extraResult.error.issues[0].message);
  }
  const { timePeriod, groupByDimension, drillFilter: drillFilterStr } = extraResult.data;
  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';

  const { whereWithDate: whereClause, dateField } = parseFiltersAndBuildBothWhere(req);
  const seatCoverageClause = getSeatCoverageClause(normalizedSeatCoverageLevel);

  let crossSellDrillFilter: CrossSellHeatmapDrillStep[] = [];
  try {
    const parsed = JSON.parse(drillFilterStr || '[]');
    if (Array.isArray(parsed)) {
      crossSellDrillFilter = parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          dimension: String((item as Record<string, unknown>).dimension || ''),
          value: String((item as Record<string, unknown>).value || ''),
        }))
        .filter((item) => CROSS_SELL_HEATMAP_DIMENSION_SET.has(item.dimension))
        .map((item) => ({
          dimension: item.dimension as CrossSellHeatmapGroupDimension,
          value: item.value,
        }));
    }
  } catch {
    crossSellDrillFilter = [];
  }

  const usePolicyFactHeatmap =
    groupByDimension === 'team'
    || groupByDimension === 'salesman'
    || crossSellDrillFilter.some((item) => item.dimension === 'team' || item.dimension === 'salesman');
  const insuranceClause = usePolicyFactHeatmap
    ? buildPolicyFactInsuranceClause(req.query.insuranceType)
    : buildCrossSellAggInsuranceClause(req.query.insuranceType);
  const finalWhereClause = insuranceClause ? `${whereClause} AND ${insuranceClause}` : whereClause;

  const sql = generateCrossSellHeatmapQuery(
    finalWhereClause,
    normalizedVehicleCategory,
    seatCoverageClause,
    timePeriod as 'day' | 'week' | 'month' | 'quarter',
    groupByDimension as CrossSellHeatmapGroupDimension,
    crossSellDrillFilter,
    dateField
  );

  logger.debug('[cross-sell-heatmap] Generated SQL', { sqlLength: sql.length });

  const rows = await duckdbService.query(sql);

  res.json({
    success: true,
    data: { rows },
  });
}));

const crossSellTopSalesmanSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  coverage: z.enum(['主全', '交三']).default('主全'),
  timePeriod: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('daily'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
});

router.get('/cross-sell-top-salesman', asyncHandler(async (req, res) => {
  const extraResult = crossSellTopSalesmanSchema.safeParse(req.query);
  if (!extraResult.success) {
    throw new AppError(400, extraResult.error.issues[0].message);
  }
  const { coverage, timePeriod } = extraResult.data;
  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';
  await ensureCrossSellAggregateTablesReady();

  const { whereWithoutDate } = parseFiltersAndBuildBothWhere(req);
  let finalWhereClause = whereWithoutDate;
  const seatCoverageClause = getSeatCoverageClause(normalizedSeatCoverageLevel);
  if (seatCoverageClause) {
    finalWhereClause += ` AND ${seatCoverageClause}`;
  }
  const insuranceClause = buildCrossSellAggInsuranceClause(req.query.insuranceType);
  if (insuranceClause) {
    finalWhereClause += ` AND ${insuranceClause}`;
  }

  const sql = generateCrossSellTopSalesmanQuery(
    finalWhereClause,
    normalizedVehicleCategory,
    coverage as TopSalesmanCoverage,
    timePeriod
  );

  const result = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

  res.json({
    success: true,
    data: {
      rows: result,
    },
  });
}));

export default router;
