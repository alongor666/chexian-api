/**
 * 发现层路由 — Agent / CLI / MCP 可枚举系统能力
 *
 * 三个 GET 端点返回字段、指标、筛选预设的元数据，用于让 Agent
 * 在无人协助下"知道有什么可用"。鉴权用 authMiddleware（PAT/JWT 都行），
 * 不挂 permissionMiddleware 因为返回的是静态元数据。
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { asyncHandler, AppError } from '../middleware/error.js';
import { authMiddleware } from '../middleware/auth.js';
import { withRouteCache, QUERY_CACHE, HTTP_MAX_AGE, duckdbService } from './query/shared.js';
import { getAllMetrics, getMetricsByCategory } from '../config/metric-registry/index.js';
import type { MetricCategory } from '../config/metric-registry/types.js';
import {
  isRelationAllowed,
  getRelationPolicy,
  isFederationEnabled,
} from '../config/sql-federation-policy.js';
import { buildRouteLegend } from '../config/route-field-legend.js';
import { getBootstrapper } from '../services/bootstrapper-registry.js';
import {
  commonFilterSchema,
  VEHICLE_QUICK_FILTER_VALUES,
} from '../utils/filter-params.js';
import {
  buildFieldsView,
  type FieldsJsonEntry,
  type DescribeColumn,
} from './discover-fields-view.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIELDS_JSON_PATH = path.resolve(__dirname, '../config/field-registry/fields.json');
let fieldsCache: FieldsJsonEntry[] | null = null;
function loadFields(): FieldsJsonEntry[] {
  if (fieldsCache) return fieldsCache;
  const raw = fs.readFileSync(FIELDS_JSON_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as { fields: FieldsJsonEntry[] };
  fieldsCache = parsed.fields;
  return fieldsCache;
}

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/discover/fields
 * 返回字段注册表的精简视图（字段数以 fields.json 为准）。
 *
 * 每个字段附 PolicyFact「可查真值」：column（= 唯一可 SELECT 的列名）、queryable
 * （是否真实存在于 PolicyFact）、actualType（真实 DuckDB 类型）。这样 `cx fields`
 * 输出可直接用于 `cx sql`，消灭「别名陷阱」（详见 discover-fields-view.ts）。
 *   - groupable=true 仅返回可分组（字符串）字段
 *   - verbose=true   附带 ETL 入库元数据（ingestTypes / ingestAliases，不可 SELECT）
 */
router.get(
  '/fields',
  withRouteCache('discover_fields', QUERY_CACHE.hotspotLong, HTTP_MAX_AGE.query),
  asyncHandler(async (req: Request, res: Response) => {
    const groupableOnly = req.query.groupable === 'true';
    const verbose = req.query.verbose === 'true';
    const all = loadFields();

    // 取 PolicyFact 真实 schema 作为「可查真值」。PolicyFact 启动即建、始终可达；
    // DESCRIBE 失败时降级为 queryable=null（schema 暂不可用），不阻断端点。
    let describeColumns: DescribeColumn[] | null = null;
    try {
      const rows = await duckdbService.query<{ column_name: string; column_type: string }>(
        'DESCRIBE PolicyFact'
      );
      describeColumns = rows.map((r) => ({ name: r.column_name, type: r.column_type }));
    } catch {
      describeColumns = null;
    }

    const view = buildFieldsView(all, describeColumns, { verbose });
    const data = groupableOnly ? view.filter((f) => f.groupable) : view;
    res.json({ success: true, data });
  })
);

/**
 * GET /api/discover/metrics
 * 返回指标注册表的精简视图（**不暴露 sql.expression**，强制走 PIVOT/SQL 路由）。
 */
router.get(
  '/metrics',
  withRouteCache('discover_metrics', QUERY_CACHE.hotspotLong, HTTP_MAX_AGE.query),
  asyncHandler(async (req: Request, res: Response) => {
    const category = req.query.category as MetricCategory | undefined;
    const list = category ? getMetricsByCategory(category) : getAllMetrics();
    const data = list.map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      tags: m.tags,
      formula: {
        description: m.formula.description,
        unit: m.formula.unit,
      },
      display: m.display,
      thresholds: m.thresholds ?? null,
    }));
    res.json({ success: true, data });
  })
);

/**
 * GET /api/discover/presets
 * 返回筛选器 schema 和 9 个车型快捷预设。
 */
router.get(
  '/presets',
  withRouteCache('discover_presets', QUERY_CACHE.hotspotLong, HTTP_MAX_AGE.query),
  asyncHandler(async (_req: Request, res: Response) => {
    const shape = (commonFilterSchema as unknown as { shape: Record<string, unknown> }).shape;
    const filterSchema = Object.keys(shape).map((key) => ({ name: key }));
    res.json({
      success: true,
      data: {
        filterSchema,
        vehicleQuickFilters: VEHICLE_QUICK_FILTER_VALUES,
      },
    });
  })
);

/**
 * GET /api/discover/schema?relation=<view>
 * 对联邦白名单内的关系跑受控 DESCRIBE，返回列名/类型（schema 自省）。
 * `cx describe <view>` 的后端。仅返回 schema 元数据，不返回任何行数据。
 *
 * 准入：复用 sql-federation-policy 白名单（开关关闭仅 PolicyFact；开启含派生视图 + exempt 参照表）。
 * 未授权关系一律 403，绝不对任意表 DESCRIBE。
 */
router.get(
  '/schema',
  asyncHandler(async (req: Request, res: Response) => {
    const relation = String(req.query.relation ?? '').trim();
    if (!relation) {
      throw new AppError(400, 'schema: 缺少 relation 参数');
    }
    if (!isRelationAllowed(relation)) {
      throw new AppError(
        403,
        isFederationEnabled()
          ? `不允许 describe 该关系：${relation}（仅限已授权视图；用 cx routes 查可用域）`
          : `不允许 describe 该关系：${relation}（默认仅 PolicyFact；派生视图需开启 SQL_FEDERATION_ENABLED）`
      );
    }
    const policy = getRelationPolicy(relation)!;
    // 惰性域预热：DESCRIBE 需关系已物化（sql-passthrough 同款机制）
    const bootstrapper = getBootstrapper();
    if (policy.lazyDomain && bootstrapper) {
      await bootstrapper.ensureDomainLoaded(policy.lazyDomain);
    }
    // policy.canonical 来自注册表（可信常量，非用户输入）→ 无注入面
    const rows = await duckdbService.query<{ column_name: string; column_type: string; null: string }>(
      `DESCRIBE ${policy.canonical}`
    );
    const columns = rows.map((r) => ({
      name: r.column_name,
      type: r.column_type,
      nullable: String(r.null).toUpperCase() === 'YES',
    }));
    res.json({ success: true, data: { relation: policy.canonical, columns } });
  })
);

/**
 * GET /api/discover/legend?route=<key>
 * 返回查询路由的字段图例（裸输出列 → 中文名 / 口径 / 单位），消灭 A-E 裸字母。
 * `cx query <route> --describe` 的后端。口径文本源自 metric-registry（单一事实源），
 * 本端点只做解析编排，仅返回元数据零行数据。
 *
 * 鉴权：authMiddleware（router 级，PAT/JWT 均可）。返回的是静态能力元数据，
 * 不挂 permissionMiddleware（与 fields/metrics/presets 一致）。
 * 未登记图例的路由返回 data:null（调用方据此回退「无图例」，非错误）。
 */
router.get(
  '/legend',
  withRouteCache('discover_legend', QUERY_CACHE.hotspotLong, HTTP_MAX_AGE.query),
  asyncHandler(async (req: Request, res: Response) => {
    const route = String(req.query.route ?? '').trim();
    if (!route) {
      throw new AppError(400, 'legend: 缺少 route 参数');
    }
    // buildRouteLegend 在绑定的 metricId 缺失时抛错（SSOT 守卫）→ asyncHandler 转 500（配置 bug 应显性暴露）
    const legend = buildRouteLegend(route);
    res.json({ success: true, data: legend });
  })
);

export default router;
