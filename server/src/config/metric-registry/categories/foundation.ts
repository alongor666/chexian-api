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

  {
    id: 'per_vehicle_premium',
    version: '1.0.0',
    name: '车均保费',
    category: 'foundation',
    tags: ['core', 'kpi', 'foundation'],
    formula: {
      description: '保费总额 / 去重车架号数（含商业险+交强险）',
      numerator: 'SUM(premium)',
      denominator: 'COUNT(DISTINCT vehicle_frame_no)',
      unit: '元',
    },
    sql: {
      expression: "SUM(premium) / NULLIF(COUNT(DISTINCT COALESCE(NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''), policy_no)), 0) AS per_vehicle_premium",
      requiredColumns: ['premium', 'vehicle_frame_no', 'policy_no'],
      notes: '分母为去重车架号数，车架号为空时回退至保单号。一台车可能有交强险+商业险两张保单，故车均保费 > 件均保费',
    },
    display: {
      formatter: 'average',
      label: '车均保费',
      unit: '元',
      decimals: 0,
      tooltip: '车均保费 = 总保费 / 去重车辆数。分母按车架号去重，一台车计一辆；件均保费分母是保单件数',
    },
    testCases: [
      {
        name: '车均保费大于零',
        input: { whereClause: '1=1' },
        assertions: { per_vehicle_premium: { op: 'gt', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-02', changes: '新增车均保费指标，分母为去重车架号数' }],
  },

  // ===== 续保经营件数（L4 占位符；数据源 renewal_tracker 派生域，真实 SQL 在 server/src/sql/renewal-tracker.ts）=====
  {
    id: 'renewal_unquoted_count',
    version: '1.0.0',
    name: '未报价件数',
    category: 'foundation',
    tags: ['renewal', 'count'],
    formula: {
      description: '应续车中至今无任何有效报价的件数 = 应续件数 − 已报价件数',
      numerator: 'COUNT(DISTINCT vehicle_frame_no)（应续） − 已报价件数',
      unit: '件',
    },
    sql: {
      expression:
        '-- L4 计算，应续件数 − 已报价件数（A − B），由续保 SQL 生成器 renewal-tracker.ts 与诊断脚本 diagnose_renewal_branch.py 实现',
      requiredColumns: ['vehicle_frame_no', 'is_quoted', 'first_quote_time', 'expiry_date'],
      notes: 'L4 计算。数据源为 renewal_tracker 派生域（非 policy 主表）。续保窗口内按车架号去重',
    },
    display: {
      formatter: 'count',
      label: '未报价件数',
      unit: '件',
    },
    testCases: [
      {
        name: '未报价件数非负',
        input: { whereClause: '1=1' },
        assertions: { renewal_unquoted_count: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-06-07', changes: '新增：续保未报价件数（应续 − 已报价），L4 占位符' }],
  },

  {
    id: 'renewal_lost_count',
    version: '1.0.0',
    name: '流失件数',
    category: 'foundation',
    tags: ['renewal', 'count'],
    formula: {
      description: '应续车中尚未续保的件数（含未报价 + 已报价未成交）= 应续件数 − 已续保件数',
      numerator: 'COUNT(DISTINCT vehicle_frame_no)（应续） − 已续保件数',
      unit: '件',
    },
    sql: {
      expression:
        '-- L4 计算，应续件数 − 已续保件数（A − C），由续保 SQL 生成器 renewal-tracker.ts 与诊断脚本 diagnose_renewal_branch.py 实现',
      requiredColumns: ['vehicle_frame_no', 'is_renewed', 'expiry_date'],
      notes:
        'L4 计算。数据源为 renewal_tracker 派生域。⚠️ 仅在已到期窗口表示真实流失；未到期窗口为「待续件数」（尚未到续保动作时点）',
    },
    display: {
      formatter: 'count',
      label: '流失件数',
      unit: '件',
    },
    testCases: [
      {
        name: '流失件数非负',
        input: { whereClause: '1=1' },
        assertions: { renewal_lost_count: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-06-07', changes: '新增：续保流失件数（应续 − 已续保），L4 占位符' }],
  },
];
