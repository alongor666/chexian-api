/**
 * 保费趋势分析 SQL 生成器 — 优质业务占比趋势
 *
 * 从 trend.ts 提取的 generateQualityBusinessTrendQuery 函数。
 */

import {
  type TimeView,
  type ViewPerspective,
  type DateCriteria,
  QUALITY_BUSINESS_CONDITION,
  generatePerspectiveWhere,
} from './shared.js';

/**
 * 生成优质业务占比趋势查询SQL
 *
 * DC-001: 支持动态日期字段
 * V2.0: 支持多视角切换（保费/商业险件数/交强险件数）
 *
 * @param timeView - 时间视图：daily/weekly/monthly
 * @param whereClause - WHERE子句（不包含WHERE关键字）
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @param perspective - 视角类型（默认保费视角）
 * @returns SQL查询字符串
 *
 * 返回字段：
 * - time_period: 时间周期（日期/周/月）
 * - quality_premium: 优质业务保费（视角值）
 * - total_premium: 总保费（视角值）
 * - quality_ratio: 优质业务占比
 */
export function generateQualityBusinessTrendQuery(
  timeView: TimeView,
  whereClause: string = '1=1',
  dateField: DateCriteria = 'policy_date',
  perspective: ViewPerspective = 'premium',
  groupDim: string = 'org_level_3'
): string {
  // DC-001: 使用动态日期字段
  const df = dateField;

  // V2.0: 应用视角筛选条件（险类过滤）
  const perspectiveConditions = generatePerspectiveWhere(perspective, [whereClause]);
  const finalWhereClause = perspectiveConditions.join(' AND ');

  let timeDimension: string;
  let weekNumberExpression: string;

  switch (timeView) {
    case 'daily':
      timeDimension = `CAST(${df} AS VARCHAR)`;
      break;

    case 'weekly':
      weekNumberExpression = `
        CASE
          WHEN DAYOFYEAR(${df}) <= (8 - ISODOW(DATE_TRUNC('year', ${df})))
          THEN 1
          ELSE CAST(CEIL((DAYOFYEAR(${df}) - (8 - ISODOW(DATE_TRUNC('year', ${df})))) / 7.0) AS INTEGER) + 1
        END
      `;
      timeDimension = `CONCAT(
        CAST(YEAR(${df}) AS VARCHAR),
        '-W',
        LPAD(
          CAST(
            ${weekNumberExpression} AS VARCHAR
          ),
          2,
          '0'
        )
      )`;
      break;

    case 'monthly':
      timeDimension = `STRFTIME(${df}, '%Y-%m')`;
      break;

    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }

  return `
    SELECT
      ${timeDimension} AS time_period,
      ${perspective === 'premium'
      ? `SUM(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN premium ELSE 0 END)`
      : `COUNT(DISTINCT CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN policy_no END)`
    } AS quality_premium,
      ${perspective === 'premium'
      ? 'SUM(premium)'
      : 'COUNT(DISTINCT policy_no)'
    } AS total_premium,
      CASE
        WHEN ${perspective === 'premium' ? 'SUM(premium)' : 'COUNT(DISTINCT policy_no)'} > 0 THEN
          ${perspective === 'premium'
      ? `SUM(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN premium ELSE 0 END) / SUM(premium)`
      : `COUNT(DISTINCT CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN policy_no END) * 1.0 / COUNT(DISTINCT policy_no)`
    }
        ELSE 0
      END AS quality_ratio
    FROM PolicyFact
    WHERE ${finalWhereClause}
    GROUP BY ${timeDimension}
    ORDER BY time_period
  `;
}
