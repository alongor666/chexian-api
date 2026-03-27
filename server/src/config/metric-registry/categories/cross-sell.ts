/**
 * 交叉销售指标（L3）— 驾意险推介率
 *
 * 来源：server/src/sql/cross-sell.ts
 */

import type { MetricDefinition } from '../types.js';

export const crossSellMetrics: readonly MetricDefinition[] = [
  {
    id: 'cross_sell_total_rate',
    version: '1.0.0',
    name: '整体推介率',
    category: 'cross_sell',
    tags: ['kpi', 'cross_sell'],
    formula: {
      description: '驾意险件数 / 车险件数',
      numerator: 'SUM(driver_count)',
      denominator: 'SUM(auto_count)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(auto_count) > 0
    THEN ROUND(SUM(driver_count) * 100.0 / SUM(auto_count), 2)
    ELSE 0
  END AS total_rate`,
      requiredColumns: ['auto_count', 'driver_count'],
      notes: '使用 CrossSellDailyAgg 聚合表中的预计算字段',
    },
    display: {
      formatter: 'percent',
      label: '推介率',
      unit: '%',
      decimals: 2,
    },
    testCases: [
      {
        name: '推介率在0-100之间',
        input: { whereClause: '1=1' },
        assertions: { total_rate: { op: 'between', min: 0, max: 100 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cross-sell.ts 迁移' }],
  },

  {
    id: 'cross_sell_danjiao_rate',
    version: '1.0.0',
    name: '单交推介率',
    category: 'cross_sell',
    tags: ['cross_sell'],
    formula: {
      description: '单交下驾意险件数 / 单交车险件数',
      numerator: 'SUM(danjiao_driver_count)',
      denominator: 'SUM(danjiao_auto_count)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(danjiao_auto_count) > 0
    THEN ROUND(SUM(danjiao_driver_count) * 100.0 / SUM(danjiao_auto_count), 2)
    ELSE 0
  END AS danjiao_rate`,
      requiredColumns: ['danjiao_auto_count', 'danjiao_driver_count'],
    },
    display: {
      formatter: 'percent',
      label: '单交推介率',
      unit: '%',
      decimals: 2,
    },
    testCases: [
      {
        name: '单交推介率非负',
        input: { whereClause: '1=1' },
        assertions: { danjiao_rate: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cross-sell.ts 迁移' }],
  },

  {
    id: 'cross_sell_jiaosan_rate',
    version: '1.0.0',
    name: '交三推介率',
    category: 'cross_sell',
    tags: ['cross_sell'],
    formula: {
      description: '交三下驾意险件数 / 交三车险件数',
      numerator: 'SUM(jiaosan_driver_count)',
      denominator: 'SUM(jiaosan_auto_count)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(jiaosan_auto_count) > 0
    THEN ROUND(SUM(jiaosan_driver_count) * 100.0 / SUM(jiaosan_auto_count), 2)
    ELSE 0
  END AS jiaosan_rate`,
      requiredColumns: ['jiaosan_auto_count', 'jiaosan_driver_count'],
    },
    display: {
      formatter: 'percent',
      label: '交三推介率',
      unit: '%',
      decimals: 2,
    },
    testCases: [
      {
        name: '交三推介率非负',
        input: { whereClause: '1=1' },
        assertions: { jiaosan_rate: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cross-sell.ts 迁移' }],
  },

  {
    id: 'cross_sell_zhuquan_rate',
    version: '1.0.0',
    name: '主全推介率',
    category: 'cross_sell',
    tags: ['cross_sell'],
    formula: {
      description: '主全下驾意险件数 / 主全车险件数',
      numerator: 'SUM(zhuquan_driver_count)',
      denominator: 'SUM(zhuquan_auto_count)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(zhuquan_auto_count) > 0
    THEN ROUND(SUM(zhuquan_driver_count) * 100.0 / SUM(zhuquan_auto_count), 2)
    ELSE 0
  END AS zhuquan_rate`,
      requiredColumns: ['zhuquan_auto_count', 'zhuquan_driver_count'],
    },
    display: {
      formatter: 'percent',
      label: '主全推介率',
      unit: '%',
      decimals: 2,
    },
    testCases: [
      {
        name: '主全推介率非负',
        input: { whereClause: '1=1' },
        assertions: { zhuquan_rate: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cross-sell.ts 迁移' }],
  },
];
