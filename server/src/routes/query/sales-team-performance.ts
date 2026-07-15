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
import { z } from 'zod';
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
  SALES_TEAM_DIMENSION_IDS,
} from '../../sql/sales-team-performance.js';

const router = Router();

const optionalNaturalDate = (label: string) => z.string().refine(isValidDateFormat, {
  message: `${label}必须是有效自然日（YYYY-MM-DD）`,
}).optional();

/** 运行时参数契约；route-param-contracts 直接复用，避免目录枚举与 handler 漂移。 */
export const salesTeamPerformanceQuerySchema = z.object({
  dimension: z.enum(SALES_TEAM_DIMENSION_IDS).default('salesman'),
  start: optionalNaturalDate('开始日期'),
  end: optionalNaturalDate('结束日期'),
  limit: z.coerce.number().int('返回行数必须是整数').min(1, '返回行数不能小于 1').max(10000, '返回行数不能超过 10000').default(200),
});

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
  // 权限校验必须先于磁盘探测/惰性加载，未授权请求不得触发域 I/O。
  createDomainMiddleware('SalesTeamPerformance'),
  withRouteCache('sales-team-performance'),
  asyncHandler(async (req, res) => {
    const parsed = salesTeamPerformanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, `参数错误：${parsed.error.issues[0]?.message ?? '请求参数无效'}`);
    }
    const { dimension, start, end, limit } = parsed.data;
    if (start && end && start > end) {
      throw new AppError(400, '开始日期不能晚于结束日期');
    }

    const rowsSql = generateSalesTeamPerformanceQuery({
      dimension,
      start,
      end,
      limit,
    });
    const rows = await duckdbService.query<{
      dim_value: string;
      sales_team_row_count: number;
      received_premium: number;
      standard_premium: number;
    }>(rowsSql, QUERY_CACHE.hotspotShort);

    const totalSql = generateSalesTeamPerformanceTotalQuery({
      start,
      end,
    });
    const totals = await duckdbService.query<{
      sales_team_row_count: number;
      received_premium: number;
      standard_premium: number;
      latest_confirm_date: string | null;
    }>(totalSql, QUERY_CACHE.hotspotShort);

    // 数值规范化（DuckDB BIGINT 可能返回 BigInt）
    const normalizedRows = rows.map(r => ({
      dim_value: r.dim_value,
      sales_team_row_count: Number(r.sales_team_row_count) || 0,
      received_premium: Number(r.received_premium) || 0,
      standard_premium: Number(r.standard_premium) || 0,
    }));
    const t = totals[0];
    const normalizedTotal = t
      ? {
          sales_team_row_count: Number(t.sales_team_row_count) || 0,
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
