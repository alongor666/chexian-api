/**
 * 报价转化分析路由
 *
 * 数据源：QuoteConversion 视图（报价 Parquet）
 * 端点：/api/query/quote-conversion/*
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, isValidDateFormat, createDomainMiddleware, withRouteCache, requireBranchAdmin } from './shared.js';
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

// RLS 整域绕过紧急止血（BACKLOG 2026-06-11-claude-942414 / P0）
// 报价转化 SQL 生成器签名未预留 whereClause 入参 → 整域 admin-only。
// 长期修法：扩 7 个生成器签名 + 路由调 parseFiltersAndBuildWhere 注入。
router.use(requireBranchAdmin);

function preprocessBlankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

const optionalTextSchema = z.preprocess(preprocessBlankToUndefined, z.string().optional());
const optionalEnumSchema = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(preprocessBlankToUndefined, z.enum(values).optional());

// 集中式惰性域加载中间件（per MAT-01）：QuoteConversion
router.use(createDomainMiddleware('QuoteConversion'));

export const quoteFilterSchema = z.object({
  dateStart: optionalTextSchema,
  dateEnd: optionalTextSchema,
  renewalType: optionalEnumSchema(['续保', '转保']),
  orgName: optionalTextSchema,
  teamName: optionalTextSchema,
  salesmanNo: optionalTextSchema,
  customerCategory: optionalTextSchema,
  insuranceCombo: optionalEnumSchema(['主全', '交三']),
  isTelemarketing: optionalEnumSchema(['电销', '非电销']),
  isNewEnergy: optionalEnumSchema(['是', '否']),
  isTransferred: optionalEnumSchema(['是', '否']),
  riskGrade: optionalEnumSchema(['A', 'B', 'C', 'D']),
  ncdMin: z.preprocess(preprocessBlankToUndefined, z.coerce.number().optional()),
  ncdMax: z.preprocess(preprocessBlankToUndefined, z.coerce.number().optional()),
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
  if (filters.ncdMin !== undefined && filters.ncdMax !== undefined && filters.ncdMin > filters.ncdMax) {
    throw new AppError(400, 'ncdMin 不能大于 ncdMax');
  }
  return filters as QuoteConversionFilters;
}

function parseEnumParam<T extends [string, ...string[]]>(
  value: unknown,
  values: T,
  fieldName: string,
  defaultValue?: T[number],
): T[number] {
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new AppError(400, `${fieldName} 参数不能为空`);
  }
  const result = z.enum(values).safeParse(value);
  if (!result.success) {
    throw new AppError(400, `${fieldName} 参数无效，需 ${values.join('/')}`);
  }
  return result.data;
}

/**
 * GET /api/query/quote-conversion/kpi
 * KPI 概览卡片
 */
router.get(
  '/quote-conversion/kpi',
  withRouteCache('quote-conversion-kpi'),
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
  withRouteCache('quote-conversion-funnel'),
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
  withRouteCache('quote-conversion-drilldown'),
  asyncHandler(async (req, res) => {
    const level = parseEnumParam(req.query.level, ['org', 'team', 'salesman'], 'level', 'org') as 'org' | 'team' | 'salesman';
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
  withRouteCache('quote-conversion-heatmap'),
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
  withRouteCache('quote-conversion-price'),
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
  withRouteCache('quote-conversion-ranking'),
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
  withRouteCache('quote-conversion-trend'),
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const granularity = parseEnumParam(req.query.granularity, ['day', 'week', 'month'], 'granularity', 'week') as 'day' | 'week' | 'month';
    const sql = generateQuoteTrendQuery(filters, granularity);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data, granularity });
  })
);

export default router;
