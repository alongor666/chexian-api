/**
 * 维修资源分析 SQL 生成器
 *
 * 数据源：RepairDim TABLE（12列：修理厂合作状态/核损金额/换件折扣率/签单净保费）
 */

import { escapeSqlValue } from '../utils/security.js';

export interface RepairFilters {
  orgName?: string;
  is4sShop?: string;
  cooperationStatus?: string;
  city?: string;
}

function buildWhere(filters: RepairFilters): string {
  const clauses: string[] = ['1=1'];
  if (filters.orgName) clauses.push(`org_level_3 = '${escapeSqlValue(filters.orgName)}'`);
  if (filters.is4sShop === 'true') clauses.push(`is_4s_shop = true`);
  if (filters.is4sShop === 'false') clauses.push(`is_4s_shop = false`);
  if (filters.cooperationStatus) clauses.push(`cooperation_status = '${escapeSqlValue(filters.cooperationStatus)}'`);
  if (filters.city) clauses.push(`city = '${escapeSqlValue(filters.city)}'`);
  return clauses.join(' AND ');
}

/** 机构级维修资源汇总 */
export function generateRepairOverviewQuery(filters: RepairFilters): string {
  const where = buildWhere(filters);
  return `
    SELECT
      org_level_3,
      COUNT(DISTINCT repair_shop_name) AS shop_count,
      COUNT(DISTINCT CASE WHEN is_4s_shop THEN repair_shop_name END) AS shop_4s_count,
      COUNT(DISTINCT CASE WHEN cooperation_status = '1生效中' THEN repair_shop_name END) AS active_count,
      ROUND(SUM(COALESCE(damage_assessment_amount, 0)), 2) AS total_damage_amount,
      ROUND(AVG(COALESCE(parts_discount_rate, 0)), 4) AS avg_discount_rate,
      ROUND(SUM(COALESCE(net_premium, 0)), 2) AS total_net_premium
    FROM RepairDim
    WHERE ${where}
    GROUP BY org_level_3
    ORDER BY total_net_premium DESC
  `.trim();
}

/** 修理厂明细列表 */
export function generateRepairDetailQuery(filters: RepairFilters, limit = 200, offset = 0): string {
  const where = buildWhere(filters);
  return `
    SELECT
      repair_shop_name,
      org_level_3,
      cooperation_status,
      channel_type,
      is_4s_shop,
      province, city, district,
      ROUND(COALESCE(damage_assessment_amount, 0), 2) AS damage_assessment_amount,
      COALESCE(parts_discount_rate, 0) AS parts_discount_rate,
      ROUND(COALESCE(net_premium, 0), 2) AS net_premium,
      report_date
    FROM RepairDim
    WHERE ${where}
    ORDER BY net_premium DESC
    LIMIT ${limit} OFFSET ${offset}
  `.trim();
}

/** 合作状态分布 */
export function generateRepairStatusQuery(filters: RepairFilters): string {
  const where = buildWhere(filters);
  return `
    SELECT
      cooperation_status,
      COUNT(DISTINCT repair_shop_name) AS shop_count,
      ROUND(SUM(COALESCE(net_premium, 0)), 2) AS total_net_premium
    FROM RepairDim
    WHERE ${where}
    GROUP BY cooperation_status
    ORDER BY shop_count DESC
  `.trim();
}

/** 元数据：筛选选项 */
export function generateRepairMetadataQuery(): string {
  return `
    SELECT
      (SELECT array_agg(DISTINCT org_level_3 ORDER BY org_level_3) FROM RepairDim WHERE org_level_3 IS NOT NULL) AS orgs,
      (SELECT array_agg(DISTINCT cooperation_status ORDER BY cooperation_status) FROM RepairDim WHERE cooperation_status IS NOT NULL) AS statuses,
      (SELECT array_agg(DISTINCT city ORDER BY city) FROM RepairDim WHERE city IS NOT NULL) AS cities,
      (SELECT COUNT(DISTINCT repair_shop_name) FROM RepairDim) AS total_shops
  `.trim();
}
