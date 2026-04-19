/**
 * 维修资源指标（L2-L3）— RepairDim 单表聚合原子指标
 *
 * 来源：server/src/sql/repair.ts + 业务规则字典 § 维修资源分析口径
 *
 * 注意：
 * - L4 复合指标（如本地资源占比 = ClaimsDetail × RepairDim JOIN、导流潜力保费）
 *   不在此注册，留在 SQL 生成器实现，此处只注册原子/L2-L3 指标
 * - 分类 key `repair` 已在 types.ts 登记
 */

import type { MetricDefinition } from '../types.js';

/** 合作状态三态映射 SQL 片段（与 .claude/shared-memory/repair_source_field_mapping.md §3 同源） */
const COOP_TIER_EXPR = `CASE
  WHEN cooperation_status = '1生效中' THEN 'active'
  WHEN cooperation_status IN ('0暂停合作', '7已撤销', '8失效') THEN 'past'
  ELSE 'none'
END`;

/** 非维修单位排除条件（与业务规则字典 §2 同源） */
const NON_REPAIR_EXCLUSION = `(
    repair_shop_name NOT LIKE '%定损%'
    AND repair_shop_name NOT LIKE '%自选%'
    AND repair_shop_name <> '无'
    AND repair_shop_name IS NOT NULL
  )`;

export const repairMetrics: readonly MetricDefinition[] = [
  // ─────── 原子指标 ───────

  {
    id: 'repair_shop_total_count',
    version: '1.0.0',
    name: '合作网点总数',
    category: 'repair',
    tags: ['repair', 'foundation'],
    formula: {
      description: 'RepairDim 中排除非维修单位后的去重网点数',
      unit: '个',
    },
    sql: {
      expression: `COUNT(DISTINCT CASE WHEN ${NON_REPAIR_EXCLUSION} THEN SUBSTR(repair_shop_name, 1, 8) END) AS repair_shop_total_count`,
      requiredColumns: ['repair_shop_name'],
      notes: 'JOIN key 用前 8 位编码；排除"定损/自选/无"关键词',
    },
    display: {
      formatter: 'count',
      label: '合作网点数',
      unit: '个',
    },
    testCases: [
      {
        name: '网点数 > 0',
        input: { whereClause: '1=1' },
        assertions: { repair_shop_total_count: { op: 'gt', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-18', changes: '初版：维修资源板块重设计' }],
  },

  {
    id: 'repair_4s_share',
    version: '1.0.0',
    name: '4S店占比',
    category: 'repair',
    tags: ['repair', 'ratio'],
    formula: {
      description: '4S 店网点数 / 有效合作网点数',
      numerator: 'COUNT(DISTINCT CASE WHEN is_4s_shop THEN shop_code END)',
      denominator: 'COUNT(DISTINCT shop_code)',
      unit: '%',
    },
    sql: {
      expression: `COUNT(DISTINCT CASE WHEN is_4s_shop AND ${NON_REPAIR_EXCLUSION} THEN SUBSTR(repair_shop_name, 1, 8) END) * 1.0 / NULLIF(COUNT(DISTINCT CASE WHEN ${NON_REPAIR_EXCLUSION} THEN SUBSTR(repair_shop_name, 1, 8) END), 0) AS repair_4s_share`,
      requiredColumns: ['is_4s_shop', 'repair_shop_name'],
    },
    display: {
      formatter: 'percent',
      label: '4S 占比',
      unit: '%',
    },
    testCases: [
      {
        name: '4S 占比在 0-1 之间',
        input: { whereClause: '1=1' },
        assertions: { repair_4s_share: { op: 'between', min: 0, max: 1 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-18', changes: '初版' }],
  },

  {
    id: 'repair_cooperation_active_rate',
    version: '1.0.0',
    name: '合作启用率',
    category: 'repair',
    tags: ['repair', 'ratio'],
    formula: {
      description: '已合作（1生效中）网点数 / 有效合作网点数',
      numerator: `COUNT(DISTINCT CASE WHEN ${COOP_TIER_EXPR} = 'active' THEN shop_code END)`,
      denominator: 'COUNT(DISTINCT shop_code)',
      unit: '%',
    },
    sql: {
      expression: `COUNT(DISTINCT CASE WHEN ${COOP_TIER_EXPR} = 'active' AND ${NON_REPAIR_EXCLUSION} THEN SUBSTR(repair_shop_name, 1, 8) END) * 1.0 / NULLIF(COUNT(DISTINCT CASE WHEN ${NON_REPAIR_EXCLUSION} THEN SUBSTR(repair_shop_name, 1, 8) END), 0) AS repair_cooperation_active_rate`,
      requiredColumns: ['cooperation_status', 'repair_shop_name'],
    },
    display: {
      formatter: 'percent',
      label: '合作启用率',
      unit: '%',
    },
    testCases: [
      {
        name: '启用率在 0-1 之间',
        input: { whereClause: '1=1' },
        assertions: { repair_cooperation_active_rate: { op: 'between', min: 0, max: 1 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-18', changes: '初版' }],
  },

  {
    id: 'repair_to_premium_ratio',
    version: '1.0.0',
    name: '修保比',
    category: 'repair',
    tags: ['repair', 'ratio', 'depth'],
    formula: {
      description: '维修产值（核损金额）/ 签单净保费；衡量合作深度',
      numerator: 'SUM(damage_assessment_amount)',
      denominator: 'SUM(net_premium)',
      unit: '倍',
    },
    sql: {
      expression: `SUM(COALESCE(damage_assessment_amount, 0)) * 1.0 / NULLIF(SUM(COALESCE(net_premium, 0)), 0) AS repair_to_premium_ratio`,
      requiredColumns: ['damage_assessment_amount', 'net_premium'],
      notes: '业务解读：<0.3 合作浅可挖掘 / 0.3-0.7 健康 / >0.7 定损偏重需推动保费',
    },
    display: {
      formatter: 'coefficient',
      label: '修保比',
      unit: '倍',
      decimals: 3,
      tooltip: '维修产值 / 签单净保费；越高合作越深',
    },
    testCases: [
      {
        name: '修保比 >= 0',
        input: { whereClause: '1=1' },
        assertions: { repair_to_premium_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-18', changes: '初版' }],
  },

  {
    id: 'repair_damage_amount_total',
    version: '1.0.0',
    name: '维修产值合计',
    category: 'repair',
    tags: ['repair', 'foundation'],
    formula: {
      description: '所有网点核损金额合计（= 维修产值）',
      unit: '元',
    },
    sql: {
      expression: 'SUM(COALESCE(damage_assessment_amount, 0)) AS repair_damage_amount_total',
      requiredColumns: ['damage_assessment_amount'],
    },
    display: {
      formatter: 'premiumWan',
      label: '维修产值',
      unit: '万元',
    },
    testCases: [
      {
        name: '维修产值 >= 0',
        input: { whereClause: '1=1' },
        assertions: { repair_damage_amount_total: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-18', changes: '初版' }],
  },

  {
    id: 'repair_net_premium_total',
    version: '1.0.0',
    name: '网点签单净保费合计',
    category: 'repair',
    tags: ['repair', 'foundation'],
    formula: {
      description: 'RepairDim 中所有网点签单净保费合计',
      unit: '元',
    },
    sql: {
      expression: 'SUM(COALESCE(net_premium, 0)) AS repair_net_premium_total',
      requiredColumns: ['net_premium'],
    },
    display: {
      formatter: 'premiumWan',
      label: '网点净保费',
      unit: '万元',
    },
    testCases: [
      {
        name: '净保费 >= 0',
        input: { whereClause: '1=1' },
        assertions: { repair_net_premium_total: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-18', changes: '初版' }],
  },
];
