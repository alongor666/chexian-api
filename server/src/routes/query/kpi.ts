import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler, AppError, duckdbService, sendWithEtag, QUERY_CACHE, HTTP_MAX_AGE, parseFiltersAndBuildWhere, parseFiltersAndBuildBothWhere, extractOrgNames, extractSalesmanNames, createDomainMiddleware, withRouteCache } from './shared.js';
import { generateKpiQuery } from '../../sql/kpi.js';
import { generateKpiDetailQuery } from '../../sql/kpi-detail.js';
import { RouteConcurrencyGate } from '../../services/route-concurrency.js';

const router = Router();
const KPI_COLD_QUERY_GATE = new RouteConcurrencyGate({
  limit: Number(process.env.KPI_COLD_QUERY_CONCURRENCY) || 6,
  maxQueue: Number(process.env.KPI_COLD_QUERY_MAX_QUEUE) || 64,
  queueTimeoutMs: Number(process.env.KPI_COLD_QUERY_QUEUE_TIMEOUT_MS) || 60_000,
});

function kpiColdQueryGate() {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const abortController = new AbortController();
    let release: (() => void) | null = null;
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      release?.();
    };
    const handleClose = () => {
      abortController.abort();
      releaseOnce();
    };

    res.once('close', handleClose);

    try {
      release = await KPI_COLD_QUERY_GATE.enter({ signal: abortController.signal });
      if (abortController.signal.aborted || res.destroyed || res.writableEnded) {
        releaseOnce();
        return;
      }
      res.once('finish', releaseOnce);
      next();
    } catch (err) {
      res.off('close', handleClose);
      if (abortController.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      next(new AppError(429, message));
    }
  };
}

/**
 * GET /api/query/kpi
 * 获取KPI数据（保费、件数、占比等）
 * 支持完整高级筛选参数
 */
router.get(
  '/kpi',
  withRouteCache('kpi', QUERY_CACHE.hotspotShort),
  kpiColdQueryGate(),
  createDomainMiddleware('ClaimsAgg'),
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
