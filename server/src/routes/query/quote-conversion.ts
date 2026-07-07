/**
 * 报价转化分析路由
 *
 * 数据源：QuoteConversion 视图（报价 Parquet）
 * 端点：/api/query/quote-conversion/*
 */

import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, isValidDateFormat, createDomainMiddleware, withRouteCache, parseFiltersAndBuildWhere } from './shared.js';
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
  riskGrade: optionalEnumSchema(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'X']),
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

/**
 * 共享 parser（parseFiltersAndBuildWhere）里 QuoteConversion 视图不支持的通用参数
 * （BACKLOG 8f71c0/96e597 · 2026-06-27 山西 13 账号验证撞出，与省份无关）：
 *   - startDate/endDate 默认按 policy_date 注入日期条件，而 QuoteConversion 视图无该列
 *     → DuckDB Binder Error → HTTP 400「列不存在：policy_date」（duckdb-error-classifier）；
 *     处理：先映射为本域自有 dateStart/dateEnd（quote_time 口径，域内已有值优先），再从
 *     共享 parser 副本剥离 —— 保留调用方「时间窗」意图，不静默丢弃。
 *   - renewalModes/isRenewal/isNewCar/isRenewable/isCrossSell/isCommercialInsure：
 *     对应列（renewal_mode/is_renewal/is_new_car/is_renewable/is_cross_sell/
 *     is_commercial_insure）在本视图不存在 → 防御性剥离（与 cross-sell sanitizeAggQuery
 *     同款模式，不做语义映射）。
 *   - isNev/isTransfer/fuelCategory：本视图 is_nev/is_transfer 是 VARCHAR（'是'/'否'），
 *     共享 parser 注入 `is_nev = true` 等 BOOLEAN 比较会类型冲突 → 剥离；新能源/过户
 *     筛选走本域自有 isNewEnergy/isTransferred 参数（parseFilters 从原始 query 消费）。
 *
 * 🔒 RLS 不变量：净化只作用于用户 query 参数维度，不触碰 permissionFilter 通道——
 * buildWhereFromFilterParams 把 requirePermissionFilter(req.permissionFilter) 独立 AND 到
 * WHERE 尾部（filter-params.ts），org_level_3/branch_code/is_telemarketing 三个 RLS 列
 * 本视图均真实存在且不在剥离清单内，权限隔离不受净化影响。
 */
const QUOTE_UNSUPPORTED_COMMON_PARAMS = [
  'startDate', 'endDate', 'dateField',
  'renewalModes',
  'isRenewal', 'isNewCar', 'isRenewable', 'isCrossSell', 'isCommercialInsure',
  'isNev', 'isTransfer', 'fuelCategory',
] as const;

/**
 * 构造本域生效查询（净化副本模式，不修改 req.query）：
 *   - domainQuery：startDate/endDate → dateStart/dateEnd（quote_time 口径）后交 parseFilters；
 *   - commonQuery：剥离视图不支持参数后交 parseFiltersAndBuildWhere（防 Binder Error）。
 */
export function buildQuoteEffectiveQuery(query: Request['query']): {
  domainQuery: Request['query'];
  commonQuery: Request['query'];
} {
  const domainQuery = { ...query };
  // 空串视同缺省（quoteFilterSchema 的 preprocess 亦把空串归一为 undefined），避免
  // 前端置空 dateStart='' 时映射被跳过而 startDate 又被剥离 → 时间窗静默丢失
  const dateStartAbsent = domainQuery.dateStart === undefined || domainQuery.dateStart === '';
  const dateEndAbsent = domainQuery.dateEnd === undefined || domainQuery.dateEnd === '';
  if (typeof query.startDate === 'string' && query.startDate !== '' && dateStartAbsent) {
    domainQuery.dateStart = query.startDate;
  }
  if (typeof query.endDate === 'string' && query.endDate !== '' && dateEndAbsent) {
    domainQuery.dateEnd = query.endDate;
  }
  const commonQuery = { ...domainQuery };
  for (const key of QUOTE_UNSUPPORTED_COMMON_PARAMS) {
    delete commonQuery[key];
  }
  // vehicleQuickFilter：dump/tractor/general 依赖 vehicle_model 列（本视图无）→ 剥离；
  // 其余取值仅用 customer_category/tonnage_segment（本视图均有）→ 透传
  const vqf = commonQuery.vehicleQuickFilter;
  if (vqf === 'dump' || vqf === 'tractor' || vqf === 'general') {
    delete commonQuery.vehicleQuickFilter;
  }
  return { domainQuery, commonQuery };
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
    const { domainQuery, commonQuery } = buildQuoteEffectiveQuery(req.query);
    const filters = parseFilters(domainQuery);
    const { whereClause } = parseFiltersAndBuildWhere(req, commonQuery);
    const sql = generateQuoteKpiQuery(filters, whereClause);
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
    const { domainQuery, commonQuery } = buildQuoteEffectiveQuery(req.query);
    const filters = parseFilters(domainQuery);
    const { whereClause } = parseFiltersAndBuildWhere(req, commonQuery);
    const sql = generateQuoteFunnelQuery(filters, whereClause);
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
    const { domainQuery, commonQuery } = buildQuoteEffectiveQuery(req.query);
    const filters = parseFilters(domainQuery);
    const { whereClause } = parseFiltersAndBuildWhere(req, commonQuery);
    const sql = generateQuoteDrilldownQuery(filters, level, whereClause);
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
    const { domainQuery, commonQuery } = buildQuoteEffectiveQuery(req.query);
    const filters = parseFilters(domainQuery);
    const { whereClause } = parseFiltersAndBuildWhere(req, commonQuery);
    const colDimension = (req.query.colDimension as string) ?? '续保情况';
    const sql = generateQuoteHeatmapQuery(filters, colDimension, whereClause);
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
    const { domainQuery, commonQuery } = buildQuoteEffectiveQuery(req.query);
    const filters = parseFilters(domainQuery);
    const { whereClause } = parseFiltersAndBuildWhere(req, commonQuery);
    const sql = generateQuotePriceQuery(filters, whereClause);
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
    const { domainQuery, commonQuery } = buildQuoteEffectiveQuery(req.query);
    const filters = parseFilters(domainQuery);
    const { whereClause } = parseFiltersAndBuildWhere(req, commonQuery);
    const dimension = (req.query.dimension as string) ?? '客户类别';
    const sql = generateQuoteRankingQuery(filters, dimension, whereClause);
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
    const { domainQuery, commonQuery } = buildQuoteEffectiveQuery(req.query);
    const filters = parseFilters(domainQuery);
    const { whereClause } = parseFiltersAndBuildWhere(req, commonQuery);
    const granularity = parseEnumParam(req.query.granularity, ['day', 'week', 'month'], 'granularity', 'week') as 'day' | 'week' | 'month';
    const sql = generateQuoteTrendQuery(filters, granularity, whereClause);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data, granularity });
  })
);

export default router;
