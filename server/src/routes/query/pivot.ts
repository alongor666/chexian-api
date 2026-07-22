/**
 * GET /api/query/pivot — 维度 × 指标 交叉聚合
 *
 * 维度走白名单（hardcoded），指标走 metric-registry（getMetricSql）。
 * 1-2 维 × 1-10 指标，LIMIT 默认 100（agent_name 默认 500）、上限 500（防笛卡尔爆炸）。
 *
 * 安全堆叠（继承自 router 级）：
 *   authMiddleware + readonlyMiddleware + permissionMiddleware
 *
 * 权限过滤通过 parseFiltersAndBuildWhere 自动注入到 WHERE 子句。
 */
import { Router } from 'express';
import { asyncHandler, AppError, duckdbService, sendWithEtag, QUERY_CACHE, HTTP_MAX_AGE, parseFiltersAndBuildWhere, withRouteCache } from './shared.js';
import {
  generatePivotEffectiveCutoffQuery,
  generatePivotQuery,
  needsPivotClaimsContext,
} from '../../sql/pivot.js';
import { hasMetric, getMetric } from '../../config/metric-registry/index.js';
import { NORMALIZED_AGENT_NAME_SQL } from '../../utils/agent-name.js';

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

export function isPivotSafeMetric(id: string): boolean {
  const metric = getMetric(id);
  if (!metric) return false;
  if (metric.sql.expression.trim().startsWith('--')) return false;
  if (metric.sql.requiredColumns.some((c) => NON_POLICYFACT_COLUMNS.has(c))) return false;
  return true;
}

/**
 * 可分组维度白名单（PolicyFact 单层聚合）。
 * 布尔字段用 CASE 包成可读字符串，避免 GROUP BY true/false 输出难以理解。
 *
 * 同时被 /api/query/cube 的 PolicyFact 路径复用（cx cube 按域分派时 PolicyFact 指标
 * 走 pivot 生成器），故导出为 PIVOT_DIM_WHITELIST。
 */
export const PIVOT_DIM_WHITELIST: Record<string, string> = {
  org_level_3: 'org_level_3',
  salesman_name: 'salesman_name',
  // 仅剥离前导机构码，保留经代完整名称，避免把「中国邮政储蓄银行」误归并为「邮政」。
  // NULL/纯机构码显式归入「无经代」，不静默丢弃高占比缺失值。
  agent_name: NORMALIZED_AGENT_NAME_SQL,
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
  // week_number/month_number 不是 PolicyFact 原始列（裸引用报 Binder Error: column not found），
  // 须从 policy_date 现算周/月序号（ISO 周，与 cross-sell-trend.ts 等既有 DATE_TRUNC('week',...)
  // 用法同源但取序号而非日期，匹配前端按 W{n} 标签展示的诉求）。
  week_number: "EXTRACT('week' FROM policy_date)",
  month_number: "EXTRACT('month' FROM policy_date)",
};

const MAX_DIMENSIONS = 2;
const MAX_METRICS = 10;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * agent_name 的实际基数可超过 800；默认 100 会把仍有显著业务量的经代截掉。
 * 仅该高基数维度在未显式传 limit 时默认取上限 500，其他维度保持既有 100。
 */
export function resolvePivotLimit(dimNames: readonly string[], raw: unknown): number {
  const defaultLimit = dimNames.includes('agent_name') ? MAX_LIMIT : DEFAULT_LIMIT;
  const parsed = parseInt(String(raw ?? defaultLimit), 10);
  return Math.min(MAX_LIMIT, Number.isFinite(parsed) && parsed > 0 ? parsed : defaultLimit);
}

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
      if (!(d in PIVOT_DIM_WHITELIST)) {
        throw new AppError(
          400,
          `PIVOT: 不支持的维度 "${d}"。可用维度: ${Object.keys(PIVOT_DIM_WHITELIST).join(', ')}`
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

    const limit = resolvePivotLimit(dimNames, req.query.limit);

    const { whereClause } = parseFiltersAndBuildWhere(req);

    const dimensions = dimNames.map((id) => ({ id, sqlExpr: PIVOT_DIM_WHITELIST[id] }));
    const sql = generatePivotQuery({ dimensions, metricIds, whereClause, limit });
    const needsClaimsContext = needsPivotClaimsContext(metricIds);
    const [rows, contextRows] = await Promise.all([
      duckdbService.query(sql, QUERY_CACHE.hotspotMedium),
      needsClaimsContext
        ? duckdbService.query<{ effective_cutoff: string | null }>(
          generatePivotEffectiveCutoffQuery(whereClause),
          QUERY_CACHE.hotspotMedium,
        )
        : Promise.resolve([]),
    ]);
    const effectiveCutoff = contextRows[0]?.effective_cutoff ?? null;
    const requestedEndDate = typeof req.query.endDate === 'string' ? req.query.endDate : null;

    sendWithEtag(
      req,
      res,
      {
        success: true,
        data: {
          dimensions: dimNames,
          metrics: metricIds,
          context: {
            requestedStartDate: typeof req.query.startDate === 'string' ? req.query.startDate : null,
            requestedEndDate,
            dateField: typeof req.query.dateField === 'string' ? req.query.dateField : 'policy_date',
            effectiveCutoff,
            partialPeriod: effectiveCutoff && requestedEndDate
              ? effectiveCutoff < requestedEndDate
              : null,
          },
          rowCount: rows.length,
          rows,
        },
      },
      HTTP_MAX_AGE.query
    );
  })
);

export default router;
