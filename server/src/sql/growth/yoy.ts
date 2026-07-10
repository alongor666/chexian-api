/**
 * 增长率分析 — 同比增长率查询
 *
 * 同比增长率 = (当期值 - 去年同期值) / 去年同期值
 *
 * DC-001: 支持动态日期字段
 */

import { DateCriteria } from '../../types/data.js';
import { buildDateCondition } from '../../utils/sql-sanitizer.js';
import {
  GrowthConfig,
  generateTimeExpression,
  generateShiftedTimeExpression,
} from './shared.js';

/**
 * 生成同比增长率查询SQL
 * 同比增长率 = (当期值 - 去年同期值) / 去年同期值
 *
 * DC-001: 支持动态日期字段
 *
 * 实现要点（7a2849 修复）：
 *   1) previous_period 直接把原始日期 +1 年再 DATE_TRUNC，保证 weekly 视图
 *      两侧落在同一周一边界（旧版 `DATE_TRUNC('week',date)` 之后用
 *      `DATE_ADD(p.time_period, INTERVAL '1 year')` 把周一偏到周二，
 *      永不匹配，整列 NULL/-100%）。
 *   2) 用 LEFT JOIN 而非 FULL OUTER JOIN —— FULL OUTER 在 previous 侧未匹配
 *      时输出 time_period=p.time_period（去年时点）、current=0、growth=-100%
 *      的幽灵行，对用户表现为"今年没数据"被报告为"-100% 增长"。
 *   3) **owner review 二轮修复**：当 config 同时提供 currentPeriod 与
 *      previousPeriod 时，current_period/previous_period CTE 分别叠加对应
 *      日期窗 —— 修复"whereClause 共用 startDate/endDate 把 previous 也限到
 *      当年"的生产路径 bug。路由层须先剥离 startDate/endDate（避免与
 *      whereClause 重复）。两个 period 均不传时退化到旧路径（保持调用方兼容）。
 *
 * @param config - 增长率配置（currentPeriod/previousPeriod 必须成对传入）
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @returns SQL查询字符串
 */
export function generateYoYGrowthQuery(
  config: GrowthConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  const {
    timeView,
    metric = 'SUM(premium)',
    groupBy = [],
    whereClause = '1=1',
    currentPeriod,
    previousPeriod,
  } = config;
  // DC-001: 使用动态日期字段
  const currentTimeExpr = generateTimeExpression(timeView, dateField);
  // 先位移再截断 —— weekly/monthly/quarterly 两侧边界对齐的关键
  const previousTimeExpr = generateShiftedTimeExpression(timeView, dateField, '1 year');
  const groupByClause = groupBy.length > 0 ? `, ${groupBy.join(', ')}` : '';

  // 7a2849 二轮修复：成对 currentPeriod/previousPeriod 时分别拼日期窗
  // 路由层契约：传 currentPeriod/previousPeriod 时，whereClause 必须不含 startDate/endDate
  const hasPairedPeriods = Boolean(currentPeriod && previousPeriod);
  const currentDateFilter = hasPairedPeriods
    ? ` AND ${buildDateCondition(dateField, '>=', currentPeriod!.startDate)} AND ${buildDateCondition(dateField, '<=', currentPeriod!.endDate)}`
    : '';
  const previousDateFilter = hasPairedPeriods
    ? ` AND ${buildDateCondition(dateField, '>=', previousPeriod!.startDate)} AND ${buildDateCondition(dateField, '<=', previousPeriod!.endDate)}`
    : '';

  // B306/F-02 单扫合并：旧版 current_period/previous_period 双 CTE 各全量扫一次
  // PolicyFact；改为 CROSS JOIN (0,1) 两侧标记后单次扫描 + 单次 GROUP BY，
  // 再按 side pivot 还原「当期 LEFT JOIN 去年同期」的行集语义：
  //   - has_current 存在性标志 = 旧版 LEFT JOIN 只保留当期出现过的分组
  //   - previous_value 缺失补 0、previous=0 时 growth_rate 为 NULL，与旧版一致
  // paired 模式额外注入仅含日期列的 (当期窗 OR 去年窗) 谓词，可下推到扫描层做 zonemap 剪枝。
  const scanWindowFilter = hasPairedPeriods
    ? ` AND ((1=1${currentDateFilter}) OR (1=1${previousDateFilter}))`
    : '';
  const groupByCols = groupBy.length > 0 ? `, ${groupBy.join(', ')}` : '';

  return `
    WITH combined AS (
      SELECT
        CASE WHEN sides.side = 1 THEN ${previousTimeExpr} ELSE ${currentTimeExpr} END AS time_period,
        sides.side AS side,
        ${metric} AS value${groupByClause}
      FROM PolicyFact
      CROSS JOIN (VALUES (0), (1)) AS sides(side)
      WHERE (${whereClause})${scanWindowFilter}
        AND ((sides.side = 0${currentDateFilter}) OR (sides.side = 1${previousDateFilter}))
      GROUP BY 1, 2${groupByCols}
    ),
    pivoted AS (
      SELECT
        time_period${groupByCols},
        MAX(CASE WHEN side = 0 THEN 1 ELSE 0 END) AS has_current,
        MAX(CASE WHEN side = 0 THEN value END) AS current_value,
        MAX(CASE WHEN side = 1 THEN value END) AS previous_value_raw
      FROM combined
      GROUP BY time_period${groupByCols}
    )
    SELECT
      time_period,
      current_value,
      COALESCE(previous_value_raw, 0) AS previous_value,
      CASE
        WHEN COALESCE(previous_value_raw, 0) = 0 THEN NULL
        ELSE (current_value - COALESCE(previous_value_raw, 0)) / COALESCE(previous_value_raw, 0)
      END AS growth_rate
      ${groupBy.length > 0 ? `, ${groupBy.join(', ')}` : ''}
    FROM pivoted
    WHERE has_current = 1
    ORDER BY time_period
  `;
}
