/**
 * 交叉销售指标（L3）— 驾意险推介率
 *
 * 来源：server/src/sql/cross-sell.ts
 */

import type { MetricDefinition } from '../types.js';

export const crossSellMetrics: readonly MetricDefinition[] = [
  {
    id: 'cross_sell_total_rate',
    timeWindow: 'any',
    additive: false,
    version: '2.0.0',
    name: '整体推介率',
    category: 'cross_sell',
    tags: ['kpi', 'cross_sell'],
    formula: {
      description: '驾意险推介件数 / 商业险出单件数（分子分母均限主全+交三，不含纯交强/单交）',
      numerator: "SUM(driver_count) WHERE coverage_combination IN ('主全','交三')",
      denominator: "SUM(auto_count) WHERE coverage_combination IN ('主全','交三')",
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(CASE WHEN coverage_combination IN ('主全', '交三') THEN auto_count ELSE 0 END) > 0
    THEN ROUND(
      SUM(CASE WHEN coverage_combination IN ('主全', '交三') THEN driver_count ELSE 0 END) * 100.0
      / SUM(CASE WHEN coverage_combination IN ('主全', '交三') THEN auto_count ELSE 0 END), 2)
    ELSE 0
  END AS total_rate`,
      requiredColumns: ['auto_count', 'driver_count', 'coverage_combination'],
      notes:
        '使用 CrossSellDailyAgg 聚合表中的预计算字段。' +
        '红线（business-domain.md）：推介率分母为商业险出单件数（主全+交三），不含纯交强/单交；' +
        '与 cross-sell.ts total_auto_count/total_driver_count 同口径。',
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
    changelog: [
      {
        version: '2.0.0',
        date: '2026-06-12',
        changes:
          '分子分母限定 coverage_combination IN (主全,交三)：原对全险别求和（分母含单交，' +
          '稀释整体推介率），违反推介率分母红线，与 SQL 实现 cross-sell.ts 不一致。',
      },
      { version: '1.0.0', date: '2026-03-27', changes: '从 cross-sell.ts 迁移' },
    ],
  },

  {
    id: 'cross_sell_danjiao_rate',
    timeWindow: 'any',
    additive: false,
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
    timeWindow: 'any',
    additive: false,
    version: '1.1.0',
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
    thresholds: {
      direction: 'lower_worse',
      notice: 70,
      warn: 65,
      danger: 60,
      unit: '%',
      source: '业务经验阈值上收（原 src/features/dashboard/crossSellRateStatus.ts 前端硬编码，2026-07-07 注册表化）',
    },
    changelog: [
      {
        version: '1.1.0',
        date: '2026-07-07',
        changes:
          '新增四级亮灯阈值（70/65/60，lower_worse）：原前端 crossSellRateStatus.ts 硬编码阈值上收注册表为事实源，' +
          '前端保留镜像常量并由 tests/cross-sell-rate-status.test.ts 同步用例锁定。公式无变化。',
      },
      { version: '1.0.0', date: '2026-03-27', changes: '从 cross-sell.ts 迁移' },
    ],
  },

  {
    id: 'cross_sell_zhuquan_rate',
    timeWindow: 'any',
    additive: false,
    version: '1.1.0',
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
    thresholds: {
      direction: 'lower_worse',
      notice: 80,
      warn: 75,
      danger: 70,
      unit: '%',
      source: '业务经验阈值上收（原 src/features/dashboard/crossSellRateStatus.ts 前端硬编码，2026-07-07 注册表化）',
    },
    changelog: [
      {
        version: '1.1.0',
        date: '2026-07-07',
        changes:
          '新增四级亮灯阈值（80/75/70，lower_worse）：原前端 crossSellRateStatus.ts 硬编码阈值上收注册表为事实源，' +
          '前端保留镜像常量并由 tests/cross-sell-rate-status.test.ts 同步用例锁定。公式无变化。',
      },
      { version: '1.0.0', date: '2026-03-27', changes: '从 cross-sell.ts 迁移' },
    ],
  },
];
