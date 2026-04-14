/**
 * 续保宇宙分析路由（V2）
 *
 * 数据源：RenewalUniverse VIEW（ETL 预计算扁平表）
 * 端点：/api/query/renewal-v2/*
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, isValidDateFormat, createDomainMiddleware } from './shared.js';
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
  generateMetadataQuery,
  type RenewalUniverseFilters,
  type DrillStep,
} from '../../sql/renewal-universe.js';

const router = Router();

// 集中式惰性域加载中间件（per MAT-01）：RenewalUniverse
router.use(createDomainMiddleware('RenewalUniverse'));

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
  isTransfer: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  vehicleQuickFilter: z.enum(['home_car', 'truck_1t', 'truck_2_9t', 'motorcycle', 'truck_1_2t', 'rental']).optional(),
  businessNature: z.enum(['commercial', 'non_commercial']).optional(),
  coverageCombination: z.string().max(20).optional(),
  insuranceGrade: z.string().max(10).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(20),
  groupBy: z.enum(['org', 'salesman', 'category', 'grade', 'coverage', 'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing']).default('org'),
  /** 下钻路径 JSON 字符串，格式 [{"dimension":"org","value":"乐山"}] */
  drillPath: z.string().optional(),
});

const VALID_DRILL_DIMENSIONS = new Set(['org', 'salesman', 'category', 'grade', 'coverage', 'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing']);

function parseDrillPath(raw: string | undefined): DrillStep[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .filter((s: any) => s && typeof s.dimension === 'string' && typeof s.value === 'string' && VALID_DRILL_DIMENSIONS.has(s.dimension))
      .slice(0, 10) as DrillStep[]; // 最多 10 层防滥用
  } catch {
    return undefined;
  }
}

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
  const drillPath = parseDrillPath(filters.drillPath as unknown as string | undefined);
  return { ...filters, drillPath } as RenewalUniverseFilters;
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
    const perm = req.permissionFilter || '1=1';
    const [totalRows, groupedRows] = await Promise.all([
      duckdbService.query(generateOverviewTotalQuery(filters, perm)),
      duckdbService.query(generateOverviewQuery(filters, perm)),
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
    const perm = req.permissionFilter || '1=1';
    const data = await duckdbService.query(generateTrendQuery(filters, perm));
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
    const perm = req.permissionFilter || '1=1';
    const [funnelRows, lossRows] = await Promise.all([
      duckdbService.query(generateFunnelQuery(filters, perm)),
      duckdbService.query(generateLossReasonQuery(filters, perm)),
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
    const perm = req.permissionFilter || '1=1';
    const [lossRows, gainRows] = await Promise.all([
      duckdbService.query(generateCompetitionLossQuery(filters, perm)),
      duckdbService.query(generateCompetitionGainQuery(filters, perm)),
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
    const perm = req.permissionFilter || '1=1';
    const [dataRows, countRows] = await Promise.all([
      duckdbService.query(generateActionListQuery(filters, perm)),
      duckdbService.query<{ total_count: number }>(generateActionListCountQuery(filters, perm)),
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

// ── 元数据 ──

/**
 * GET /api/query/renewal-v2/metadata
 * 返回续保宇宙元数据：数据截止日、应续年份、统计摘要
 */
router.get(
  '/renewal-v2/metadata',
  asyncHandler(async (req, res) => {
    const perm = req.permissionFilter || '1=1';
    const rows = await duckdbService.query(generateMetadataQuery(perm));
    res.json({ success: true, data: rows[0] ?? null });
  })
);

export default router;
