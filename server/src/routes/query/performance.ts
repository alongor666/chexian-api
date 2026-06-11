import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  parseFiltersAndBuildBothWhere,
  extractOrgNames, extractSalesmanNames,
  QUERY_CACHE, withRouteCache,
} from './shared.js';
import {
  generatePerformanceSummaryQuery,
  generatePerformanceTrendQuery,
  generatePerformanceDrilldownQuery,
  generatePerformanceTopSalesmanQuery,
  generatePerformanceOrgHeatmapQuery,
  mapLegacyVehicleCategoryToSegmentTag,
  type HeatmapGroupDimension,
  type HeatmapDrillStep,
  type PerformanceSegmentTag,
  type PerformanceVehicleCategory,
  type PerformanceGrowthMode,
  type PerformanceTimePeriod,
  type PerformanceTrendGranularity,
  type PerformanceSummaryExpandDims,
  type PerformanceDimension,
  type PerformanceDrilldownStep,
} from '../../sql/performance-analysis.js';

const router = Router();

export const PERFORMANCE_DIMENSIONS = [
  'org_level_3', 'team', 'salesman', 'customer_category',
  'tonnage_segment',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
] as const;

export const PERFORMANCE_SEGMENT_TAGS = [
  'all',
  'non_business_passenger',
  'business_passenger',
  'business_truck',
  'non_business_truck',
  'motorcycle',
  'truck',
] as const;

export const PERFORMANCE_LEGACY_CATEGORIES = ['passenger', 'business_passenger', 'truck', 'motorcycle'] as const;
export const PERFORMANCE_EXPAND_DIMS = ['none', 'energy', 'business_nature', 'energy_business_nature'] as const;

export function resolvePerformanceSegmentTag(data: {
  segmentTag?: string;
  vehicleCategory?: string;
}): PerformanceSegmentTag {
  if (data.segmentTag) {
    return data.segmentTag as PerformanceSegmentTag;
  }
  if (data.vehicleCategory) {
    return mapLegacyVehicleCategoryToSegmentTag(data.vehicleCategory as PerformanceVehicleCategory);
  }
  return 'all';
}

export function mapPerformanceTimeToGranularity(timePeriod: PerformanceTimePeriod): PerformanceTrendGranularity {
  switch (timePeriod) {
    case 'day': return 'daily';
    case 'week': return 'weekly';
    case 'month': return 'monthly';
    case 'quarter': return 'quarterly';
    case 'year': return 'yearly';
    default: return 'daily';
  }
}

const PERFORMANCE_HEATMAP_DIMENSIONS = ['org_level_3', 'team', 'salesman', 'customer_category', 'coverage_combination', 'energy_type', 'business_nature', 'insurance_grade'] as const;

export const performanceSummarySchema = z.object({
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('day'),
  growthMode: z.enum(['mom', 'yoy']).default('mom'),
  expandDims: z.enum(PERFORMANCE_EXPAND_DIMS).default('none'),
});

router.get(
  '/performance-summary',
  withRouteCache('performance-summary'),
  asyncHandler(async (req, res) => {
    const extraResult = performanceSummarySchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { timePeriod, growthMode, expandDims } = extraResult.data;
    const segmentTag = resolvePerformanceSegmentTag(extraResult.data);

    const { whereWithDate, whereWithoutDate, dateField } = parseFiltersAndBuildBothWhere(req);

    const sql = generatePerformanceSummaryQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      expandDims as PerformanceSummaryExpandDims,
      undefined,
      dateField
    );

    const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: { rows },
    });
  })
);

export const performanceTrendSchema = z.object({
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('daily'),
  growthMode: z.enum(['mom', 'yoy']).default('mom'),
});

router.get(
  '/performance-trend',
  withRouteCache('performance-trend'),
  asyncHandler(async (req, res) => {
    const extraResult = performanceTrendSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { granularity } = extraResult.data;
    const segmentTag = resolvePerformanceSegmentTag(extraResult.data);

    const { whereWithDate, dateField } = parseFiltersAndBuildBothWhere(req);

    const sql = generatePerformanceTrendQuery(
      whereWithDate,
      segmentTag as PerformanceSegmentTag,
      granularity as PerformanceTrendGranularity,
      dateField
    );

    const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: { rows },
    });
  })
);

export const performanceDrilldownSchema = z.object({
  drillPath: z.string().optional().default('[]'),
  groupBy: z.enum(PERFORMANCE_DIMENSIONS).optional(),
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('day'),
  growthMode: z.enum(['mom', 'yoy']).default('mom'),
});

router.get(
  '/performance-drilldown',
  withRouteCache('performance-drilldown'),
  asyncHandler(async (req, res) => {
    const extraResult = performanceDrilldownSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { timePeriod, growthMode } = extraResult.data;
    const segmentTag = resolvePerformanceSegmentTag(extraResult.data);

    let drillPath: PerformanceDrilldownStep[] = [];
    try {
      const parsed = JSON.parse(extraResult.data.drillPath);
      if (Array.isArray(parsed)) {
        drillPath = parsed.map((s: any) => ({
          dimension: String(s.dimension) as PerformanceDimension,
          value: String(s.value),
        }));
      }
    } catch {
      throw new AppError(400, 'Invalid drillPath JSON');
    }

    const groupBy = extraResult.data.groupBy as PerformanceDimension | undefined;

    const { filterData, whereWithDate, whereWithoutDate, dateField } = parseFiltersAndBuildBothWhere(req);
    // 年计划取数范围（标准口径）：与保费看板 /kpi 同源的 org/salesman 提取
    const planScope = {
      orgNames: extractOrgNames(filterData, req.permissionFilter),
      salesmanNames: extractSalesmanNames(filterData, req.permissionFilter),
    };

    const [summaryRows, drilldownRows] = await Promise.all([
      duckdbService.query(
        generatePerformanceDrilldownQuery(
          whereWithDate, whereWithoutDate,
          segmentTag as PerformanceSegmentTag,
          timePeriod as PerformanceTimePeriod,
          growthMode as PerformanceGrowthMode,
          drillPath, null,
          undefined, dateField, planScope
        ),
        QUERY_CACHE.hotspotShort
      ),
      groupBy
        ? duckdbService.query(
          generatePerformanceDrilldownQuery(
            whereWithDate, whereWithoutDate,
            segmentTag as PerformanceSegmentTag,
            timePeriod as PerformanceTimePeriod,
            growthMode as PerformanceGrowthMode,
            drillPath, groupBy,
            undefined, dateField, planScope
          ),
          QUERY_CACHE.hotspotShort
        )
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: {
        summary: summaryRows[0] || null,
        rows: drilldownRows,
        drillPath,
        groupBy: groupBy || null,
      },
    });
  })
);

export const performanceOrgHeatmapSchema = z.object({
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('day'),
  groupByDimension: z.enum(PERFORMANCE_HEATMAP_DIMENSIONS).default('org_level_3'),
  drillFilter: z.string().optional().default('[]'),
});

router.get(
  '/performance-org-heatmap',
  withRouteCache('performance-org-heatmap'),
  asyncHandler(async (req, res) => {
    const parseResult = performanceOrgHeatmapSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { timePeriod, groupByDimension, drillFilter: drillFilterStr } = parseResult.data;
    const segmentTag = resolvePerformanceSegmentTag(parseResult.data);
    const { whereWithoutDate, dateField } = parseFiltersAndBuildBothWhere(req);

    let drillFilter: HeatmapDrillStep[] = [];
    try {
      drillFilter = JSON.parse(drillFilterStr || '[]');
      if (!Array.isArray(drillFilter)) drillFilter = [];
    } catch {
      drillFilter = [];
    }

    const sql = generatePerformanceOrgHeatmapQuery(
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      15,
      groupByDimension as HeatmapGroupDimension,
      drillFilter,
      dateField
    );

    const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: { rows },
    });
  })
);

export const performanceTopSalesmanSchema = z.object({
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('day'),
  growthMode: z.enum(['mom', 'yoy']).default('mom'),
  limit: z.coerce.number().default(20),
});

router.get(
  '/performance-top-salesman',
  withRouteCache('performance-top-salesman'),
  asyncHandler(async (req, res) => {
    const extraResult = performanceTopSalesmanSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { timePeriod, growthMode, limit } = extraResult.data;
    const segmentTag = resolvePerformanceSegmentTag(extraResult.data);

    const { filterData, whereWithDate, whereWithoutDate, dateField } = parseFiltersAndBuildBothWhere(req);
    // 年计划取数范围（标准口径）：与保费看板 /kpi 同源的 org/salesman 提取
    const planScope = {
      orgNames: extractOrgNames(filterData, req.permissionFilter),
      salesmanNames: extractSalesmanNames(filterData, req.permissionFilter),
    };

    const sql = generatePerformanceTopSalesmanQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      limit,
      undefined,
      dateField,
      planScope
    );

    const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: { rows },
    });
  })
);

export default router;
