import { Router } from 'express';
import { asyncHandler, duckdbService, sendWithEtag, parseFiltersAndBuildWhere, parseFiltersAndBuildBothWhere, extractOrgNames, extractSalesmanNames } from './shared.js';
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
    // KPI 高频查询，缓存 120 秒
    const result = await duckdbService.query(sql, 120_000);

    sendWithEtag(req, res, {
      success: true,
      data: result[0] || {},
    }, 30);
  })
);

/**
 * GET /api/query/kpi-detail
 * 获取 KPI 详细数据（用于占比类指标的分解数据，支持迷你环形图）
 */
router.get(
  '/kpi-detail',
  asyncHandler(async (req, res) => {
    const { whereClause } = parseFiltersAndBuildWhere(req);

    const sql = generateKpiDetailQuery(whereClause, false);
    // KPI 详情高频查询，缓存 120 秒
    const result = await duckdbService.query(sql, 120_000);

    sendWithEtag(req, res, {
      success: true,
      data: result[0] || {},
    }, 30);
  })
);

export default router;
