/**
 * 销售队伍业绩域指标（category: sales_team）。
 *
 * 数据源是独立的 SalesTeamPerformanceFact，不属于 PolicyFact；因此 SQL 字段使用
 * L4 注释占位，防止 /pivot、/cube 误拼到 PolicyFact。真实聚合唯一入口为
 * server/src/sql/sales-team-performance.ts。
 */

import type { MetricDefinition } from '../types.js';

export const salesTeamMetrics: readonly MetricDefinition[] = [
  {
    id: 'standard_premium',
    version: '1.0.0',
    name: '标保',
    category: 'sales_team',
    tags: ['sales-team', 'premium', 'standardized'],
    timeWindow: 'any',
    additive: true,
    formula: {
      description: '销售队伍明细实收保费乘最终折标系数后的金额合计',
      numerator: 'SUM(标保)',
      unit: '元',
    },
    sql: {
      expression: '-- L4 独立域计算：ROUND(SUM("标保"), 2) AS standard_premium，由 sales-team-performance.ts 实现',
      requiredColumns: ['标保'],
      notes: 'L4 独立域：数据源为 SalesTeamPerformanceFact；不得在 PolicyFact pivot/cube 中执行',
    },
    display: { formatter: 'premiumWan', label: '标保', unit: '万元', decimals: 2 },
    testCases: [
      { name: '标保金额可为冲销后的有符号合计', input: { whereClause: '1=1' }, assertions: { standard_premium: { op: 'type', value: 'number' } } },
    ],
    changelog: [{ version: '1.0.0', date: '2026-07-15', changes: '新增销售队伍业绩域标保指标；口径取 sales_team_rules.sql' }],
  },
  {
    id: 'received_premium',
    version: '1.0.0',
    name: '实收保费',
    category: 'sales_team',
    tags: ['sales-team', 'premium', 'received'],
    timeWindow: 'any',
    additive: true,
    formula: {
      description: '销售队伍业绩明细的实收保费金额合计',
      numerator: 'SUM(实收保费)',
      unit: '元',
    },
    sql: {
      expression: '-- L4 独立域计算：ROUND(SUM("实收保费"), 2) AS received_premium，由 sales-team-performance.ts 实现',
      requiredColumns: ['实收保费'],
      notes: 'L4 独立域：数据源为 SalesTeamPerformanceFact；不得与 PolicyFact 的签单保费混用',
    },
    display: { formatter: 'premiumWan', label: '实收保费', unit: '万元', decimals: 2 },
    testCases: [
      { name: '实收保费为数值', input: { whereClause: '1=1' }, assertions: { received_premium: { op: 'type', value: 'number' } } },
    ],
    changelog: [{ version: '1.0.0', date: '2026-07-15', changes: '新增销售队伍业绩域实收保费指标' }],
  },
  {
    id: 'sales_team_row_count',
    version: '1.0.0',
    name: '销售业绩明细行数',
    category: 'sales_team',
    tags: ['sales-team', 'count', 'row-count'],
    timeWindow: 'any',
    additive: true,
    formula: {
      description: '销售队伍业绩明细行数；同一保单可有多险种或多次实收，不是保单去重件数',
      numerator: 'COUNT(*)',
      unit: '行',
    },
    sql: {
      expression: '-- L4 独立域计算：COUNT(*) AS sales_team_row_count，由 sales-team-performance.ts 实现',
      requiredColumns: ['保单号'],
      notes: 'L4 独立域：严禁复用 PolicyFact policy_count（COUNT DISTINCT 保单号）解释本指标',
    },
    display: { formatter: 'count', label: '明细行数', unit: '行' },
    testCases: [
      { name: '明细行数非负', input: { whereClause: '1=1' }, assertions: { sales_team_row_count: { op: 'gte', value: 0 } } },
    ],
    changelog: [{ version: '1.0.0', date: '2026-07-15', changes: '新增无歧义明细行数，替代本域误导性的 policy_count 别名' }],
  },
];
