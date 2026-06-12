/**
 * 承保地理分布 SQL 生成器
 *
 * 数据源：PolicyFact LEFT JOIN PlateRegionMap
 * 端点：/api/query/policy-geo/*
 *
 * 按车牌归属地聚合保费和车辆数，支持省/市两级。
 */

import { escapeSqlValue } from '../utils/security.js';

export interface PolicyGeoFilters {
  whereClause: string; // 来自 parseFiltersAndBuildWhere 的通用筛选
  province?: string;   // 下钻到某省时传入（PlateRegionMap.province 值，如"四川"）
}

/**
 * 省级聚合：按车牌归属省份，聚合车辆数、保费、件均保费
 */
export function generatePolicyGeoProvinceQuery(filters: PolicyGeoFilters): string {
  const { whereClause } = filters;
  return `
    WITH dedup AS (
      -- B252：先按 (policy_no, insurance_start_date) 去重，原单+批改多行合一，
      -- HAVING SUM(premium)>0 剔除净退保，避免车辆数虚增 / 件均被负向批改拉偏
      SELECT
        policy_no,
        ANY_VALUE(plate_no) AS plate_no,
        SUM(premium) AS premium
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY policy_no, insurance_start_date
      HAVING SUM(premium) > 0
    ),
    geo AS (
      SELECT
        COALESCE(prm.province, '未知') AS province,
        COUNT(*) AS vehicle_count,
        ROUND(SUM(d.premium) / 1e4, 1) AS premium_wan,
        ROUND(AVG(d.premium), 0) AS avg_premium
      FROM dedup d
      LEFT JOIN PlateRegionMap prm
        ON SUBSTRING(d.plate_no, 1, 2) = prm.plate_prefix
      GROUP BY COALESCE(prm.province, '未知')
    ),
    total AS (
      SELECT
        SUM(vehicle_count) AS total_vehicles,
        SUM(premium_wan) AS total_premium_wan
      FROM geo
    )
    SELECT
      g.province,
      g.vehicle_count,
      g.premium_wan,
      g.avg_premium,
      ROUND(g.vehicle_count * 100.0 / NULLIF(t.total_vehicles, 0), 2) AS vehicle_pct,
      ROUND(g.premium_wan * 100.0 / NULLIF(t.total_premium_wan, 0), 2) AS premium_pct
    FROM geo g
    CROSS JOIN total t
    WHERE g.province != '未知'
    ORDER BY g.premium_wan DESC
  `;
}

/**
 * 城市级聚合：按车牌归属城市，聚合车辆数、保费、件均保费
 * 可选传入 province 筛选到某省
 */
export function generatePolicyGeoCityQuery(filters: PolicyGeoFilters): string {
  const { whereClause, province } = filters;
  const provinceFilter = province
    ? ` AND prm.province = '${escapeSqlValue(province)}'`
    : '';
  return `
    WITH dedup AS (
      -- B252：先按 (policy_no, insurance_start_date) 去重 + HAVING SUM(premium)>0
      SELECT
        policy_no,
        ANY_VALUE(plate_no) AS plate_no,
        SUM(premium) AS premium
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY policy_no, insurance_start_date
      HAVING SUM(premium) > 0
    ),
    geo AS (
      SELECT
        COALESCE(prm.province, '未知') AS province,
        COALESCE(prm.city, '未知') AS city,
        COUNT(*) AS vehicle_count,
        ROUND(SUM(d.premium) / 1e4, 1) AS premium_wan,
        ROUND(AVG(d.premium), 0) AS avg_premium
      FROM dedup d
      LEFT JOIN PlateRegionMap prm
        ON SUBSTRING(d.plate_no, 1, 2) = prm.plate_prefix
      WHERE 1=1${provinceFilter}
      GROUP BY COALESCE(prm.province, '未知'), COALESCE(prm.city, '未知')
    ),
    total AS (
      SELECT
        SUM(vehicle_count) AS total_vehicles,
        SUM(premium_wan) AS total_premium_wan
      FROM geo
    )
    SELECT
      g.province,
      g.city,
      g.vehicle_count,
      g.premium_wan,
      g.avg_premium,
      ROUND(g.vehicle_count * 100.0 / NULLIF(t.total_vehicles, 0), 2) AS vehicle_pct,
      ROUND(g.premium_wan * 100.0 / NULLIF(t.total_premium_wan, 0), 2) AS premium_pct
    FROM geo g
    CROSS JOIN total t
    WHERE g.city != '未知'
    ORDER BY g.premium_wan DESC
  `;
}
