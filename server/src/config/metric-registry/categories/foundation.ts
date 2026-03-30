/**
 * 基础指标（L1）— 简单聚合
 *
 * 来源：server/src/sql/kpi.ts:KPI_SQL
 */

import type { MetricDefinition } from '../types.js';

export const foundationMetrics: readonly MetricDefinition[] = [
  {
    id: 'total_premium',
    version: '1.0.0',
    name: '总保费',
    category: 'foundation',
    tags: ['core', 'kpi', 'foundation'],
    formula: {
      description: '所有保单保费之和',
      numerator: 'SUM(premium)',
      unit: '元',
    },
    sql: {
      expression: 'SUM(premium) as total_premium',
      requiredColumns: ['premium'],
    },
    display: {
      formatter: 'premiumWan',
      label: '总保费',
      unit: '万元',
    },
    testCases: [
      {
        name: '全表保费非零',
        input: { whereClause: '1=1' },
        assertions: { total_premium: { op: 'gt', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },

  {
    id: 'policy_count',
    version: '1.0.0',
    name: '保单件数',
    category: 'foundation',
    tags: ['core', 'kpi', 'foundation'],
    formula: {
      description: '去重保单计数',
      numerator: 'COUNT(DISTINCT policy_no)',
      unit: '件',
    },
    sql: {
      expression: 'COUNT(DISTINCT policy_no) as policy_count',
      requiredColumns: ['policy_no'],
    },
    display: {
      formatter: 'count',
      label: '保单件数',
      unit: '件',
    },
    testCases: [
      {
        name: '全表保单非零',
        input: { whereClause: '1=1' },
        assertions: { policy_count: { op: 'gt', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },

  {
    id: 'org_count',
    version: '1.0.0',
    name: '机构数',
    category: 'foundation',
    tags: ['kpi', 'foundation'],
    formula: {
      description: '去重三级机构计数',
      numerator: 'COUNT(DISTINCT org_level_3)',
      unit: '个',
    },
    sql: {
      expression: 'COUNT(DISTINCT org_level_3) as org_count',
      requiredColumns: ['org_level_3'],
    },
    display: {
      formatter: 'count',
      label: '机构数',
      unit: '个',
    },
    testCases: [
      {
        name: '机构数合理范围',
        input: { whereClause: '1=1' },
        assertions: { org_count: { op: 'between', min: 1, max: 50 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },

  {
    id: 'salesman_count',
    version: '1.0.0',
    name: '业务员数',
    category: 'foundation',
    tags: ['kpi', 'foundation'],
    formula: {
      description: '去重业务员计数',
      numerator: 'COUNT(DISTINCT salesman_name)',
      unit: '人',
    },
    sql: {
      expression: 'COUNT(DISTINCT salesman_name) as salesman_count',
      requiredColumns: ['salesman_name'],
    },
    display: {
      formatter: 'count',
      label: '业务员数',
      unit: '人',
    },
    testCases: [
      {
        name: '业务员数非零',
        input: { whereClause: '1=1' },
        assertions: { salesman_count: { op: 'gt', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },

  {
    id: 'per_capita_premium',
    version: '1.0.0',
    name: '人均保费',
    category: 'foundation',
    tags: ['core', 'kpi', 'foundation'],
    formula: {
      description: '保费总额 / 业务员数',
      numerator: 'SUM(premium)',
      denominator: 'COUNT(DISTINCT salesman_name)',
      unit: '元',
    },
    sql: {
      expression: 'SUM(premium) / NULLIF(COUNT(DISTINCT salesman_name), 0) as per_capita_premium',
      requiredColumns: ['premium', 'salesman_name'],
      notes: 'NULLIF 防除零',
    },
    display: {
      formatter: 'premiumWan',
      label: '人均保费',
      unit: '万元',
    },
    testCases: [
      {
        name: '人均保费非零',
        input: { whereClause: '1=1' },
        assertions: { per_capita_premium: { op: 'gt', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },
];
