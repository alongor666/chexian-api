/**
 * PIVOT 查询生成器
 *
 * 为 /api/query/pivot 提供"维度 × 指标"双维交叉聚合 SQL。
 * 维度白名单在 routes/query/pivot.ts，指标走 metric-registry。
 * 模板不用 CTE，保证权限注入路径统一。
 */

import { getMetricSql } from '../config/metric-registry/index.js';

export interface PivotDimension {
  /** 列别名（也用作 GROUP BY/ORDER BY 引用） */
  id: string;
  /** 对应 SQL 表达式（已是 PolicyFact 字段或 CASE 包装） */
  sqlExpr: string;
}

export interface GeneratePivotQueryConfig {
  /** 维度数组：1-2 项 */
  dimensions: readonly PivotDimension[];
  /** 指标 id 数组：1-10 项 */
  metricIds: readonly string[];
  /** WHERE 子句（已含 permissionFilter） */
  whereClause: string;
  /** LIMIT 上限 */
  limit: number;
}

export function generatePivotQuery(c: GeneratePivotQueryConfig): string {
  if (c.dimensions.length < 1 || c.dimensions.length > 2) {
    throw new Error(`PIVOT: dimensions must be 1-2 items, got ${c.dimensions.length}`);
  }
  if (c.metricIds.length < 1 || c.metricIds.length > 10) {
    throw new Error(`PIVOT: metrics must be 1-10 items, got ${c.metricIds.length}`);
  }

  const dimSelects = c.dimensions.map((d) => `${d.sqlExpr} AS ${d.id}`).join(', ');
  const metricSelects = c.metricIds.map((id) => getMetricSql(id)).join(', ');
  const groupBy = c.dimensions.map((_, i) => String(i + 1)).join(', ');
  // ORDER BY 第一个指标。指标 SQL 形如 `SUM(premium) as total_premium` —
  // 用 metric id 做别名即可，与 metric-registry 约定一致。
  const orderByAlias = c.metricIds[0];

  return `SELECT ${dimSelects}, ${metricSelects}
FROM PolicyFact
WHERE ${c.whereClause}
GROUP BY ${groupBy}
ORDER BY ${orderByAlias} DESC
LIMIT ${c.limit}`;
}
