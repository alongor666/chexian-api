/**
 * 续保宇宙分析路由（V2）
 *
 * 数据源：RenewalUniverse VIEW（ETL 预计算扁平表）
 * 端点：/api/query/renewal-v2/*
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, isValidDateFormat } from './shared.js';
import {
  generateOverviewQuery,
  generateOverviewTotalQuery,
  generateTrendQuery,
  generateFunnelQuery,
  generateLossReasonQuery,
  generateCompetitionLossQuery,
  generateCompetitionGainQuery,
  generateActionListQuery,
  generateActionListCountQuery,
  type RenewalUniverseFilters,
} from '../../sql/renewal-universe.js';

const router = Router();

// ── VIEW 存在性中间件 ──

router.use(
  asyncHandler(async (_req, _res, next) => {
    try {
      await duckdbService.query('SELECT 1 FROM RenewalUniverse LIMIT 1');
      next();
    } catch {
      throw new AppError(503, '续保宇宙数据未加载，请确认 renewal_universe/latest.parquet 文件存在并重启服务');
    }
  })
);

// ── Zod Schema ──

const renewalV2Schema = z.object({
  orgName: z.string().max(255).optional(),
  salesmanName: z.string().max(255).optional(),
  customerCategory: z.string().max(50).optional(),
  expiryMonth: z.coerce.number().int().min(1).max(12).optional(),
  expiryDateStart: z.string().optional(),
  expiryDateEnd: z.string().optional(),
  funnelStage: z.enum(['renewed', 'quoted_not_renewed', 'not_quoted']).optional(),
  actionPriority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  isNewCar: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  isNev: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  insuranceGrade: z.string().max(10).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(20),
  groupBy: z.enum(['org', 'salesman', 'category', 'grade']).default('org'),
});

function parseFilters(query: Record<string, unknown>): RenewalUniverseFilters {
  const result = renewalV2Schema.safeParse(query);
  if (!result.success) {
    throw new AppError(400, result.error.issues[0].message);
  }
  const filters = result.data;
  if (filters.expiryDateStart && !isValidDateFormat(filters.expiryDateStart)) {
    throw new AppError(400, 'expiryDateStart 格式无效，需 YYYY-MM-DD');
  }
  if (filters.expiryDateEnd && !isValidDateFormat(filters.expiryDateEnd)) {
    throw new AppError(400, 'expiryDateEnd 格式无效，需 YYYY-MM-DD');
  }
  return filters;
}

// ── Tab 1: 续保总览 ──

/**
 * GET /api/query/renewal-v2/overview
 * 返回 KPI 汇总 + 按维度分组排名
 */
router.get(
  '/renewal-v2/overview',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const [totalRows, groupedRows] = await Promise.all([
      duckdbService.query(generateOverviewTotalQuery(filters)),
      duckdbService.query(generateOverviewQuery(filters)),
    ]);
    res.json({
      success: true,
      data: {
        total: totalRows[0] ?? null,
        grouped: groupedRows,
      },
    });
  })
);

/**
 * GET /api/query/renewal-v2/trend
 * 月度到期走势
 */
router.get(
  '/renewal-v2/trend',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const data = await duckdbService.query(generateTrendQuery(filters));
    res.json({ success: true, data });
  })
);

// ── Tab 2: 转化漏斗 ──

/**
 * GET /api/query/renewal-v2/funnel
 * 漏斗汇总 + 流失归因
 */
router.get(
  '/renewal-v2/funnel',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const [funnelRows, lossRows] = await Promise.all([
      duckdbService.query(generateFunnelQuery(filters)),
      duckdbService.query(generateLossReasonQuery(filters)),
    ]);
    res.json({
      success: true,
      data: {
        funnel: funnelRows,
        lossReason: lossRows,
      },
    });
  })
);

// ── Tab 3: 竞争格局 ──

/**
 * GET /api/query/renewal-v2/competition
 * 竞争流失去向 + 转入来源
 */
router.get(
  '/renewal-v2/competition',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const [lossRows, gainRows] = await Promise.all([
      duckdbService.query(generateCompetitionLossQuery(filters)),
      duckdbService.query(generateCompetitionGainQuery(filters)),
    ]);
    res.json({
      success: true,
      data: {
        loss: lossRows,
        gain: gainRows,
      },
    });
  })
);

// ── Tab 4: 行动看板 ──

/**
 * GET /api/query/renewal-v2/action
 * 待办清单（分页） — data + count 并行执行
 */
router.get(
  '/renewal-v2/action',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const [dataRows, countRows] = await Promise.all([
      duckdbService.query(generateActionListQuery(filters)),
      duckdbService.query<{ total_count: number }>(generateActionListCountQuery(filters)),
    ]);
    const totalCount = countRows[0]?.total_count ?? 0;
    res.json({
      success: true,
      data: dataRows,
      meta: {
        total: totalCount,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
      },
    });
  })
);

export default router;
