/**
 * 报价转化分析路由
 *
 * 数据源：QuoteConversion 视图（报价 Parquet）
 * 端点：/api/query/quote-conversion/*
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, isValidDateFormat } from './shared.js';
import {
  generateQuoteKpiQuery,
  generateQuoteFunnelQuery,
  generateQuoteDrilldownQuery,
  generateQuoteHeatmapQuery,
  generateQuotePriceQuery,
  generateQuoteRankingQuery,
  generateQuoteTrendQuery,
  type QuoteConversionFilters,
} from '../../sql/quote-conversion.js';

const router = Router();

/**
 * 中间件：确保 QuoteConversion 视图已加载
 */
router.use(
  asyncHandler(async (_req, _res, next) => {
    try {
      await duckdbService.query('SELECT 1 FROM QuoteConversion LIMIT 1');
      next();
    } catch {
      throw new AppError(503, '报价转化数据未加载，请确认 quotes_conversion/*.parquet 文件存在并重启服务');
    }
  })
);

const quoteFilterSchema = z.object({
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
  renewalType: z.enum(['续保', '转保']).optional(),
  orgName: z.string().optional(),
  teamName: z.string().optional(),
  salesmanNo: z.string().optional(),
  customerCategory: z.string().optional(),
  insuranceCombo: z.enum(['主全', '交三']).optional(),
});

function parseFilters(query: Record<string, unknown>): QuoteConversionFilters {
  const result = quoteFilterSchema.safeParse(query);
  if (!result.success) {
    throw new AppError(400, result.error.issues[0].message);
  }
  const filters = result.data;
  if (filters.dateStart && !isValidDateFormat(filters.dateStart)) {
    throw new AppError(400, 'dateStart 格式无效，需 YYYY-MM-DD');
  }
  if (filters.dateEnd && !isValidDateFormat(filters.dateEnd)) {
    throw new AppError(400, 'dateEnd 格式无效，需 YYYY-MM-DD');
  }
  return filters;
}

/**
 * GET /api/query/quote-conversion/kpi
 * KPI 概览卡片
 */
router.get(
  '/quote-conversion/kpi',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateQuoteKpiQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data: data[0] ?? {} });
  })
);

/**
 * GET /api/query/quote-conversion/funnel
 * 转化漏斗（续保/转保分开）
 */
router.get(
  '/quote-conversion/funnel',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateQuoteFunnelQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/quote-conversion/drilldown
 * 三级下钻表：机构 → 团队 → 业务员
 */
router.get(
  '/quote-conversion/drilldown',
  asyncHandler(async (req, res) => {
    const levelSchema = z.enum(['org', 'team', 'salesman']).default('org');
    const level = levelSchema.parse(req.query.level ?? 'org');
    const filters = parseFilters(req.query);
    const sql = generateQuoteDrilldownQuery(filters, level);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data, level });
  })
);

/**
 * GET /api/query/quote-conversion/heatmap
 * 维度热力图
 */
router.get(
  '/quote-conversion/heatmap',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const colDimension = (req.query.colDimension as string) ?? '续保情况';
    const sql = generateQuoteHeatmapQuery(filters, colDimension);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data, colDimension });
  })
);

/**
 * GET /api/query/quote-conversion/price
 * 价格敏感度分析
 */
router.get(
  '/quote-conversion/price',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateQuotePriceQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/quote-conversion/ranking
 * 多维度排行
 */
router.get(
  '/quote-conversion/ranking',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const dimension = (req.query.dimension as string) ?? '客户类别';
    const sql = generateQuoteRankingQuery(filters, dimension);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data, dimension });
  })
);

/**
 * GET /api/query/quote-conversion/trend
 * 时间趋势
 */
router.get(
  '/quote-conversion/trend',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const granSchema = z.enum(['day', 'week', 'month']).default('week');
    const granularity = granSchema.parse(req.query.granularity ?? 'week');
    const sql = generateQuoteTrendQuery(filters, granularity);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data, granularity });
  })
);

export default router;
