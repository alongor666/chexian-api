/**
 * 增长指标（L3）— 同比/环比增长率
 *
 * 来源：server/src/sql/growth.ts
 *
 * 注意：完整的 YoY/MoM 查询（含 FULL OUTER JOIN 和时间偏移）属于 L4，
 * 不在此注册。这里只注册增长率的 SELECT 表达式片段。
 */

import type { MetricDefinition } from '../types.js';

export const growthMetrics: readonly MetricDefinition[] = [
  {
    id: 'growth_rate_yoy',
    version: '1.0.0',
    name: '同比增长率',
    category: 'growth',
    tags: ['kpi', 'growth'],
    formula: {
      description: '(本期 - 去年同期) / 去年同期',
      numerator: 'current_value - previous_value',
      denominator: 'previous_value',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN previous_value > 0
    THEN ROUND((current_value - previous_value) * 100.0 / previous_value, 2)
    ELSE NULL
  END AS growth_rate_yoy`,
      requiredColumns: ['current_value', 'previous_value'],
      notes: 'current_value 和 previous_value 需要在外层 CTE 中预计算',
    },
    display: {
      formatter: 'percent',
      label: '同比增长率',
      unit: '%',
      decimals: 2,
    },
    testCases: [
      {
        name: '增长率类型为数字',
        input: { whereClause: '1=1' },
        assertions: { growth_rate_yoy: { op: 'type', value: 'number' } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 growth.ts 迁移' }],
  },

  {
    id: 'growth_rate_mom',
    version: '1.0.0',
    name: '环比增长率',
    category: 'growth',
    tags: ['kpi', 'growth'],
    formula: {
      description: '(本期 - 上期) / 上期',
      numerator: 'current_value - previous_value',
      denominator: 'previous_value',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN previous_value > 0
    THEN ROUND((current_value - previous_value) * 100.0 / previous_value, 2)
    ELSE NULL
  END AS growth_rate_mom`,
      requiredColumns: ['current_value', 'previous_value'],
      notes: 'current_value 和 previous_value 需要在外层 CTE 中预计算（月度偏移）',
    },
    display: {
      formatter: 'percent',
      label: '环比增长率',
      unit: '%',
      decimals: 2,
    },
    testCases: [
      {
        name: '增长率类型为数字',
        input: { whereClause: '1=1' },
        assertions: { growth_rate_mom: { op: 'type', value: 'number' } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 growth.ts 迁移' }],
  },
];
