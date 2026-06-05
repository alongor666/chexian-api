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
import { asyncHandler } from '../middleware/error.js';
import { authMiddleware } from '../middleware/auth.js';
import { withRouteCache, QUERY_CACHE, HTTP_MAX_AGE } from './query/shared.js';
import { getAllMetrics, getMetricsByCategory } from '../config/metric-registry/index.js';
import type { MetricCategory } from '../config/metric-registry/types.js';
import {
  commonFilterSchema,
  VEHICLE_QUICK_FILTER_VALUES,
} from '../utils/filter-params.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FieldsJsonEntry {
  id: string;
  label: string;
  sourceColumn?: string | null;
  required?: boolean;
  derived?: boolean;
  dataTypes: string[];
  aliases: string[];
  description?: string;
}

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

const GROUPABLE_TYPES = new Set(['VARCHAR', 'TEXT', 'STRING']);

function isGroupable(dataTypes: readonly string[]): boolean {
  return dataTypes.some((t) => GROUPABLE_TYPES.has(t.toUpperCase()));
}

/**
 * GET /api/discover/fields
 * 返回字段注册表（56 个字段）的精简视图。
 */
router.get(
  '/fields',
  withRouteCache('discover_fields', QUERY_CACHE.hotspotLong, HTTP_MAX_AGE.query),
  asyncHandler(async (req: Request, res: Response) => {
    const groupableOnly = req.query.groupable === 'true';
    const all = loadFields();
    const data = all
      .map((f) => ({
        id: f.id,
        label: f.label,
        dataTypes: f.dataTypes,
        aliases: f.aliases,
        description: f.description ?? '',
        groupable: isGroupable(f.dataTypes),
        derived: Boolean(f.derived),
      }))
      .filter((f) => (groupableOnly ? f.groupable : true));
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

export default router;
