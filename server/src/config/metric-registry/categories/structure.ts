/**
 * 业务结构指标（L2）— 客户类别 / 车型占比
 *
 * 来源：PolicyFact.customer_category（车辆使用性质 11 类，详见
 * server/src/config/customer-categories.ts 与业务规则字典）
 *
 * 注：结构占比是单表 FILTER 表达式，可单行表达，属 L2。
 */

import type { MetricDefinition } from '../types.js';

export const structureMetrics: readonly MetricDefinition[] = [
  {
    id: 'household_share_pct',
    version: '1.0.0',
    name: '家自车占比',
    category: 'structure',
    tags: ['kpi', 'structure', 'alert', 'branch-ops'],
    formula: {
      description:
        "客户类别='非营业个人客车' 的保单数 × 100 ÷ 全部保单数",
      numerator: "COUNT(*) FILTER (WHERE customer_category = '非营业个人客车')",
      denominator: 'COUNT(*)',
      unit: '%',
    },
    sql: {
      expression: `ROUND(
    COUNT(*) FILTER (WHERE customer_category = '非营业个人客车') * 100.0
    / NULLIF(COUNT(*), 0),
    2
  ) AS household_share_pct`,
      requiredColumns: ['customer_category'],
      notes:
        '结构性指标，反映业务质量底色。「非营业个人客车」即家自车，其赔付与续保表现普遍优于其他车型。规范文本见 src/shared/config/customer-categories.ts',
    },
    display: {
      formatter: 'percent',
      label: '家自车占比',
      unit: '%',
      decimals: 2,
      tooltip:
        '非营业个人客车保单数占比。≥70% 优秀 / 65-70% 健康 / 60-65% 异常 / <60% 危险',
    },
    testCases: [
      {
        name: '占比类型为数字',
        input: { whereClause: '1=1' },
        assertions: { household_share_pct: { op: 'type', value: 'number' } },
      },
      {
        name: '占比在 [0, 100] 区间',
        input: { whereClause: '1=1' },
        assertions: {
          household_share_pct: { op: 'between', min: 0, max: 100 },
        },
      },
    ],
    thresholds: {
      direction: 'lower_worse',
      notice: 70,
      warn: 65,
      danger: 60,
      unit: '%',
      source: 'skills/diagnose-html-render/lib/alerts.py v1.7 (2026-05-13)',
    },
    changelog: [
      {
        version: '1.0.0',
        date: '2026-05-13',
        changes: '新增：与诊断技能 alerts.py v1.7 阈值对齐（70/65/60，lower_worse）',
      },
    ],
  },
];
