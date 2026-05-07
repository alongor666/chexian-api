/**
 * 承保地理分布路由
 *
 * GET /api/query/policy-geo/province  — 省级聚合
 * GET /api/query/policy-geo/city      — 城市级聚合（可选 ?province=四川）
 */

import { Router } from 'express';
import { asyncHandler, AppError, duckdbService, sendWithEtag, QUERY_CACHE, HTTP_MAX_AGE, parseFiltersAndBuildWhere, withRouteCache } from './shared.js';
import { generatePolicyGeoProvinceQuery, generatePolicyGeoCityQuery } from '../../sql/policy-geo.js';
import type { PolicyGeoFilters } from '../../sql/policy-geo.js';

/** 省份名允许 1-20 个中文字符或字母 */
const PROVINCE_RE = /^[\u4e00-\u9fa5a-zA-Z]{1,20}$/;

const router = Router();

/**
 * GET /api/query/policy-geo/province
 * 按车牌归属地聚合到省级
 */
router.get(
  '/policy-geo/province',
  withRouteCache('policy-geo-province'),
  asyncHandler(async (req, res) => {
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const filters: PolicyGeoFilters = { whereClause };
    const sql = generatePolicyGeoProvinceQuery(filters);
    const data = await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

    sendWithEtag(req, res, {
      success: true,
      data,
    }, HTTP_MAX_AGE.query);
  })
);

/**
 * GET /api/query/policy-geo/city
 * 按车牌归属地聚合到城市级
 * 可选查询参数: province — 筛选到某省（如 "四川"）
 */
router.get(
  '/policy-geo/city',
  withRouteCache('policy-geo-city'),
  asyncHandler(async (req, res) => {
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const rawProvince = typeof req.query.province === 'string' ? req.query.province : undefined;
    if (rawProvince !== undefined && !PROVINCE_RE.test(rawProvince)) {
      throw new AppError(400, 'province 参数格式无效');
    }
    const filters: PolicyGeoFilters = { whereClause, province: rawProvince };
    const sql = generatePolicyGeoCityQuery(filters);
    const data = await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

    sendWithEtag(req, res, {
      success: true,
      data,
    }, HTTP_MAX_AGE.query);
  })
);

export default router;
