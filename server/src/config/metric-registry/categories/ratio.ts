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
    version: '1.0.0',
    name: '过户率',
    category: 'ratio',
    tags: ['kpi', 'ratio'],
    formula: {
      description: '过户保单数 / 总保单数',
      numerator: 'COUNT(CASE WHEN is_transfer THEN 1 END)',
      denominator: 'COUNT(*)',
      unit: '%',
    },
    sql: {
      expression: 'COUNT(CASE WHEN is_transfer THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as transfer_rate',
      requiredColumns: ['is_transfer'],
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
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
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
    version: '1.0.0',
    name: '续保率',
    category: 'ratio',
    tags: ['core', 'kpi', 'ratio', 'renewal'],
    formula: {
      description: '续保保单数 / 总保单数',
      numerator: 'COUNT(CASE WHEN is_renewal THEN 1 END)',
      denominator: 'COUNT(*)',
      unit: '%',
    },
    sql: {
      expression: 'COUNT(CASE WHEN is_renewal THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as renewal_rate',
      requiredColumns: ['is_renewal'],
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
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
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
    version: '1.0.0',
    name: '新能源率',
    category: 'ratio',
    tags: ['kpi', 'ratio'],
    formula: {
      description: '新能源车保单数 / 总保单数',
      numerator: 'COUNT(CASE WHEN is_nev THEN 1 END)',
      denominator: 'COUNT(*)',
      unit: '%',
    },
    sql: {
      expression: 'COUNT(CASE WHEN is_nev THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as nev_rate',
      requiredColumns: ['is_nev'],
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
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
  },

  {
    id: 'new_car_rate',
    version: '1.0.0',
    name: '新车率',
    category: 'ratio',
    tags: ['kpi', 'ratio'],
    formula: {
      description: '新车保单数 / 总保单数',
      numerator: 'COUNT(CASE WHEN is_new_car THEN 1 END)',
      denominator: 'COUNT(*)',
      unit: '%',
    },
    sql: {
      expression: 'COUNT(CASE WHEN is_new_car THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as new_car_rate',
      requiredColumns: ['is_new_car'],
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
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 kpi.ts 迁移' }],
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
];
