/**
 * 营业货车专项分析 SQL 生成器
 *
 * 业务规则：
 * - 筛选条件：customer_category LIKE '%货车%'
 * - 吨位分段：tonnage_segment（可选字段，需处理NULL）
 * - 占比计算：使用CTE模式
 *
 * @module truck
 */

import type { ViewPerspective } from '../types/index.js';
import { generatePerspectiveSelect, generatePerspectiveWhere } from './perspective-adapter.js';

/**
 * 玫瑰图查询（支持保费和保单数两种指标）
 *
 * @param metric - 指标类型：'premium'（保费）或 'count'（保单数）
 * @param whereClause - WHERE子句条件（默认为 '1=1'）
 * @param perspective - 视角类型（默认 'premium'）
 * @returns SQL查询字符串
 *
 * @example
 * ```typescript
 * const sql = generateTonnageRoseQuery('premium', "policy_date >= DATE '2025-01-01'");
 * // SELECT COALESCE(tonnage_segment, '未知') as dim_key, SUM(premium) as value ...
 * ```
 */
export function generateTonnageRoseQuery(
  metric: 'premium' | 'count',
  whereClause: string = '1=1',
  perspective: ViewPerspective = 'premium'
): string {
  const agg = metric === 'premium' ? 'SUM(premium)' : 'COUNT(DISTINCT policy_no)';
  const perspectiveConditions = generatePerspectiveWhere(perspective, [
    whereClause,
    "customer_category LIKE '%货车%'",
  ]);
  const finalWhereClause = perspectiveConditions.join(' AND ');
  return `
    SELECT
      COALESCE(tonnage_segment, '未知') as dim_key,
      ${agg} as value
    FROM PolicyFact
    WHERE ${finalWhereClause}
    GROUP BY COALESCE(tonnage_segment, '未知')
    ORDER BY value DESC
  `;
}

/**
 * 双Y图1：按吨位分段的机构分析
 *
 * 数据结构：
 * - tonnage_segment: 吨位分段（如"1吨以下"、"1-2吨"等）
 * - org_level_3: 机构名称
 * - premium: 保费金额
 * - premium_ratio: 保费占该吨位分段总保费的比例（0-1之间的小数）
 *
 * @param whereClause - WHERE子句条件（默认为 '1=1'）
 * @param perspective - 视角类型（默认 'premium'）
 * @returns SQL查询字符串
 *
 * @example
 * ```typescript
 * const sql = generateOrgByTonnageQuery("is_nev = true");
 * // WITH tonnage_org_premium AS (...) SELECT t.tonnage_segment, t.org_level_3, ...
 * ```
 */
export function generateOrgByTonnageQuery(
  whereClause: string = '1=1',
  perspective: ViewPerspective = 'premium'
): string {
  const valueAggregation = generatePerspectiveSelect(perspective, 'premium', { round: false });
  const perspectiveConditions = generatePerspectiveWhere(perspective, [
    whereClause,
    "customer_category LIKE '%货车%'",
  ]);
  const finalWhereClause = perspectiveConditions.join(' AND ');
  return `
    WITH tonnage_org_premium AS (
      SELECT
        COALESCE(tonnage_segment, '未知') as tonnage_segment,
        org_level_3,
        ${valueAggregation}
      FROM PolicyFact
      WHERE ${finalWhereClause}
      GROUP BY COALESCE(tonnage_segment, '未知'), org_level_3
    ),
    tonnage_totals AS (
      SELECT
        tonnage_segment,
        SUM(premium) as total_premium
      FROM tonnage_org_premium
      GROUP BY tonnage_segment
    )
    SELECT
      t.tonnage_segment,
      t.org_level_3,
      t.premium,
      (t.premium * 1.0 / NULLIF(tt.total_premium, 0)) as premium_ratio
    FROM tonnage_org_premium t
    JOIN tonnage_totals tt ON t.tonnage_segment = tt.tonnage_segment
    ORDER BY t.tonnage_segment, t.premium DESC
  `;
}

/**
 * 双Y图2：按机构的吨位分段分析
 *
 * 数据结构：
 * - org_level_3: 机构名称
 * - tonnage_segment: 吨位分段（如"1吨以下"、"1-2吨"等）
 * - premium: 保费金额
 * - premium_ratio: 保费占该机构总保费的比例（0-1之间的小数）
 *
 * @param whereClause - WHERE子句条件（默认为 '1=1'）
 * @param perspective - 视角类型（默认 'premium'）
 * @returns SQL查询字符串
 *
 * @example
 * ```typescript
 * const sql = generateTonnageByOrgQuery("policy_date BETWEEN DATE '2025-01-01' AND DATE '2025-12-31'");
 * // WITH org_tonnage_premium AS (...) SELECT t.org_level_3, t.tonnage_segment, ...
 * ```
 */
export function generateTonnageByOrgQuery(
  whereClause: string = '1=1',
  perspective: ViewPerspective = 'premium'
): string {
  const valueAggregation = generatePerspectiveSelect(perspective, 'premium', { round: false });
  const perspectiveConditions = generatePerspectiveWhere(perspective, [
    whereClause,
    "customer_category LIKE '%货车%'",
  ]);
  const finalWhereClause = perspectiveConditions.join(' AND ');
  return `
    WITH org_tonnage_premium AS (
      SELECT
        org_level_3,
        COALESCE(tonnage_segment, '未知') as tonnage_segment,
        ${valueAggregation}
      FROM PolicyFact
      WHERE ${finalWhereClause}
      GROUP BY org_level_3, COALESCE(tonnage_segment, '未知')
    ),
    org_totals AS (
      SELECT
        org_level_3,
        SUM(premium) as total_premium
      FROM org_tonnage_premium
      GROUP BY org_level_3
    )
    SELECT
      t.org_level_3,
      t.tonnage_segment,
      t.premium,
      (t.premium * 1.0 / NULLIF(ot.total_premium, 0)) as premium_ratio
    FROM org_tonnage_premium t
    JOIN org_totals ot ON t.org_level_3 = ot.org_level_3
    ORDER BY t.org_level_3, t.premium DESC
  `;
}

/**
 * 三级机构保费占比查询
 *
 * @param whereClause - WHERE子句条件（默认为 '1=1'）
 * @param perspective - 视角类型（默认 'premium'）
 * @returns SQL查询字符串
 */
export function generateOrgPremiumRatioQuery(
  whereClause: string = '1=1',
  perspective: ViewPerspective = 'premium'
): string {
  const valueAggregation = generatePerspectiveSelect(perspective, 'premium', { round: false });
  const perspectiveConditions = generatePerspectiveWhere(perspective, [
    whereClause,
    "customer_category LIKE '%货车%'",
  ]);
  const finalWhereClause = perspectiveConditions.join(' AND ');
  return `
    SELECT
      org_level_3,
      ${valueAggregation}
    FROM PolicyFact
    WHERE ${finalWhereClause}
    GROUP BY org_level_3
    ORDER BY premium DESC
  `;
}

