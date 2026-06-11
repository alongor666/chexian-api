/**
 * 营销战报 SQL 生成器
 *
 * 生成假日营销分析相关的 SQL：
 * - 机构级假日签单统计（开单率、保费）
 * - 业务员级签单天数明细
 */

import { createLogger } from '../utils/logger.js';
import { escapeSqlValue } from '../utils/security.js';

const logger = createLogger('MarketingReportSQL');

/**
 * 生成节假日日期 VALUES 子句
 */
function buildHolidayDateValues(holidayDates: string[]): string {
  if (holidayDates.length === 0) {
    return "('1900-01-01')";
  }
  return holidayDates.map(d => `('${d}')`).join(', ');
}

/**
 * 机构级假日签单统计
 *
 * 返回每个机构在假日期间的：
 * - 车险保费、商业险保费
 * - 车险开单率（有出单的业务员数 / 总业务员数）
 * - 商业险开单率
 */
export function generateOrgHolidayReportQuery(
  whereClause: string,
  holidayDates: string[],
  dateField: string = 'policy_date'
): string {
  const holidayValues = buildHolidayDateValues(holidayDates);

  logger.debug('Generating org holiday report SQL', {
    holidayCount: holidayDates.length,
    dateField,
  });

  return `
    WITH holiday_dates AS (
      SELECT CAST(col0 AS DATE) AS holiday_date
      FROM (VALUES ${holidayValues}) AS t(col0)
    ),
    -- 假日期间的签单数据
    holiday_policies AS (
      SELECT *
      FROM PolicyFact p
      WHERE ${whereClause}
        AND CAST(${dateField} AS DATE) IN (SELECT holiday_date FROM holiday_dates)
    ),
    -- 各机构总业务员数（全量数据）
    org_salesman_total AS (
      SELECT
        org_level_3,
        COUNT(DISTINCT salesman_name) AS total_salesman
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY org_level_3
    ),
    -- 假日签单汇总
    org_holiday_stats AS (
      SELECT
        org_level_3,
        -- 车险保费（万元）
        COALESCE(SUM(premium), 0) / 10000.0 AS 车险保费,
        -- 商业险保费（万元）
        COALESCE(SUM(CASE WHEN is_commercial_insure = '套单' OR is_commercial_insure = '是' THEN premium ELSE 0 END), 0) / 10000.0 AS 商业险保费,
        -- 假日车险出单人数
        COUNT(DISTINCT salesman_name) AS 车险出单人数,
        -- 假日商业险出单人数
        COUNT(DISTINCT CASE WHEN is_commercial_insure = '套单' OR is_commercial_insure = '是' THEN salesman_name END) AS 商业险出单人数
      FROM holiday_policies
      GROUP BY org_level_3
    )
    SELECT
      h.org_level_3,
      COALESCE(h.车险保费, 0) AS 车险保费,
      COALESCE(h.商业险保费, 0) AS 商业险保费,
      COALESCE(t.total_salesman, 0) AS 总业务员数,
      COALESCE(h.车险出单人数, 0) AS 车险出单人数,
      COALESCE(h.商业险出单人数, 0) AS 商业险出单人数,
      -- 车险开单率
      CASE WHEN COALESCE(t.total_salesman, 0) = 0 THEN 0
        ELSE COALESCE(h.车险出单人数, 0) * 1.0 / t.total_salesman
      END AS 车险开单率,
      -- 商业险开单率
      CASE WHEN COALESCE(t.total_salesman, 0) = 0 THEN 0
        ELSE COALESCE(h.商业险出单人数, 0) * 1.0 / t.total_salesman
      END AS 商业险开单率
    FROM org_holiday_stats h
    LEFT JOIN org_salesman_total t ON h.org_level_3 = t.org_level_3
    ORDER BY h.车险保费 DESC
  `;
}

/**
 * 业务员级假日签单天数明细
 *
 * 返回每个业务员在假日期间的：
 * - 车险签单天数、商业险签单天数
 * - 各自的签单比例
 */
export function generateSalesmanHolidayDetailQuery(
  whereClause: string,
  holidayDates: string[],
  dateField: string = 'policy_date'
): string {
  const holidayValues = buildHolidayDateValues(holidayDates);
  const totalHolidayDays = holidayDates.length || 1;

  logger.debug('Generating salesman holiday detail SQL', {
    holidayCount: holidayDates.length,
    dateField,
  });

  return `
    WITH holiday_dates AS (
      SELECT CAST(col0 AS DATE) AS holiday_date
      FROM (VALUES ${holidayValues}) AS t(col0)
    ),
    holiday_policies AS (
      SELECT *
      FROM PolicyFact p
      WHERE ${whereClause}
        AND CAST(${dateField} AS DATE) IN (SELECT holiday_date FROM holiday_dates)
    ),
    salesman_stats AS (
      SELECT
        salesman_name,
        org_level_3,
        -- 车险签单天数（有出单的不同日期数）
        COUNT(DISTINCT CAST(${dateField} AS DATE)) AS 假日车险签单天数,
        -- 商业险签单天数
        COUNT(DISTINCT CASE
          WHEN is_commercial_insure = '套单' OR is_commercial_insure = '是'
          THEN CAST(${dateField} AS DATE)
        END) AS 假日商业险签单天数
      FROM holiday_policies
      GROUP BY salesman_name, org_level_3
    )
    SELECT
      salesman_name,
      org_level_3,
      '' AS team_name,
      假日车险签单天数,
      ${totalHolidayDays} AS 假日天数,
      假日车险签单天数 * 1.0 / ${totalHolidayDays} AS 假日车险签单比例,
      假日商业险签单天数,
      假日商业险签单天数 * 1.0 / ${totalHolidayDays} AS 假日商业险签单比例
    FROM salesman_stats
    ORDER BY 假日车险签单天数 DESC
  `;
}

// ============================================================================
// 自由维度下钻 — groupBy + drillPath 动态查询模式
// ============================================================================

/** 假日营销支持的自由下钻维度 */
export type HolidayDrillDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing';

/** 下钻路径步骤 */
export interface HolidayDrillStep {
  dimension: HolidayDrillDimension;
  value: string;
}

/** 布尔维度映射 */
const HOLIDAY_BOOLEAN_MAP: Record<string, { field: string; trueLabel: string; falseLabel: string }> = {
  is_new_car: { field: 'is_new_car', trueLabel: '新车', falseLabel: '旧车' },
  is_transfer: { field: 'is_transfer', trueLabel: '过户车', falseLabel: '非过户' },
  is_nev: { field: 'is_nev', trueLabel: '新能源', falseLabel: '传统燃油' },
  is_telemarketing: { field: 'is_telemarketing', trueLabel: '电销', falseLabel: '非电销' },
};

/** 维度 → GROUP BY 配置 */
function getHolidayGroupByConfig(dimension: HolidayDrillDimension): {
  selectExpr: string;
  groupByExpr: string;
  needsTeamJoin: boolean;
} {
  const boolDef = HOLIDAY_BOOLEAN_MAP[dimension];
  if (boolDef) {
    return {
      selectExpr: `CASE WHEN p.${boolDef.field} = 'true' OR p.${boolDef.field} = '1' THEN '${boolDef.trueLabel}' ELSE '${boolDef.falseLabel}' END AS group_name`,
      groupByExpr: `CASE WHEN p.${boolDef.field} = 'true' OR p.${boolDef.field} = '1' THEN '${boolDef.trueLabel}' ELSE '${boolDef.falseLabel}' END`,
      needsTeamJoin: false,
    };
  }

  switch (dimension) {
    case 'org_level_3':
      return {
        selectExpr: "p.org_level_3 AS group_name",
        groupByExpr: "p.org_level_3",
        needsTeamJoin: false,
      };
    case 'team':
      return {
        selectExpr: "COALESCE(tm.team_name, p.org_level_3 || '未归属团队') AS group_name",
        groupByExpr: "COALESCE(tm.team_name, p.org_level_3 || '未归属团队')",
        needsTeamJoin: true,
      };
    case 'salesman':
      return {
        selectExpr: "REGEXP_REPLACE(p.salesman_name, '^[0-9]+', '') AS group_name",
        groupByExpr: "REGEXP_REPLACE(p.salesman_name, '^[0-9]+', '')",
        needsTeamJoin: false,
      };
    default:
      return {
        selectExpr: "p.org_level_3 AS group_name",
        groupByExpr: "p.org_level_3",
        needsTeamJoin: false,
      };
  }
}

/** drillPath 步骤 → WHERE 条件 */
function holidayDrillStepToWhere(step: HolidayDrillStep): string {
  const esc = escapeSqlValue;
  const boolDef = HOLIDAY_BOOLEAN_MAP[step.dimension];
  if (boolDef) {
    const boolVal = step.value === boolDef.trueLabel ? 'true' : 'false';
    return `(p.${boolDef.field} = '${boolVal}' OR p.${boolDef.field} = '${boolVal === 'true' ? '1' : '0'}')`;
  }

  switch (step.dimension) {
    case 'org_level_3':
      return `p.org_level_3 = '${esc(step.value)}'`;
    case 'team':
      return `COALESCE(tm.team_name, p.org_level_3 || '未归属团队') = '${esc(step.value)}'`;
    case 'salesman':
      return `REGEXP_REPLACE(p.salesman_name, '^[0-9]+', '') = '${esc(step.value)}'`;
    default:
      return '1=1';
  }
}

/**
 * 假日营销自由维度下钻查询
 *
 * 统一指标：车险保费（万元）、商业险保费（万元）、车险出单人数、总业务员数、车险开单率、商业险开单率
 */
export function generateHolidayFreeDrilldownQuery(
  whereClause: string,
  holidayDates: string[],
  groupBy: HolidayDrillDimension,
  drillPath: HolidayDrillStep[],
  dateField: string = 'policy_date',
): string {
  const holidayValues = buildHolidayDateValues(holidayDates);
  const groupConfig = getHolidayGroupByConfig(groupBy);
  const needsTeamJoin = groupConfig.needsTeamJoin || drillPath.some((s) => s.dimension === 'team');

  // drillPath → WHERE
  const drillWhere = drillPath.map(holidayDrillStepToWhere).join(' AND ');
  const fullWhere = drillWhere ? `${whereClause} AND ${drillWhere}` : whereClause;

  logger.debug('Generating holiday free drilldown SQL', { groupBy, drillPath: drillPath.length });

  const teamJoinCte = needsTeamJoin
    ? `
    team_mapping AS (
      SELECT DISTINCT full_name AS salesman_name, team_name
      FROM SalesmanTeamMapping
    ),`
    : '';

  const teamJoinClause = needsTeamJoin
    ? 'LEFT JOIN team_mapping tm ON p.salesman_name = tm.salesman_name'
    : '';

  return `
    WITH holiday_dates AS (
      SELECT CAST(col0 AS DATE) AS holiday_date
      FROM (VALUES ${holidayValues}) AS t(col0)
    ),
    ${teamJoinCte}
    holiday_policies AS (
      SELECT p.*${needsTeamJoin ? ", COALESCE(tm.team_name, p.org_level_3 || '未归属团队') AS team_name" : ''}
      FROM PolicyFact p
      ${teamJoinClause}
      WHERE ${fullWhere}
        AND CAST(p.${dateField} AS DATE) IN (SELECT holiday_date FROM holiday_dates)
    ),
    -- 总业务员基数（全量，不限于假日）
    all_salesman AS (
      SELECT p.*${needsTeamJoin ? ", COALESCE(tm.team_name, p.org_level_3 || '未归属团队') AS team_name" : ''}
      FROM PolicyFact p
      ${teamJoinClause}
      WHERE ${fullWhere}
    ),
    total_by_group AS (
      SELECT
        ${groupConfig.groupByExpr.replaceAll('p.', 'a.').replaceAll('tm.', 'a.')} AS group_key,
        COUNT(DISTINCT a.salesman_name) AS total_salesman
      FROM all_salesman a
      GROUP BY ${groupConfig.groupByExpr.replaceAll('p.', 'a.').replaceAll('tm.', 'a.')}
    ),
    holiday_stats AS (
      SELECT
        ${groupConfig.selectExpr.replaceAll('p.', 'hp.').replaceAll('tm.', 'hp.')},
        COALESCE(SUM(hp.premium), 0) / 10000.0 AS premium_wan,
        COALESCE(SUM(CASE WHEN hp.is_commercial_insure = '套单' OR hp.is_commercial_insure = '是' THEN hp.premium ELSE 0 END), 0) / 10000.0 AS commercial_premium_wan,
        COUNT(DISTINCT hp.salesman_name) AS active_salesman,
        COUNT(DISTINCT CASE WHEN hp.is_commercial_insure = '套单' OR hp.is_commercial_insure = '是' THEN hp.salesman_name END) AS commercial_active_salesman
      FROM holiday_policies hp
      GROUP BY ${groupConfig.groupByExpr.replaceAll('p.', 'hp.').replaceAll('tm.', 'hp.')}
    )
    SELECT
      h.group_name,
      h.premium_wan,
      h.commercial_premium_wan,
      COALESCE(t.total_salesman, 0) AS total_salesman,
      h.active_salesman,
      h.commercial_active_salesman,
      CASE WHEN COALESCE(t.total_salesman, 0) = 0 THEN 0
        ELSE h.active_salesman * 1.0 / t.total_salesman
      END AS auto_active_rate,
      CASE WHEN COALESCE(t.total_salesman, 0) = 0 THEN 0
        ELSE h.commercial_active_salesman * 1.0 / t.total_salesman
      END AS commercial_active_rate
    FROM holiday_stats h
    LEFT JOIN total_by_group t ON h.group_name = t.group_key
    ORDER BY h.premium_wan DESC
  `;
}
