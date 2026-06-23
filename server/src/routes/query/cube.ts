/**
 * GET /api/query/cube — 语义层「选指标 × 任意维度子集」可组合查询（P2）
 *
 * 服务端按指标所属域分派（cx cube 薄客户端只调本端点）：
 *   - 续保域（category='renewal' 计数指标）→ generateRenewalCubeQuery（RenewalTrackerFact，
 *     任意维度子集单层 GROUP BY，输出 A-E universe + 派生续保率/未报价率/流失率）。
 *     权限处理镜像 /renewal-tracker 路由（受限筛选器 extraConditions + permissionFilter 追加），
 *     与续保固定切片路由口径/RLS 完全一致。
 *   - PolicyFact pivot-safe 指标 → 复用 generatePivotQuery（与 /pivot 同生成器、同维度白名单、
 *     同权限注入路径 parseFiltersAndBuildWhere）。
 *   - 其余（L4 复合 / 跨源视图 / 增长率需外层 CTE / 续保影响度需窗口合计）→ 400 并指引。
 *
 * 安全堆叠（继承自 router 级 query.ts）：authMiddleware + readonlyMiddleware + permissionMiddleware。
 * 续保域为 federation `direct` 关系（org_level_3/salesman_name 权限列），RLS 经 permissionFilter 下推。
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
  withRouteCache,
  parseFiltersAndBuildWhere,
  buildOrgScopedPermissionWhere,
} from './shared.js';
import { buildInCondition } from '../../utils/sql-sanitizer.js';
import {
  generateRenewalCubeQuery,
  RENEWAL_CUBE_DIMENSIONS,
  RENEWAL_OUTPUT_COLUMNS,
} from '../../sql/renewal-tracker.js';
import { generatePivotQuery } from '../../sql/pivot.js';
import { isPivotSafeMetric, PIVOT_DIM_WHITELIST } from './pivot.js';
import { getMetric } from '../../config/metric-registry/index.js';
import { getBootstrapper } from '../../services/bootstrapper-registry.js';

const router = Router();

const MAX_DIMENSIONS_RENEWAL = 4; // 续保维度子集上限（基础层 org/team/salesman + 1 业务维度，防输出过宽）
const MAX_DIMENSIONS_PIVOT = 2;   // PolicyFact pivot 单层上限（与 /pivot 路由一致）
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** 续保 cube 支持的指标 id（A-E 计数；续保影响度需窗口合计分母，cube 不支持） */
const RENEWAL_CUBE_METRIC_IDS: ReadonlySet<string> = new Set(
  RENEWAL_OUTPUT_COLUMNS.map((c) => c.metricId)
);

function parseCsv(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseBooleanCondition(value: unknown, column: string): string | null {
  if (value === 'true') return `${column} = true`;
  if (value === 'false') return `${column} = false`;
  return null;
}

function clampLimit(raw: unknown): number {
  const n = parseInt(String(raw ?? DEFAULT_LIMIT), 10);
  return Math.min(MAX_LIMIT, Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * 续保受限筛选器 → extraConditions（与 /renewal-tracker 路由逐条一致）。
 * 仅支持 RenewalTrackerFact 已派生字段 + 权限过滤；不走 parseFiltersAndBuildWhere
 * （后者引用 PolicyFactRealtime 特有列）。
 */
function buildRenewalExtraConditions(req: import('express').Request): string[] {
  const extra: string[] = [];

  const orgNames = parseCsv(req.query.orgNames);
  if (orgNames.length > 0) extra.push(buildInCondition('org_level_3', orgNames));

  const salesmanNames = parseCsv(req.query.salesmanNames);
  if (salesmanNames.length > 0) extra.push(buildInCondition('salesman_name', salesmanNames));

  const customerCategories = parseCsv(req.query.customerCategories);
  if (customerCategories.length > 0) extra.push(buildInCondition('customer_category', customerCategories));

  const coverageCombinations = parseCsv(req.query.coverageCombinations);
  if (coverageCombinations.length > 0) extra.push(buildInCondition('coverage_combination', coverageCombinations));

  const fuelCategories = parseCsv(req.query.fuelCategories);
  if (fuelCategories.length > 0) extra.push(buildInCondition('fuel_category', fuelCategories));

  const usedTransferTypes = parseCsv(req.query.usedTransferTypes);
  if (usedTransferTypes.length > 0) extra.push(buildInCondition('used_transfer_type', usedTransferTypes));

  const renewalTypes = parseCsv(req.query.renewalTypes);
  if (renewalTypes.length > 0) extra.push(buildInCondition('renewal_type', renewalTypes));

  const boolParams: Array<[string, string]> = [
    ['isNev', 'is_nev'],
    ['isNewCar', 'is_new_car'],
    ['isTransfer', 'is_transfer'],
    ['isRenewal', 'is_renewal'],
  ];
  for (const [queryKey, column] of boolParams) {
    const cond = parseBooleanCondition(req.query[queryKey], column);
    if (cond) extra.push(cond);
  }

  // 权限过滤（RLS）：RenewalTrackerFact 视图当前只含 org_level_3（is_telemarketing 由 loader
  // 视图层补 `FALSE AS is_telemarketing` 常量；branch_code 由 loader buildFactSelectSql 的
  // DESCRIBE 自适应路径处理——P3-C #765 起 ETL 已派生该列写入 parquet，但 cube 路由保守
  // 走 buildOrgScopedPermissionWhere 安全降级，只保留视图真实存在的 org_level_3 段，避免
  // 因 loader 路径切换造成 Binder Error 500，对齐 repair.ts 既定模式。
  // 注：renewal-tracker 路由仍是朴素追加，同款既存 bug 已单独登 BACKLOG，不在本 PR 偷修。
  const orgScoped = buildOrgScopedPermissionWhere(req);
  if (orgScoped !== '1=1') {
    extra.push(`(${orgScoped})`);
  }

  return extra;
}

router.get(
  '/cube',
  withRouteCache('cube', QUERY_CACHE.hotspotMedium),
  asyncHandler(async (req, res) => {
    const metricId = typeof req.query.metric === 'string' ? req.query.metric.trim() : '';
    if (!metricId) {
      throw new AppError(400, 'CUBE: 缺少 metric 参数（单个指标 id，参考 /api/discover/metrics）');
    }
    const metric = getMetric(metricId);
    if (!metric) {
      throw new AppError(400, `CUBE: 未注册的指标 "${metricId}"。参考 /api/discover/metrics`);
    }

    // dims 兼容 dimensions / dims 两个参数名
    const dimNames = parseCsv(req.query.dimensions ?? req.query.dims);
    const limit = clampLimit(req.query.limit);

    // ───────── 续保可组合路径 ─────────
    if (metric.category === 'renewal') {
      if (!RENEWAL_CUBE_METRIC_IDS.has(metricId)) {
        throw new AppError(
          400,
          `CUBE: 续保指标 "${metricId}" 暂不支持 cube 组合（如续保影响度需窗口合计分母，请用续保诊断）。` +
            `支持的续保指标：${[...RENEWAL_CUBE_METRIC_IDS].join(', ')}`
        );
      }
      if (dimNames.length > MAX_DIMENSIONS_RENEWAL) {
        throw new AppError(400, `CUBE: 续保维度最多 ${MAX_DIMENSIONS_RENEWAL} 个（逗号分隔）`);
      }
      for (const d of dimNames) {
        if (!Object.prototype.hasOwnProperty.call(RENEWAL_CUBE_DIMENSIONS, d)) {
          throw new AppError(
            400,
            `CUBE: 续保不支持维度 "${d}"。可用维度：${Object.keys(RENEWAL_CUBE_DIMENSIONS).join(', ')}`
          );
        }
      }

      const start = req.query.start;
      const end = req.query.end;
      const cutoff = req.query.cutoff;
      if (typeof start !== 'string' || !isValidDateFormat(start)) {
        throw new AppError(400, `CUBE(续保): 缺少或非法 'start'（YYYY-MM-DD，到期窗口起）`);
      }
      if (typeof end !== 'string' || !isValidDateFormat(end)) {
        throw new AppError(400, `CUBE(续保): 缺少或非法 'end'（YYYY-MM-DD，到期窗口止）`);
      }
      if (typeof cutoff !== 'string' || !isValidDateFormat(cutoff)) {
        throw new AppError(400, `CUBE(续保): 缺少或非法 'cutoff'（YYYY-MM-DD，观察截止日）`);
      }
      if (start > end) {
        throw new AppError(400, `CUBE(续保): 'start' 必须 <= 'end'`);
      }

      // 续保为惰性域：sql-passthrough 路径之外，cube 直查须主动预热（与 typed 路由对齐）
      const bootstrapper = getBootstrapper();
      if (bootstrapper) {
        await bootstrapper.ensureDomainLoaded('RenewalTracker');
      }

      const extraConditions = buildRenewalExtraConditions(req);
      const sql = generateRenewalCubeQuery({ start, end, cutoff, dims: dimNames, extraConditions, limit });
      const rawRows = await duckdbService.query<Record<string, unknown>>(sql, QUERY_CACHE.hotspotShort);

      const rows = rawRows.map((r) => {
        const A = Number(r.A) || 0;
        const B = Number(r.B) || 0;
        const C = Number(r.C) || 0;
        const D = Number(r.D) || 0;
        const E = Number(r.E) || 0;
        const dimValues: Record<string, unknown> = {};
        for (const d of dimNames) dimValues[d] = r[d] ?? null;
        return {
          ...dimValues,
          renewal_due_count: A,
          renewal_quoted_count: B,
          renewal_renewed_count: C,
          renewal_unquoted_count: D,
          renewal_lost_count: E,
          // 派生率（续保追踪口径，下游计算与既有续保消费方一致；非注册表指标）
          renewal_rate_pct: A > 0 ? round1((100 * C) / A) : null,
          unquoted_rate_pct: A > 0 ? round1((100 * D) / A) : null,
          lost_rate_pct: A > 0 ? round1((100 * E) / A) : null,
        };
      });

      sendWithEtag(
        req,
        res,
        {
          success: true,
          data: {
            domain: 'renewal',
            relation: 'RenewalTrackerFact',
            metric: metricId,
            dimensions: dimNames,
            rowCount: rows.length,
            rows,
          },
        },
        HTTP_MAX_AGE.query
      );
      return;
    }

    // ───────── PolicyFact pivot 路径（复用 /pivot 生成器）─────────
    if (!isPivotSafeMetric(metricId)) {
      throw new AppError(
        400,
        `CUBE: 指标 "${metricId}" 不支持 cube 组合查询（L4 计算 / 跨源视图列 / 增长率需外层 CTE）。` +
          `续保族指标走续保 cube（带 start/end/cutoff）；PolicyFact 可加/比率指标可用。`
      );
    }
    if (dimNames.length < 1 || dimNames.length > MAX_DIMENSIONS_PIVOT) {
      throw new AppError(400, `CUBE(PolicyFact): dimensions 须为 1-${MAX_DIMENSIONS_PIVOT} 项（逗号分隔）`);
    }
    for (const d of dimNames) {
      if (!Object.prototype.hasOwnProperty.call(PIVOT_DIM_WHITELIST, d)) {
        throw new AppError(
          400,
          `CUBE(PolicyFact): 不支持的维度 "${d}"。可用维度：${Object.keys(PIVOT_DIM_WHITELIST).join(', ')}`
        );
      }
    }

    const { whereClause } = parseFiltersAndBuildWhere(req);
    const dimensions = dimNames.map((id) => ({ id, sqlExpr: PIVOT_DIM_WHITELIST[id] }));
    const sql = generatePivotQuery({ dimensions, metricIds: [metricId], whereClause, limit });
    const rows = await duckdbService.query<Record<string, unknown>>(sql, QUERY_CACHE.hotspotMedium);

    sendWithEtag(
      req,
      res,
      {
        success: true,
        data: {
          domain: 'policyfact',
          relation: 'PolicyFact',
          metric: metricId,
          dimensions: dimNames,
          rowCount: rows.length,
          rows,
        },
      },
      HTTP_MAX_AGE.query
    );
  })
);

export default router;
