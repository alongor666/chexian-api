/**
 * 销售队伍业绩路由 — /api/query/sales-team-performance
 *
 * 数据源：SalesTeamPerformanceFact（惰性加载；山西直营标保明细，
 * 口径 SSOT = 数据管理/pipelines/sales_team_rules.sql，见 sales_portrait ADR-006）。
 *
 * 权限：视图无 org_level_3/branch_code/is_telemarketing 标准 RLS 列（中文原样 schema），
 * 且属队伍考核敏感数据 → requireBranchAdmin admin-only（与 customer-flow 等域既定
 * 兜底模式一致，见 shared.ts 该中间件注释）。后续如需对 org_user 开放，
 * 需先在 ETL 派生标准 RLS 列再改造。
 */

import { Router } from 'express';
import {
  asyncHandler,
  AppError,
  duckdbService,
  isValidDateFormat,
  QUERY_CACHE,
  HTTP_MAX_AGE,
  sendWithEtag,
  createDomainMiddleware,
  withRouteCache,
  requireBranchAdmin,
} from './shared.js';
import {
  generateSalesTeamPerformanceQuery,
  generateSalesTeamPerformanceTotalQuery,
  SALES_TEAM_DIMENSIONS,
  type SalesTeamDimension,
} from '../../sql/sales-team-performance.js';

const router = Router();

// 惰性加载 SalesTeamPerformance 域（首次访问触发）
router.use(createDomainMiddleware('SalesTeamPerformance'));

/**
 * GET /api/query/sales-team-performance
 *
 * Query params:
 *   dimension (salesman|team|org|insurance_class) 可选，默认 salesman
 *   start     (YYYY-MM-DD) 可选 — 承保确认时间范围起
 *   end       (YYYY-MM-DD) 可选 — 承保确认时间范围止
 *   limit     (int, 1~10000) 可选，默认 200
 */
router.get(
  '/sales-team-performance',
  requireBranchAdmin,
  withRouteCache('sales-team-performance'),
  asyncHandler(async (req, res) => {
    const dimensionRaw = typeof req.query.dimension === 'string' ? req.query.dimension : 'salesman';
    if (!Object.prototype.hasOwnProperty.call(SALES_TEAM_DIMENSIONS, dimensionRaw)) {
      throw new AppError(
        400,
        `Invalid 'dimension' (expected one of: ${Object.keys(SALES_TEAM_DIMENSIONS).join(', ')})`
      );
    }
    const dimension = dimensionRaw as SalesTeamDimension;

    const { start, end } = req.query;
    if (start !== undefined && (typeof start !== 'string' || !isValidDateFormat(start))) {
      throw new AppError(400, `Invalid 'start' (expected YYYY-MM-DD)`);
    }
    if (end !== undefined && (typeof end !== 'string' || !isValidDateFormat(end))) {
      throw new AppError(400, `Invalid 'end' (expected YYYY-MM-DD)`);
    }
    if (typeof start === 'string' && typeof end === 'string' && start > end) {
      throw new AppError(400, `'start' must be <= 'end'`);
    }

    let limit: number | undefined;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
        throw new AppError(400, `Invalid 'limit' (expected integer 1~10000)`);
      }
    }

    const rowsSql = generateSalesTeamPerformanceQuery({
      dimension,
      start: start as string | undefined,
      end: end as string | undefined,
      limit,
    });
    const rows = await duckdbService.query<{
      dim_value: string;
      policy_count: number;
      received_premium: number;
      standard_premium: number;
    }>(rowsSql, QUERY_CACHE.hotspotShort);

    const totalSql = generateSalesTeamPerformanceTotalQuery({
      start: start as string | undefined,
      end: end as string | undefined,
    });
    const totals = await duckdbService.query<{
      policy_count: number;
      received_premium: number;
      standard_premium: number;
      latest_confirm_date: string | null;
    }>(totalSql, QUERY_CACHE.hotspotShort);

    // 数值规范化（DuckDB BIGINT 可能返回 BigInt）
    const normalizedRows = rows.map(r => ({
      dim_value: r.dim_value,
      policy_count: Number(r.policy_count) || 0,
      received_premium: Number(r.received_premium) || 0,
      standard_premium: Number(r.standard_premium) || 0,
    }));
    const t = totals[0];
    const normalizedTotal = t
      ? {
          policy_count: Number(t.policy_count) || 0,
          received_premium: Number(t.received_premium) || 0,
          standard_premium: Number(t.standard_premium) || 0,
          latest_confirm_date: t.latest_confirm_date ?? null,
        }
      : null;

    sendWithEtag(
      req,
      res,
      {
        success: true,
        data: {
          dimension,
          rows: normalizedRows,
          total: normalizedTotal,
        },
      },
      HTTP_MAX_AGE.query
    );
  })
);

export default router;
