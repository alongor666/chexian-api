/**
 * 赔案明细分析路由
 *
 * 数据源：ClaimsDetail VIEW（赔案 Parquet）+ PolicyFact（保单维度 JOIN）
 * 端点：/api/query/claims-detail/*
 */

import { Router } from 'express';
import {
  asyncHandler, AppError, duckdbService, isValidDateFormat,
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

const router = Router();

/**
 * 中间件：确保 ClaimsDetail 视图已加载
 */
router.use(
  '/claims-detail',
  asyncHandler(async (_req, _res, next) => {
    try {
      await duckdbService.query('SELECT 1 FROM ClaimsDetail LIMIT 1');
      next();
    } catch {
      throw new AppError(503, '赔案明细数据未加载，请确认 claims_detail/latest.parquet 文件存在并重启服务');
    }
  })
);

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
      : [2023, 2024, 2025];
    const sql = generateLossRatioDevelopmentQuery(filters, cohortYears);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

export default router;
