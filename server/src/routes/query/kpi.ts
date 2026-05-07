import { Router } from 'express';
import { asyncHandler, duckdbService, sendWithEtag, QUERY_CACHE, HTTP_MAX_AGE, parseFiltersAndBuildWhere, parseFiltersAndBuildBothWhere, extractOrgNames, extractSalesmanNames, withRouteCache } from './shared.js';
import { generateKpiQuery } from '../../sql/kpi.js';
import { generateKpiDetailQuery } from '../../sql/kpi-detail.js';

const router = Router();

/**
 * GET /api/query/kpi
 * 获取KPI数据（保费、件数、占比等）
 * 支持完整高级筛选参数
 */
router.get(
  '/kpi',
  withRouteCache('kpi', QUERY_CACHE.hotspotShort),
  asyncHandler(async (req, res) => {
    const { filterData, whereWithDate, whereWithoutDate, dateField } = parseFiltersAndBuildBothWhere(req);

    const orgNames = extractOrgNames(filterData, req.permissionFilter);
    const salesmanNames = extractSalesmanNames(filterData, req.permissionFilter);

    const sql = generateKpiQuery(
      whereWithDate,
      { orgNames, salesmanNames },
      whereWithoutDate,
      dateField
    );
    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    sendWithEtag(req, res, {
      success: true,
      data: result[0] || {},
    }, HTTP_MAX_AGE.query);
  })
);

/**
 * GET /api/query/kpi-detail
 * 获取 KPI 详细数据（用于占比类指标的分解数据，支持迷你环形图）
 */
router.get(
  '/kpi-detail',
  withRouteCache('kpi-detail', QUERY_CACHE.hotspotShort),
  asyncHandler(async (req, res) => {
    const { whereClause } = parseFiltersAndBuildWhere(req);

    const sql = generateKpiDetailQuery(whereClause, false);
    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    sendWithEtag(req, res, {
      success: true,
      data: result[0] || {},
    }, HTTP_MAX_AGE.query);
  })
);

export default router;
