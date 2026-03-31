/**
 * 成本指标（L3）— 比率计算
 *
 * 来源：server/src/sql/cost.ts
 *
 * 注意：这些 SQL 片段是"指标表达式"级别，
 * 需要在 CTE（policy_exposure）已计算 exposure_days 后使用。
 * cost.ts 中的完整查询（含 CTE）属于 L4 组合查询，不在此注册。
 *
 * 这里注册的是各指标的 SELECT 表达式片段。
 */

import type { MetricDefinition } from '../types.js';

export const costMetrics: readonly MetricDefinition[] = [
  {
    id: 'earned_claim_ratio',
    version: '1.0.0',
    name: '满期赔付率',
    category: 'cost',
    tags: ['core', 'kpi', 'cost'],
    formula: {
      description: '已报告赔款 / 满期保费',
      numerator: 'SUM(reported_claims)',
      denominator: 'SUM(premium * exposure_days / 365)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0
    THEN ROUND(SUM(reported_claims) * 100.0 / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0), 2)
    ELSE NULL
  END AS earned_claim_ratio`,
      requiredColumns: ['premium', 'reported_claims', 'exposure_days'],
      notes: '需在 CTE 中预算 exposure_days = LEAST(GREATEST(DATEDIFF(day, 起保日, 截止日), 0), 365)',
    },
    display: {
      formatter: 'percent',
      label: '赔付率',
      unit: '%',
      decimals: 2,
      tooltip: '满期赔付率 = 已报告赔款 / 满期保费 × 100%',
    },
    testCases: [
      {
        name: '赔付率非负',
        input: { whereClause: '1=1' },
        assertions: { earned_claim_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' }],
  },

  {
    id: 'expense_ratio',
    version: '1.0.0',
    name: '费用率',
    category: 'cost',
    tags: ['kpi', 'cost'],
    formula: {
      description: '费用金额 / 保费',
      numerator: 'SUM(fee_amount)',
      denominator: 'SUM(premium)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium) > 0
    THEN ROUND(SUM(COALESCE(fee_amount, 0)) * 100.0 / SUM(premium), 2)
    ELSE NULL
  END AS expense_ratio`,
      requiredColumns: ['fee_amount', 'premium'],
    },
    display: {
      formatter: 'percent',
      label: '费用率',
      unit: '%',
      decimals: 2,
    },
    testCases: [
      {
        name: '费用率非负',
        input: { whereClause: '1=1' },
        assertions: { expense_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' }],
  },

  {
    id: 'avg_claim_amount',
    version: '1.0.0',
    name: '案均赔款',
    category: 'cost',
    tags: ['cost'],
    formula: {
      description: '已报告赔款 / 赔案件数',
      numerator: 'SUM(reported_claims)',
      denominator: 'SUM(claim_cases)',
      unit: '元',
    },
    sql: {
      expression: `CASE
    WHEN SUM(claim_cases) > 0
    THEN ROUND(SUM(reported_claims) / CAST(SUM(claim_cases) AS DOUBLE), 2)
    ELSE NULL
  END AS avg_claim_amount`,
      requiredColumns: ['reported_claims', 'claim_cases'],
    },
    display: {
      formatter: 'premiumWan',
      label: '案均赔款',
      unit: '万元',
    },
    testCases: [
      {
        name: '案均赔款非负',
        input: { whereClause: '1=1' },
        assertions: { avg_claim_amount: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' }],
  },

  {
    id: 'earned_premium',
    version: '1.0.0',
    name: '满期保费',
    category: 'cost',
    tags: ['cost'],
    formula: {
      description: '保费按满期天数折算',
      numerator: 'SUM(premium * exposure_days / 365)',
      unit: '元',
    },
    sql: {
      expression: 'ROUND(SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0), 2) AS earned_premium',
      requiredColumns: ['premium', 'exposure_days'],
      notes: '需在 CTE 中预算 exposure_days',
    },
    display: {
      formatter: 'premiumWan',
      label: '满期保费',
      unit: '万元',
    },
    testCases: [
      {
        name: '满期保费非负',
        input: { whereClause: '1=1' },
        assertions: { earned_premium: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' }],
  },

  {
    id: 'variable_cost_ratio',
    version: '1.0.0',
    name: '变动成本率',
    category: 'cost',
    tags: ['core', 'kpi', 'cost'],
    formula: {
      description: '满期赔付率 + 费用率（注意：两个分母不同）',
      numerator: '已报告赔款/满期保费 + 费用金额/签单保费',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0 AND SUM(premium) > 0
    THEN ROUND(
      SUM(reported_claims) * 100.0 / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) +
      SUM(COALESCE(fee_amount, 0)) * 100.0 / SUM(premium),
      2
    )
    ELSE NULL
  END AS variable_cost_ratio`,
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'exposure_days'],
      notes: '赔付率分母=满期保费，费用率分母=签单保费。可超100%（亏损）',
    },
    display: {
      formatter: 'percent',
      label: '变动成本率',
      unit: '%',
      decimals: 2,
      tooltip: '变动成本率 = 满期赔付率 + 费用率。≤91% 正常，91-94% 预警，>94% 危险',
    },
    testCases: [
      {
        name: '变动成本率非负',
        input: { whereClause: '1=1' },
        assertions: { variable_cost_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '新增，与 cost.ts:generateVariableCostQuery 一致' }],
  },

  {
    id: 'earned_loss_frequency',
    version: '1.0.0',
    name: '满期出险率',
    category: 'cost',
    tags: ['cost'],
    formula: {
      description: '赔案件数 * 365 / 满期天数合计（年化）',
      numerator: 'SUM(claim_cases) * 365',
      denominator: 'SUM(exposure_days)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(exposure_days) > 0
    THEN ROUND(CAST(SUM(claim_cases) AS DOUBLE) * 365.0 * 100.0 / CAST(SUM(exposure_days) AS DOUBLE), 2)
    ELSE NULL
  END AS earned_loss_frequency`,
      requiredColumns: ['claim_cases', 'exposure_days'],
      notes: '年化出险率，需在 CTE 中预算 exposure_days',
    },
    display: {
      formatter: 'percent',
      label: '出险率',
      unit: '%',
      decimals: 2,
    },
    testCases: [
      {
        name: '出险率非负',
        input: { whereClause: '1=1' },
        assertions: { earned_loss_frequency: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' }],
  },

  {
    id: 'earned_margin_amount',
    version: '1.0.0',
    name: '满期边际贡献额',
    category: 'cost',
    tags: ['core', 'kpi', 'cost', 'margin'],
    formula: {
      description: '满期保费 × (1 - 已报告赔款/满期保费 - 费用金额/签单保费)',
      numerator: 'earned_premium × (1 - earned_claim_ratio - expense_ratio)',
      unit: '元',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0 AND SUM(premium) > 0
    THEN ROUND(
      SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) * (
        1.0
        - SUM(reported_claims) / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0)
        - SUM(COALESCE(fee_amount, 0)) / SUM(premium)
      ), 2
    )
    ELSE NULL
  END AS earned_margin_amount`,
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'exposure_days'],
      notes: '基于已赚保费的实际边际贡献，随满期天数增长而变化。已满期保单与 projected_margin_amount 相等',
    },
    display: {
      formatter: 'premiumWan',
      label: '满期边际贡献额',
      unit: '万元',
      tooltip: '满期边际贡献额 = 满期保费 × (1 - 满期赔付率 - 费用率)。跨日期对比可判断赔付恶化/改善',
    },
    testCases: [
      {
        name: '满期边际贡献额可为负（亏损）',
        input: { whereClause: '1=1' },
        assertions: { earned_margin_amount: { op: 'type', value: 'number' } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-31', changes: '新增：时序对比核心指标，诊断脚本同步使用' }],
  },

  {
    id: 'projected_margin_amount',
    version: '1.0.0',
    name: '预估边际贡献额',
    category: 'cost',
    tags: ['core', 'kpi', 'cost', 'margin'],
    formula: {
      description: '签单保费 × (1 - 已报告赔款/满期保费 - 费用金额/签单保费)',
      numerator: 'premium × (1 - earned_claim_ratio - expense_ratio)',
      unit: '元',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0 AND SUM(premium) > 0
    THEN ROUND(
      SUM(premium) * (
        1.0
        - SUM(reported_claims) / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0)
        - SUM(COALESCE(fee_amount, 0)) / SUM(premium)
      ), 2
    )
    ELSE NULL
  END AS projected_margin_amount`,
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'exposure_days'],
      notes: '假设全部保费赚完后的预估边际贡献，用于预判最终盈亏。与 earned_margin_amount 共享变动成本率，仅保费基数不同',
    },
    display: {
      formatter: 'premiumWan',
      label: '预估边际贡献额',
      unit: '万元',
      tooltip: '预估边际贡献额 = 签单保费 × (1 - 满期赔付率 - 费用率)。未满期保单差异越大说明待赚保费越多',
    },
    testCases: [
      {
        name: '预估边际贡献额可为负（亏损）',
        input: { whereClause: '1=1' },
        assertions: { projected_margin_amount: { op: 'type', value: 'number' } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-31', changes: '新增：时序对比核心指标，诊断脚本同步使用' }],
  },
];
