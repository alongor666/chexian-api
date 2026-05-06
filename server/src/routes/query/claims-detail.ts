/**
 * 赔案明细分析路由
 *
 * 数据源：ClaimsDetail VIEW（赔案 Parquet）+ PolicyFact（保单维度 JOIN）
 * 端点：/api/query/claims-detail/*
 */

import { Router } from 'express';
import {
  asyncHandler, AppError, duckdbService, isValidDateFormat, createDomainMiddleware,
} from './shared.js';
import {
  generatePendingOverviewQuery,
  generatePendingByOrgQuery,
  generatePendingAgingQuery,
  generateCauseAnalysisQuery,
  generateGeoRiskByAccidentQuery,
  generateGeoRiskByPlateQuery,
  generateGeoComparisonQuery,
  generateClaimCycleQuery,
  generateFrequencyYoyQuery,
  generateLossRatioDevelopmentQuery,
  type ClaimsDetailFilters,
} from '../../sql/claims-detail.js';
import {
  generateClaimsHeatmapQuery,
  type ClaimsHeatmapFilters,
  type ClaimsDateField,
  type HeatmapGroupDimension,
} from '../../sql/claims-heatmap.js';

const router = Router();

// 集中式惰性域加载中间件（per MAT-01）：ClaimsDetail + ClaimsAgg
router.use(createDomainMiddleware('ClaimsDetail', 'ClaimsAgg'));

function parseFilters(query: Record<string, unknown>): ClaimsDetailFilters {
  const filters: ClaimsDetailFilters = {};
  if (query.dateStart && typeof query.dateStart === 'string') {
    if (!isValidDateFormat(query.dateStart)) throw new AppError(400, 'dateStart 格式无效');
    filters.dateStart = query.dateStart;
  }
  if (query.dateEnd && typeof query.dateEnd === 'string') {
    if (!isValidDateFormat(query.dateEnd)) throw new AppError(400, 'dateEnd 格式无效');
    filters.dateEnd = query.dateEnd;
  }
  if (query.orgName && typeof query.orgName === 'string') filters.orgName = query.orgName;
  if (query.claimStatus && typeof query.claimStatus === 'string') filters.claimStatus = query.claimStatus;
  if (query.isBodilyInjury && typeof query.isBodilyInjury === 'string') filters.isBodilyInjury = query.isBodilyInjury;
  if (query.accidentCause && typeof query.accidentCause === 'string') filters.accidentCause = query.accidentCause;
  if (query.accidentCity && typeof query.accidentCity === 'string') filters.accidentCity = query.accidentCity;
  if (query.customerCategory && typeof query.customerCategory === 'string') filters.customerCategory = query.customerCategory;
  if (query.isNev && typeof query.isNev === 'string') filters.isNev = query.isNev;
  if (query.coverageCombination && typeof query.coverageCombination === 'string') filters.coverageCombination = query.coverageCombination;
  if (query.isTransfer && typeof query.isTransfer === 'string') filters.isTransfer = query.isTransfer;
  if (query.vehicleQuickFilter && typeof query.vehicleQuickFilter === 'string') filters.vehicleQuickFilter = query.vehicleQuickFilter;
  if (query.businessNature && typeof query.businessNature === 'string') filters.businessNature = query.businessNature;
  if (query.coverageCombinations && typeof query.coverageCombinations === 'string') filters.coverageCombination = query.coverageCombinations;
  if (query.isNewCar && typeof query.isNewCar === 'string') filters.isNewCar = query.isNewCar;
  if (query.isRenewal && typeof query.isRenewal === 'string') filters.isRenewal = query.isRenewal;
  return filters;
}

/**
 * GET /api/query/claims-detail/pending-overview
 * 未决赔案概览（已结案 vs 未结案汇总）
 */
router.get(
  '/claims-detail/pending-overview',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generatePendingOverviewQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/claims-detail/pending-by-org
 * 未决赔案按机构分布
 */
router.get(
  '/claims-detail/pending-by-org',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generatePendingByOrgQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/claims-detail/pending-aging
 * 未决赔案账龄分布
 */
router.get(
  '/claims-detail/pending-aging',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generatePendingAgingQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/claims-detail/cause-analysis
 * 出险原因分析
 */
router.get(
  '/claims-detail/cause-analysis',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateCauseAnalysisQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/claims-detail/geo-accident
 * 地理风险：按出险地点
 */
router.get(
  '/claims-detail/geo-accident',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateGeoRiskByAccidentQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/claims-detail/geo-plate
 * 地理风险：按车牌归属地
 */
router.get(
  '/claims-detail/geo-plate',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateGeoRiskByPlateQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/claims-detail/geo-comparison
 * 地理风险对比（出险地 vs 车牌归属地 异地出险率）
 */
router.get(
  '/claims-detail/geo-comparison',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateGeoComparisonQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data: data[0] ?? {} });
  })
);

/**
 * GET /api/query/claims-detail/claim-cycle
 * 理赔时效分析（人伤 vs 非人伤）
 */
router.get(
  '/claims-detail/claim-cycle',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateClaimCycleQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/claims-detail/frequency-yoy
 * 出险频度同比（季度粒度）
 */
router.get(
  '/claims-detail/frequency-yoy',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateFrequencyYoyQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/claims-detail/loss-ratio-development
 * 赔付率发展三角形（按起保年份 × 发展月 1~24）
 */
router.get(
  '/claims-detail/loss-ratio-development',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const cohortYearsStr = req.query.cohortYears;
    const cohortYears = typeof cohortYearsStr === 'string'
      ? cohortYearsStr.split(',').map(Number).filter(n => !isNaN(n) && n >= 2020 && n <= 2030)
      : [2023, 2024, 2025, 2026];
    const sql = generateLossRatioDevelopmentQuery(filters, cohortYears);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/claims-detail/heatmap
 * 理赔热力图（维度 × 周/月 矩阵，含同比数据）
 */
const VALID_HEATMAP_DIMENSIONS = new Set<string>([
  'org_level_3', 'team', 'salesman', 'customer_category',
  'coverage_combination', 'energy_type', 'business_nature', 'insurance_grade',
]);

router.get(
  '/claims-detail/heatmap',
  asyncHandler(async (req, res) => {
    const heatmapFilters: ClaimsHeatmapFilters = {};
    const q = req.query;
    if (q.orgName && typeof q.orgName === 'string') heatmapFilters.orgName = q.orgName;
    if (q.customerCategory && typeof q.customerCategory === 'string') heatmapFilters.customerCategory = q.customerCategory;
    if (q.isNev && typeof q.isNev === 'string') heatmapFilters.isNev = q.isNev;
    if (q.coverageCombination && typeof q.coverageCombination === 'string') heatmapFilters.coverageCombination = q.coverageCombination;
    // 兼容前端部分页面发送复数形式 coverageCombinations
    if (q.coverageCombinations && typeof q.coverageCombinations === 'string') heatmapFilters.coverageCombination = q.coverageCombinations;
    if (q.isTransfer && typeof q.isTransfer === 'string') heatmapFilters.isTransfer = q.isTransfer;
    if (q.vehicleQuickFilter && typeof q.vehicleQuickFilter === 'string') heatmapFilters.vehicleQuickFilter = q.vehicleQuickFilter;
    if (q.businessNature && typeof q.businessNature === 'string') heatmapFilters.businessNature = q.businessNature;
    if (q.isNewCar && typeof q.isNewCar === 'string') heatmapFilters.isNewCar = q.isNewCar;
    if (q.isRenewal && typeof q.isRenewal === 'string') heatmapFilters.isRenewal = q.isRenewal;

    const dimStr = typeof q.dimension === 'string' ? q.dimension : 'org_level_3';
    if (!VALID_HEATMAP_DIMENSIONS.has(dimStr)) {
      throw new AppError(400, `无效维度: ${dimStr}`);
    }
    const dimension = dimStr as HeatmapGroupDimension;

    // dateField: 保费时间轴（累计口径下恒为 insurance_start_date，保留参数兼容）
    const dateField = typeof q.dateField === 'string' ? q.dateField : 'insurance_start_date';
    // claimsDateField: 赔案纳入字段（默认 report_time 报案时间）
    const claimsDateField = (typeof q.claimsDateField === 'string' ? q.claimsDateField : 'report_time') as ClaimsDateField;

    // policyYear: 保单年度（insurance_start_date 年份）；未提供或非法 → SQL 端取 max_date 所在年
    let policyYear: number | undefined;
    if (typeof q.policyYear === 'string' && q.policyYear.length > 0) {
      const parsed = Number.parseInt(q.policyYear, 10);
      if (!Number.isInteger(parsed) || parsed < 2020 || parsed > 2030) {
        throw new AppError(400, `无效 policyYear: ${q.policyYear}`);
      }
      policyYear = parsed;
    }

    // customCutoffs: 自定义 cutoff（YYYY-MM-DD,...）；提供时跳过自动月末/周六生成
    let customCutoffs: string[] | undefined;
    if (typeof q.customCutoffs === 'string' && q.customCutoffs.length > 0) {
      const parts = q.customCutoffs.split(',').map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        if (!isValidDateFormat(p)) {
          throw new AppError(400, `customCutoffs 含非法日期: ${p}`);
        }
      }
      if (parts.length > 24) {
        throw new AppError(400, `customCutoffs 最多 24 个，收到 ${parts.length}`);
      }
      customCutoffs = parts;
    }

    const sql = generateClaimsHeatmapQuery(heatmapFilters, dimension, dateField, claimsDateField, policyYear, customCutoffs);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

export default router;
