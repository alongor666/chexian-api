/**
 * 路由字段图例（route field legend）— `cx query <route> --describe` 的后端事实源
 *
 * 解决 cx-cli 结构墙「响应裸 A-E 无图例」：部分查询路由（如续保追踪 RENEWAL_TRACKER）
 * 输出列是裸字母 A/B/C/D/E，调用方拿到 JSON 无从得知含义。本模块把「路由输出列」
 * 绑定到 metric-registry 指标，按需解析出中文图例（列名 / 口径释义 / 单位）。
 *
 * 单一事实源分层：
 *   - 口径文本（中文名 / 释义 / 单位）→ metric-registry（categories/*.ts）
 *   - 列 ↔ 指标绑定          → 各 SQL 生成器导出（如 sql/renewal-tracker.ts: RENEWAL_OUTPUT_COLUMNS）
 *   - 路由级时间口径          → query-routes-metadata.ts（timeWindow / timeWindowNote）
 *   本模块只做「解析编排」，不新增任何口径文本。
 *
 * 扩展：其它有裸列的路由在 ROUTE_OUTPUT_COLUMNS 增一行绑定即可被 --describe 覆盖。
 */
import { getMetric } from './metric-registry/index.js';
import { getRouteMetaByKey } from './query-routes-metadata.js';
import type { RouteTimeWindow } from './query-routes-metadata.js';
import { RENEWAL_OUTPUT_COLUMNS, type RenewalOutputColumn } from '../sql/renewal-tracker.js';

/** 单列图例（解析后，供 CLI/Agent 渲染） */
export interface LegendColumn {
  /** 输出列别名（如 'A'） */
  readonly column: string;
  /** 绑定的 metric-registry 指标 id */
  readonly metricId: string;
  /** 中文列名（来自注册表 display.label，回退 name） */
  readonly label: string;
  /** 口径释义（来自注册表 formula.description） */
  readonly description: string;
  /** 单位（来自注册表 formula.unit，回退 display.unit） */
  readonly unit: string;
}

/** 路由字段图例（完整结构） */
export interface RouteFieldLegend {
  /** 路由 key（规范化大写下划线，如 'RENEWAL_TRACKER'） */
  readonly route: string;
  /** 一句话摘要（来自路由元数据） */
  readonly summary: string;
  /** 时间窗口语义 */
  readonly timeWindow: RouteTimeWindow;
  /** 时间口径补充说明（如有） */
  readonly timeWindowNote?: string;
  /** 各输出列图例 */
  readonly columns: readonly LegendColumn[];
}

/**
 * 路由 key → 输出列绑定登记表（唯一登记处）。
 * 绑定来源是各 SQL 生成器导出的列表，本表只做「路由 ↔ 绑定」关联，不重复绑定内容。
 */
const ROUTE_OUTPUT_COLUMNS: Readonly<Record<string, readonly RenewalOutputColumn[]>> = {
  RENEWAL_TRACKER: RENEWAL_OUTPUT_COLUMNS,
};

/** key 规范化：小写/中划线 → 大写下划线（与 cx query resolveTarget 一致） */
export function normalizeRouteKey(input: string): string {
  return input.toUpperCase().replace(/-/g, '_').replace(/^\//, '');
}

/** 是否登记了字段图例（供端点快速判定） */
export function hasRouteLegend(routeKey: string): boolean {
  return normalizeRouteKey(routeKey) in ROUTE_OUTPUT_COLUMNS;
}

/**
 * 构建指定路由的字段图例。
 * @returns 图例对象；路由未登记图例时返回 null（调用方据此回退「无图例」）。
 * @throws 绑定的 metricId 在注册表缺失时抛错（SSOT 守卫——绝不静默产出残缺图例）。
 */
export function buildRouteLegend(routeKey: string): RouteFieldLegend | null {
  const key = normalizeRouteKey(routeKey);
  const bindings = ROUTE_OUTPUT_COLUMNS[key];
  if (!bindings) return null;

  const columns: LegendColumn[] = bindings.map((b) => {
    const metric = getMetric(b.metricId);
    if (!metric) {
      throw new Error(
        `route-field-legend: 路由 ${key} 列 ${b.column} 绑定的指标 ${b.metricId} 在 metric-registry 缺失（SSOT 断裂）`
      );
    }
    return {
      column: b.column,
      metricId: b.metricId,
      label: metric.display?.label ?? metric.name,
      description: metric.formula.description,
      unit: metric.formula.unit ?? metric.display?.unit ?? '',
    };
  });

  const meta = getRouteMetaByKey(key);
  return {
    route: key,
    summary: meta?.summary ?? key,
    timeWindow: meta?.timeWindow ?? 'any',
    ...(meta?.timeWindowNote ? { timeWindowNote: meta.timeWindowNote } : {}),
    columns,
  };
}
