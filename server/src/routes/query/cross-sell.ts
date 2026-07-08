import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  parseFiltersAndBuildWhere, parseFiltersAndBuildBothWhere,
  logger, QUERY_CACHE, createDomainMiddleware, withRouteCache,
  type Request,
} from './shared.js';
import { filterByDomainColumns } from '../../utils/domain-filter-sanitizer.js';
import { generateCrossSellQuery, type CrossSellDimension, type DrilldownStep } from '../../sql/cross-sell.js';
import { getBranchCompanyName } from '../../config/branch-names.js';
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

/**
 * CrossSellDailyAgg 物化表不含 insurance_type / fuel_type / vehicle_model 列，
 * 共享 parser 按这些参数注入 WHERE 会触发 DuckDB Binder Error（HTTP 400）。
 * 返回净化副本传给 parser；不修改 req.query —— 险类子句
 * buildCrossSellAggInsuranceClause 仍从原始 req.query.insuranceType 读取。
 * gas/oil（依赖 fuel_type）与 dump/tractor/general（依赖 vehicle_model）
 * 为防御性剥离（防直接 API 调用 400），不做语义映射；前端已隐藏对应 chip。
 * electric 不剥离：parser 对其产出 is_nev = true，agg 有该列，与 SSOT 严格等价。
 *
 * 净化剥离清单已中央化到 domain-filter-sanitizer.ts 的 DOMAIN_SUPPORTED_COLUMNS
 * （BACKLOG 2026-07-07-claude-dce69c，8f71c0 architect 闸 P1-1）：本函数保留导出名
 * 以兼容既有测试 / bundles/cross-sell.ts 调用方，内部改为委托共享的
 * filterByDomainColumns('crossSellAgg')，不再本地硬编码剥离清单。
 */
export function sanitizeAggQuery(query: Request['query']): Request['query'] {
  return filterByDomainColumns(query, 'crossSellAgg');
}

export async function ensureCrossSellAggregateTablesReady(): Promise<void> {
  return;
}

const router = Router();

// 集中式惰性域加载中间件（per MAT-01）：CrossSell + ClaimsAgg
router.use(createDomainMiddleware('CrossSell', 'ClaimsAgg'));

export const crossSellExtraSchema = z.object({
  drillPath: z.string().max(2000).optional().default('[]'),
  groupBy: z.enum(CROSS_SELL_DIMENSIONS).optional(),
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).optional(),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
  timePeriod: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
});

router.get('/cross-sell', withRouteCache('cross-sell'), asyncHandler(async (req, res) => {
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

  let { whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req, sanitizeAggQuery(req.query));

  finalWhereClause += ` AND ${getVehicleCategoryFilter(normalizedVehicleCategory)}`;
  const seatCoverageClause = getSeatCoverageClause(normalizedSeatCoverageLevel);
  if (seatCoverageClause) {
    finalWhereClause += ` AND ${seatCoverageClause}`;
  }
  const insuranceClause = buildCrossSellAggInsuranceClause(req.query.insuranceType);
  if (insuranceClause) {
    finalWhereClause += ` AND ${insuranceClause}`;
  }

  // 0E：分公司汇总标签按当前用户的 branchCode 派生（兼容期 admin 落 'SC' → '四川分公司'）
  const summaryGroupName = getBranchCompanyName(req.user?.branchCode);
  const [summaryResult, drilldownResult] = await Promise.all([
    duckdbService.query(generateCrossSellQuery(finalWhereClause, drillPath, null, summaryGroupName), QUERY_CACHE.hotspotShort),
    groupBy
      ? duckdbService.query(generateCrossSellQuery(finalWhereClause, drillPath, groupBy, summaryGroupName), QUERY_CACHE.hotspotShort)
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

export const crossSellTrendSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
});

router.get('/cross-sell-trend', withRouteCache('cross-sell-trend'), asyncHandler(async (req, res) => {
  const extraResult = crossSellTrendSchema.safeParse(req.query);
  if (!extraResult.success) {
    throw new AppError(400, extraResult.error.issues[0].message);
  }
  const { granularity } = extraResult.data;
  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';
  await ensureCrossSellAggregateTablesReady();

  const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeAggQuery(req.query));
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

export const crossSellSummarySchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
});

router.get('/cross-sell-summary', withRouteCache('cross-sell-summary'), asyncHandler(async (req, res) => {
  const extraResult = crossSellSummarySchema.safeParse(req.query);
  if (!extraResult.success) {
    throw new AppError(400, extraResult.error.issues[0].message);
  }

  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';
  await ensureCrossSellAggregateTablesReady();

  const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeAggQuery(req.query));
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

export const crossSellOrgTrendSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  coverageCombination: z.enum(['整体', '交三', '主全', '单交']).default('整体'),
  days: z.coerce.number().int().min(1).max(90).default(14),
  seatCoverageLevel: z.enum(CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
});

router.get('/cross-sell-org-trend', withRouteCache('cross-sell-org-trend'), asyncHandler(async (req, res) => {
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
export const crossSellHeatmapSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  seatCoverageLevel: z.enum(CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter']).default('day'),
  groupByDimension: z.enum(CROSS_SELL_HEATMAP_DIMENSIONS).default('org_level_3'),
  drillFilter: z.string().optional().default('[]'),
});

router.get('/cross-sell-heatmap', withRouteCache('cross-sell-heatmap'), asyncHandler(async (req, res) => {
  const extraResult = crossSellHeatmapSchema.safeParse(req.query);
  if (!extraResult.success) {
    throw new AppError(400, extraResult.error.issues[0].message);
  }
  const { timePeriod, groupByDimension, drillFilter: drillFilterStr } = extraResult.data;
  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';

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
  // PolicyFact 分支原生支持 insurance_type/fuel_type/vehicle_model 列，不净化；
  // agg 分支（CrossSellDailyAgg）无这些列，传净化副本防 Binder Error
  const { whereWithDate: whereClause, dateField } = parseFiltersAndBuildBothWhere(
    req,
    usePolicyFactHeatmap ? undefined : sanitizeAggQuery(req.query)
  );
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

export const crossSellTopSalesmanSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  coverage: z.enum(['主全', '交三']).default('主全'),
  timePeriod: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('daily'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
});

router.get('/cross-sell-top-salesman', withRouteCache('cross-sell-top-salesman'), asyncHandler(async (req, res) => {
  const extraResult = crossSellTopSalesmanSchema.safeParse(req.query);
  if (!extraResult.success) {
    throw new AppError(400, extraResult.error.issues[0].message);
  }
  const { coverage, timePeriod } = extraResult.data;
  const normalizedVehicleCategory: VehicleCategory = 'passenger';
  const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';
  await ensureCrossSellAggregateTablesReady();

  const { whereWithoutDate } = parseFiltersAndBuildBothWhere(req, sanitizeAggQuery(req.query));
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
