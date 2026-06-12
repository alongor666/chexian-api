/**
 * 比率指标（L2-L3）— CASE WHEN 聚合 / 比率计算
 *
 * 来源：server/src/sql/kpi.ts:KPI_SQL
 */

import type { MetricDefinition } from '../types.js';

/**
 * 优质业务条件 SQL 片段
 *
 * SSOT（B301）：`server/src/sql/shared/business-conditions.ts:QUALITY_BUSINESS_CONDITION`。
 * 注册表层（metric-registry）不可反向 import sql/ 层（避免循环依赖），故此处保留本地副本，
 * 但口径必须与 SSOT 一致（非营业客车 + 货车1-9吨）。修改 SSOT 时须同步本处。
 *
 * 优质业务包括：
 * 1. 非新能源车 AND (客户类别为非营业个人/企业/机关客车)
 * 2. 货车 AND 吨位分段为1吨以下或2-9吨
 */
const QUALITY_BUSINESS_CONDITION = `(
    (is_nev = false AND (
      customer_category LIKE '%非营业个人%'
      OR customer_category LIKE '%企业%'
      OR customer_category LIKE '%机关%'
    ))
    OR
    (customer_category LIKE '%货车%' AND tonnage_segment IN ('1吨以下', '2-9吨'))
  )`;

export const ratioMetrics: readonly MetricDefinition[] = [
  {
    id: 'transfer_rate',
    version: '2.0.0',
    name: '过户率',
    category: 'ratio',
    tags: ['kpi', 'ratio'],
    formula: {
      description: '过户保单数 / 总保单数',
      numerator: 'COUNT(DISTINCT 剔除批改后的保单键 WHERE is_transfer)',
      denominator: 'COUNT(DISTINCT 剔除批改后的保单键)',
      unit: '%',
    },
    sql: {
      expression:
        "COUNT(DISTINCT CASE WHEN NULLIF(TRIM(CAST(endorsement_no AS VARCHAR)), '') IS NULL AND is_transfer THEN COALESCE(NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''), NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')) END) * 1.0 / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(TRIM(CAST(endorsement_no AS VARCHAR)), '') IS NULL THEN COALESCE(NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''), NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')) END), 0) as transfer_rate",
      requiredColumns: ['is_transfer', 'endorsement_no', 'policy_no', 'vehicle_frame_no'],
    },
    display: {
      formatter: 'percent',
      label: '过户占比',
      unit: '%',
    },
    testCases: [
      {
        name: '过户率在0-1之间',
        input: { whereClause: '1=1' },
        assertions: { transfer_rate: { op: 'between', min: 0, max: 1 } },
      },
    ],
    changelog: [
      { version: '2.0.0', date: '2026-06-12', changes: '计数口径统一为业绩面板口径：剔除批改(endorsement_no 非空) + policy_key 去重；原 COUNT(*) 含批改多行与交强/商业各一行，同名指标两套值（用户 2026-06-12 裁决以面板口径为准）' },
      { version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' },
    ],
  },

  {
    id: 'telesales_rate',
    version: '1.0.0',
    name: '电销率',
    category: 'ratio',
    tags: ['kpi', 'ratio'],
    formula: {
      description: '电销保单数 / 总保单数',
      numerator: 'COUNT(CASE WHEN is_telemarketing THEN 1 END)',
      denominator: 'COUNT(*)',
      unit: '%',
    },
    sql: {
      expression: 'COUNT(CASE WHEN is_telemarketing THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as telesales_rate',
      requiredColumns: ['is_telemarketing'],
    },
    display: {
      formatter: 'percent',
      label: '电销占比',
      unit: '%',
    },
    testCases: [
      {
        name: '电销率在0-1之间',
        input: { whereClause: '1=1' },
        assertions: { telesales_rate: { op: 'between', min: 0, max: 1 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },

  {
    id: 'renewal_rate',
    version: '2.0.0',
    name: '续保率',
    category: 'ratio',
    tags: ['core', 'kpi', 'ratio', 'renewal'],
    formula: {
      description: '续保保单数 / 总保单数',
      numerator: 'COUNT(DISTINCT 剔除批改后的保单键 WHERE is_renewal)',
      denominator: 'COUNT(DISTINCT 剔除批改后的保单键)',
      unit: '%',
    },
    sql: {
      expression:
        "COUNT(DISTINCT CASE WHEN NULLIF(TRIM(CAST(endorsement_no AS VARCHAR)), '') IS NULL AND is_renewal THEN COALESCE(NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''), NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')) END) * 1.0 / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(TRIM(CAST(endorsement_no AS VARCHAR)), '') IS NULL THEN COALESCE(NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''), NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')) END), 0) as renewal_rate",
      requiredColumns: ['is_renewal', 'endorsement_no', 'policy_no', 'vehicle_frame_no'],
      notes: '此为 KPI 面板的快速续保占比，非续保分析板块的精确续保率（后者基于起保日期到期判断）',
    },
    display: {
      formatter: 'percent',
      label: '续保占比',
      unit: '%',
    },
    testCases: [
      {
        name: '续保率在0-1之间',
        input: { whereClause: '1=1' },
        assertions: { renewal_rate: { op: 'between', min: 0, max: 1 } },
      },
    ],
    changelog: [
      { version: '2.0.0', date: '2026-06-12', changes: '计数口径统一为业绩面板口径：剔除批改(endorsement_no 非空) + policy_key 去重；原 COUNT(*) 含批改多行与交强/商业各一行，同名指标两套值（用户 2026-06-12 裁决以面板口径为准）' },
      { version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' },
    ],
  },

  {
    id: 'commercial_rate',
    version: '1.0.0',
    name: '商业险占比',
    category: 'ratio',
    tags: ['core', 'kpi', 'ratio'],
    formula: {
      description: '商业保险保费 / 总保费',
      numerator: "SUM(CASE WHEN insurance_type = '商业保险' THEN premium ELSE 0 END)",
      denominator: 'SUM(premium)',
      unit: '%',
    },
    sql: {
      expression: "SUM(CASE WHEN insurance_type = '商业保险' THEN premium ELSE 0 END) * 1.0 / NULLIF(SUM(premium), 0) as commercial_rate",
      requiredColumns: ['insurance_type', 'premium'],
    },
    display: {
      formatter: 'percent',
      label: '商业险占比',
      unit: '%',
    },
    testCases: [
      {
        name: '商业险占比在0-1之间',
        input: { whereClause: '1=1' },
        assertions: { commercial_rate: { op: 'between', min: 0, max: 1 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },

  {
    id: 'nev_rate',
    version: '2.0.0',
    name: '新能源率',
    category: 'ratio',
    tags: ['kpi', 'ratio'],
    formula: {
      description: '新能源车保单数 / 总保单数',
      numerator: 'COUNT(DISTINCT 剔除批改后的保单键 WHERE is_nev)',
      denominator: 'COUNT(DISTINCT 剔除批改后的保单键)',
      unit: '%',
    },
    sql: {
      expression:
        "COUNT(DISTINCT CASE WHEN NULLIF(TRIM(CAST(endorsement_no AS VARCHAR)), '') IS NULL AND is_nev THEN COALESCE(NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''), NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')) END) * 1.0 / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(TRIM(CAST(endorsement_no AS VARCHAR)), '') IS NULL THEN COALESCE(NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''), NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')) END), 0) as nev_rate",
      requiredColumns: ['is_nev', 'endorsement_no', 'policy_no', 'vehicle_frame_no'],
    },
    display: {
      formatter: 'percent',
      label: '新能源占比',
      unit: '%',
    },
    testCases: [
      {
        name: '新能源率在0-1之间',
        input: { whereClause: '1=1' },
        assertions: { nev_rate: { op: 'between', min: 0, max: 1 } },
      },
    ],
    changelog: [
      { version: '2.0.0', date: '2026-06-12', changes: '计数口径统一为业绩面板口径：剔除批改(endorsement_no 非空) + policy_key 去重；原 COUNT(*) 含批改多行与交强/商业各一行，同名指标两套值（用户 2026-06-12 裁决以面板口径为准）' },
      { version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' },
    ],
  },

  {
    id: 'new_car_rate',
    version: '2.0.0',
    name: '新车率',
    category: 'ratio',
    tags: ['kpi', 'ratio'],
    formula: {
      description: '新车保单数 / 总保单数',
      numerator: 'COUNT(DISTINCT 剔除批改后的保单键 WHERE is_new_car)',
      denominator: 'COUNT(DISTINCT 剔除批改后的保单键)',
      unit: '%',
    },
    sql: {
      expression:
        "COUNT(DISTINCT CASE WHEN NULLIF(TRIM(CAST(endorsement_no AS VARCHAR)), '') IS NULL AND is_new_car THEN COALESCE(NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''), NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')) END) * 1.0 / NULLIF(COUNT(DISTINCT CASE WHEN NULLIF(TRIM(CAST(endorsement_no AS VARCHAR)), '') IS NULL THEN COALESCE(NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''), NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')) END), 0) as new_car_rate",
      requiredColumns: ['is_new_car', 'endorsement_no', 'policy_no', 'vehicle_frame_no'],
    },
    display: {
      formatter: 'percent',
      label: '新车占比',
      unit: '%',
    },
    testCases: [
      {
        name: '新车率在0-1之间',
        input: { whereClause: '1=1' },
        assertions: { new_car_rate: { op: 'between', min: 0, max: 1 } },
      },
    ],
    changelog: [
      { version: '2.0.0', date: '2026-06-12', changes: '计数口径统一为业绩面板口径：剔除批改(endorsement_no 非空) + policy_key 去重；原 COUNT(*) 含批改多行与交强/商业各一行，同名指标两套值（用户 2026-06-12 裁决以面板口径为准）' },
      { version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' },
    ],
  },

  {
    id: 'quality_business_rate',
    version: '1.0.0',
    name: '优质业务率',
    category: 'ratio',
    tags: ['core', 'kpi', 'ratio'],
    formula: {
      description: '优质业务保单数 / 总保单数',
      numerator: '非新能源客车+优质货车计数',
      denominator: 'COUNT(*)',
      unit: '%',
    },
    sql: {
      expression: `COUNT(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as quality_business_rate`,
      requiredColumns: ['is_nev', 'customer_category', 'tonnage_segment'],
      notes: '优质业务定义：(1) 非新能源+非营业个人/企业/机关客车 (2) 货车+1吨以下或2-9吨',
    },
    display: {
      formatter: 'percent',
      label: '优质业务占比',
      unit: '%',
    },
    testCases: [
      {
        name: '优质业务率在0-1之间',
        input: { whereClause: '1=1' },
        assertions: { quality_business_rate: { op: 'between', min: 0, max: 1 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },

  {
    id: 'commercial_insurance_rate',
    version: '1.0.0',
    name: '商业险投保率',
    category: 'ratio',
    tags: ['kpi', 'ratio'],
    formula: {
      description: '商业险件数 / 交强险件数',
      numerator: "COUNT(CASE WHEN insurance_type LIKE '%商业%' THEN 1 END)",
      denominator: "COUNT(CASE WHEN insurance_type = '交强险' THEN 1 END)",
      unit: '%',
    },
    sql: {
      expression: "COUNT(CASE WHEN insurance_type LIKE '%商业%' THEN 1 END) * 1.0 / NULLIF(COUNT(CASE WHEN insurance_type = '交强险' THEN 1 END), 0) as commercial_insurance_rate",
      requiredColumns: ['insurance_type'],
      notes: '商业险投保率 = 商业险件数 / 交强险件数，衡量客户商业险投保意愿',
    },
    display: {
      formatter: 'percent',
      label: '商业险投保率',
      unit: '%',
    },
    testCases: [
      {
        name: '商业险投保率非负',
        input: { whereClause: '1=1' },
        assertions: { commercial_insurance_rate: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },

  // ── 报价转化分析指标（QuoteConversion VIEW）──

  {
    id: 'underwriting_rate',
    version: '1.0.0',
    name: '承保率（报价→承保）',
    category: 'ratio',
    tags: ['quote-conversion', 'ratio', 'underwriting'],
    formula: {
      description: '承保件数 / 报价件数（单据级）',
      numerator: '已承保报价单数',
      denominator: '全部报价单数',
      unit: '%',
    },
    sql: {
      expression: `ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) as underwriting_rate`,
      requiredColumns: ['is_underwritten'],
      notes: '仅适用于 QuoteConversion VIEW（04_报价清单 Parquet），单据级统计。',
    },
    display: {
      formatter: 'percent',
      label: '承保率',
      unit: '%',
    },
    testCases: [
      {
        name: '承保率在0-100之间',
        input: { whereClause: '1=1' },
        assertions: { underwriting_rate: { op: 'between', min: 0, max: 100 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-04-18', changes: '新增；从 quote-conversion.ts 硬编码公式 conversion_rate 归位到注册表。旧别名 conversion_rate 暂保留用于向后兼容。' },
    ],
  },

  // ===== 续保影响度（L4 占位符；分母需窗口聚合「合计应续」，真实 SQL 在诊断脚本 diagnose_renewal_branch.py）=====
  {
    id: 'renewal_impact_rate',
    version: '1.0.0',
    name: '续保影响度',
    category: 'ratio',
    tags: ['renewal', 'ratio'],
    formula: {
      description:
        '该分类流失导致整体续保缺口扩大的占比；可加和，各分类之和 = 整体续保缺口（1 − 续保率）',
      numerator: 'SUM(流失件数)（按分类聚合）',
      denominator: '合计应续件数（窗口内全部分类的应续件数合计）',
      unit: '%',
    },
    sql: {
      expression:
        '-- L4 计算，流失件数 ÷ 合计应续件数（分母为窗口合计应续，需窗口聚合 SUM(...) OVER()），由诊断脚本 diagnose_renewal_branch.py 实现',
      requiredColumns: ['vehicle_frame_no', 'is_renewed', 'expiry_date', 'org_level_3'],
      notes:
        'L4 计算。遵循「先聚合后计算」：先按分类（机构/团队/业务员）聚合各件数，再以该次分类的合计应续件数为分母，什么分类就按什么合计。⚠️ 仅在已到期窗口表示真实流失影响度（越高越坏）',
    },
    display: {
      formatter: 'percent',
      label: '续保影响度',
      unit: '%',
      decimals: 1,
      tooltip: '续保影响度 = 流失件数 ÷ 合计应续件数；各分类可加和 = 整体续保缺口（越高越坏）',
    },
    testCases: [
      {
        name: '续保影响度非负',
        input: { whereClause: '1=1' },
        assertions: { renewal_impact_rate: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-06-07', changes: '新增：续保影响度（流失 ÷ 合计应续，可加和缺口分解），L4 占位符' }],
  },
];
