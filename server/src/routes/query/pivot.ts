/**
 * GET /api/query/pivot — 维度 × 指标 交叉聚合
 *
 * 维度走白名单（hardcoded），指标走 metric-registry（getMetricSql）。
 * 1-2 维 × 1-10 指标，LIMIT 默认 100，上限 500（防笛卡尔爆炸）。
 *
 * 安全堆叠（继承自 router 级）：
 *   authMiddleware + readonlyMiddleware + permissionMiddleware
 *
 * 权限过滤通过 parseFiltersAndBuildWhere 自动注入到 WHERE 子句。
 */
import { Router } from 'express';
import { asyncHandler, AppError, duckdbService, sendWithEtag, QUERY_CACHE, HTTP_MAX_AGE, parseFiltersAndBuildWhere, withRouteCache } from './shared.js';
import { generatePivotQuery } from '../../sql/pivot.js';
import { hasMetric, getMetric } from '../../config/metric-registry/index.js';

const router = Router();

/**
 * 判定指标是否能安全用于 pivot（FROM PolicyFact 的单层聚合）。
 *
 * pivot 把 metric.sql.expression 直接拼进 SELECT，对 PolicyFact 单层 GROUP BY。
 * 以下两类指标 hasMetric() 能过但拼进去必 Binder/Parser Error → 500：
 *   1. L4 指标：expression 是 `-- L4 ...` 纯注释占位，由 SQL 生成器动态拼接
 *      （plan_completion_pct / renewal_unquoted_count / renewal_lost_count / renewal_impact_rate）。
 *   2. 依赖外层 CTE 预算列或异源视图列：growth_rate_yoy 需 current_value/previous_value
 *      在外层 CTE 预计算；underwriting_rate 的 is_underwritten 仅存在于 QuoteConversion VIEW。
 *
 * 采保守判据（只拒确定会炸的，宁可漏判不误拒合法指标 → 不引入回归）。
 */
const NON_POLICYFACT_COLUMNS = new Set(['current_value', 'previous_value', 'is_underwritten']);

function isPivotSafeMetric(id: string): boolean {
  const metric = getMetric(id);
  if (!metric) return false;
  if (metric.sql.expression.trim().startsWith('--')) return false;
  if (metric.sql.requiredColumns.some((c) => NON_POLICYFACT_COLUMNS.has(c))) return false;
  return true;
}

/**
 * 可分组维度白名单。
 * 布尔字段用 CASE 包成可读字符串，避免 GROUP BY true/false 输出难以理解。
 */
const DIM_WHITELIST: Record<string, string> = {
  org_level_3: 'org_level_3',
  salesman_name: 'salesman_name',
  customer_category: 'customer_category',
  insurance_type: 'insurance_type',
  coverage_combination: 'coverage_combination',
  tonnage_segment: 'tonnage_segment',
  renewal_mode: 'renewal_mode',
  insurance_grade: 'insurance_grade',
  is_renewal: "CASE WHEN is_renewal THEN '续保' ELSE '新保' END",
  is_new_car: "CASE WHEN is_new_car THEN '新车' ELSE '旧车' END",
  is_nev: "CASE WHEN is_nev THEN '新能源' ELSE '非新能源' END",
  is_telemarketing: "CASE WHEN is_telemarketing THEN '电销' ELSE '非电销' END",
  is_transfer: "CASE WHEN is_transfer THEN '过户' ELSE '非过户' END",
  week_number: 'week_number',
  month_number: 'month_number',
};

const MAX_DIMENSIONS = 2;
const MAX_METRICS = 10;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseCsv(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

router.get(
  '/pivot',
  withRouteCache('pivot', QUERY_CACHE.hotspotMedium),
  asyncHandler(async (req, res) => {
    const dimNames = parseCsv(req.query.dimensions);
    if (dimNames.length < 1 || dimNames.length > MAX_DIMENSIONS) {
      throw new AppError(400, `PIVOT: dimensions 须为 1-${MAX_DIMENSIONS} 项（逗号分隔）`);
    }
    for (const d of dimNames) {
      if (!(d in DIM_WHITELIST)) {
        throw new AppError(
          400,
          `PIVOT: 不支持的维度 "${d}"。可用维度: ${Object.keys(DIM_WHITELIST).join(', ')}`
        );
      }
    }

    const metricIds = parseCsv(req.query.metrics);
    if (metricIds.length < 1 || metricIds.length > MAX_METRICS) {
      throw new AppError(400, `PIVOT: metrics 须为 1-${MAX_METRICS} 项（逗号分隔）`);
    }
    for (const m of metricIds) {
      if (!hasMetric(m)) {
        throw new AppError(400, `PIVOT: 未注册的指标 "${m}"。参考 /api/discover/metrics`);
      }
      if (!isPivotSafeMetric(m)) {
        throw new AppError(
          400,
          `PIVOT: 指标 "${m}" 为 L4 计算或依赖外层 CTE/异源视图列，不能用于 pivot 单层聚合。`
        );
      }
    }

    const limitRaw = parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10);
    const limit = Math.min(
      MAX_LIMIT,
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT
    );

    const { whereClause } = parseFiltersAndBuildWhere(req);

    const dimensions = dimNames.map((id) => ({ id, sqlExpr: DIM_WHITELIST[id] }));
    const sql = generatePivotQuery({ dimensions, metricIds, whereClause, limit });
    const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

    sendWithEtag(
      req,
      res,
      {
        success: true,
        data: {
          dimensions: dimNames,
          metrics: metricIds,
          rowCount: rows.length,
          rows,
        },
      },
      HTTP_MAX_AGE.query
    );
  })
);

export default router;
