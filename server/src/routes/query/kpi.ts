import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler, AppError, duckdbService, sendWithEtag, QUERY_CACHE, HTTP_MAX_AGE, parseFiltersAndBuildWhere, parseFiltersAndBuildBothWhere, extractOrgNames, extractSalesmanNames, createDomainMiddleware, withRouteCache } from './shared.js';
import { generateKpiQuery } from '../../sql/kpi.js';
import { generateKpiDetailQuery } from '../../sql/kpi-detail.js';
import { RouteConcurrencyGate } from '../../services/route-concurrency.js';
import { dbEnv } from '../../config/env.js';
import { isKpiCostCubeServable, generateKpiCostCubeQuery } from '../../sql/cube/kpi-cost-cube.js';
import { ensureCostCubeFresh } from '../../services/duckdb-cube.js';
import { runShadowCompare } from '../../services/cube-shadow.js';

/** KPI 主 SQL 接口的 cost 三项输出列（注册表表达式直接定义的别名） */
const KPI_COST_COLUMNS = ['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'] as const;

/**
 * KPI 路由的成本立方体接线（第四批次，BACKLOG uid=2026-06-11-claude-90a92c）。
 * 双开关默认全关时零生效。
 *
 * routing 模式（CUBE_ROUTING_ENABLED）：
 *   主 SQL 携 excludeVariableCost=true（去掉 260 万行 variable_cost CTE 的 P95 大头）
 *   + 立方体单行 SQL，并行跑后 merge cost 三项。
 *
 * shadow 模式（CUBE_SHADOW_COMPARE）：
 *   原 KPI 主 SQL 不变；后台双跑立方体 SQL 比对 cost 三项。
 *
 * 三态返回：
 *   { mode: 'routing', mainSql, cubeSql }   handler 应并行跑两条 SQL 后 merge
 *   { mode: 'shadow', cubeSql }             handler 跑原 mainSql，shadow 跑 cube
 *   null                                     未开关 / 不可服务 / 未就绪 / 探针降级
 */
function planKpiCostCube(
  whereWithDate: string,
  dateField: string
): { mode: 'routing'; cubeSql: string } | { mode: 'shadow'; cubeSql: string } | null {
  const cubeRouting = dbEnv.CUBE_ROUTING_ENABLED === 'true';
  const cubeShadow = dbEnv.CUBE_SHADOW_COMPARE === 'true';
  if (!cubeRouting && !cubeShadow) return null;
  if (!isKpiCostCubeServable({ whereClause: whereWithDate, dateField }).servable) return null;
  if (ensureCostCubeFresh(duckdbService) !== 'ready') return null;

  const cubeSql = generateKpiCostCubeQuery(whereWithDate);
  return cubeRouting ? { mode: 'routing', cubeSql } : { mode: 'shadow', cubeSql };
}

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

    const plan = planKpiCostCube(whereWithDate, dateField);
    const mainSql = generateKpiQuery(
      whereWithDate,
      { orgNames, salesmanNames },
      whereWithoutDate,
      dateField,
      plan?.mode === 'routing'
    );

    let rowData: Record<string, unknown> = {};
    if (plan?.mode === 'routing') {
      const [mainRows, cubeRows] = await Promise.all([
        duckdbService.query(mainSql, QUERY_CACHE.hotspotShort),
        duckdbService.query(plan.cubeSql, QUERY_CACHE.hotspotShort),
      ]);
      // merge：主 SQL 已不含 cost 三项，立方体单行补齐
      rowData = { ...(mainRows[0] || {}), ...(cubeRows[0] || {}) };
    } else {
      const mainRows = await duckdbService.query(mainSql, QUERY_CACHE.hotspotShort);
      rowData = mainRows[0] || {};
      if (plan?.mode === 'shadow') {
        // 影子对账：只比 cost 三项，不比整行（其余指标走主路径与立方体无关）
        const legacyCostRow: Record<string, unknown> = {};
        for (const col of KPI_COST_COLUMNS) legacyCostRow[col] = rowData[col];
        runShadowCompare('kpi', [legacyCostRow], async () => {
          const cubeRows = await duckdbService.query(plan.cubeSql);
          return cubeRows.length > 0 ? [cubeRows[0]] : [];
        });
      }
    }

    sendWithEtag(req, res, {
      success: true,
      data: rowData,
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
