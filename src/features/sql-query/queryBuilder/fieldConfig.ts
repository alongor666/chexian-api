/**
 * SQL 查询构建器字段配置
 *
 * 定义可用于查询构建的字段元数据
 */

import type { FieldDefinition, PresetMeasure } from './types';

/**
 * 维度字段配置（14个）
 */
export const DIMENSION_FIELDS: FieldDefinition[] = [
  // 核心维度
  {
    field: 'org_level_3',
    label: '机构',
    type: 'dimension',
    dataType: 'string',
    group: '组织',
    description: '三级机构名称',
  },
  {
    field: 'salesman_name',
    label: '业务员',
    type: 'dimension',
    dataType: 'string',
    group: '组织',
    description: '业务员姓名',
  },
  {
    field: 'customer_category',
    label: '客户类别',
    type: 'dimension',
    dataType: 'string',
    group: '业务',
    description: '客户类别（个人/企业等）',
  },
  {
    field: 'insurance_type',
    label: '险类',
    type: 'dimension',
    dataType: 'string',
    group: '业务',
    description: '保险类型（交强险/商业险等）',
  },
  {
    field: 'coverage_combination',
    label: '险别组合',
    type: 'dimension',
    dataType: 'string',
    group: '业务',
    description: '险别组合类型',
  },
  // 日期维度
  {
    field: 'policy_date',
    label: '签单日期',
    type: 'dimension',
    dataType: 'date',
    group: '时间',
    description: '保单签单日期',
  },
  {
    field: 'insurance_start_date',
    label: '起保日期',
    type: 'dimension',
    dataType: 'date',
    group: '时间',
    description: '保险起始日期',
  },
  // 标志维度
  {
    field: 'is_renewal',
    label: '是否续保',
    type: 'dimension',
    dataType: 'boolean',
    group: '标志',
    description: '是否为续保业务',
  },
  {
    field: 'is_new_car',
    label: '是否新车',
    type: 'dimension',
    dataType: 'boolean',
    group: '标志',
    description: '是否为新车',
  },
  {
    field: 'is_nev',
    label: '是否新能源',
    type: 'dimension',
    dataType: 'boolean',
    group: '标志',
    description: '是否为新能源车',
  },
  {
    field: 'is_transfer',
    label: '是否过户',
    type: 'dimension',
    dataType: 'boolean',
    group: '标志',
    description: '是否为过户车',
  },
  {
    field: 'is_telemarketing',
    label: '是否电销',
    type: 'dimension',
    dataType: 'boolean',
    group: '标志',
    description: '是否电销渠道',
  },
  {
    field: 'tonnage_segment',
    label: '吨位分段',
    type: 'dimension',
    dataType: 'string',
    group: '车辆',
    description: '货车吨位分段',
  },
  {
    field: 'terminal_source',
    label: '终端来源',
    type: 'dimension',
    dataType: 'string',
    group: '渠道',
    description: '业务终端来源',
  },
];

/**
 * 度量字段配置（6个）
 */
export const MEASURE_FIELDS: FieldDefinition[] = [
  {
    field: 'premium',
    label: '保费',
    type: 'measure',
    dataType: 'number',
    aggregates: ['SUM', 'AVG', 'MIN', 'MAX'],
    defaultAggregate: 'SUM',
    description: '签单保费金额',
  },
  {
    field: 'policy_no',
    label: '保单号',
    type: 'measure',
    dataType: 'string',
    aggregates: ['COUNT', 'COUNT_DISTINCT'],
    defaultAggregate: 'COUNT_DISTINCT',
    description: '保单数量统计',
  },
  {
    field: 'commercial_pricing_factor',
    label: '自主定价系数',
    type: 'measure',
    dataType: 'number',
    aggregates: ['AVG', 'MIN', 'MAX'],
    defaultAggregate: 'AVG',
    description: '商车自主定价系数',
  },
  {
    field: 'claim_cases',
    label: '赔案件数',
    type: 'measure',
    dataType: 'number',
    aggregates: ['SUM', 'AVG'],
    defaultAggregate: 'SUM',
    description: '赔案件数统计',
  },
  {
    field: 'reported_claims',
    label: '已报告赔款',
    type: 'measure',
    dataType: 'number',
    aggregates: ['SUM', 'AVG'],
    defaultAggregate: 'SUM',
    description: '已报告赔款金额',
  },
  {
    field: 'fee_amount',
    label: '费用金额',
    type: 'measure',
    dataType: 'number',
    aggregates: ['SUM', 'AVG'],
    defaultAggregate: 'SUM',
    description: '费用金额统计',
  },
];

/**
 * 预设度量（快捷选择）
 */
export const PRESET_MEASURES: PresetMeasure[] = [
  {
    id: 'total_premium',
    label: '总保费',
    field: 'premium',
    aggregate: 'SUM',
    alias: '总保费',
    description: 'SUM(premium)',
  },
  {
    id: 'policy_count',
    label: '保单件数',
    field: 'policy_no',
    aggregate: 'COUNT_DISTINCT',
    alias: '保单件数',
    description: 'COUNT(DISTINCT policy_no)',
  },
  {
    id: 'avg_premium',
    label: '平均保费',
    field: 'premium',
    aggregate: 'AVG',
    alias: '平均保费',
    description: 'AVG(premium)',
  },
  {
    id: 'avg_coefficient',
    label: '平均系数',
    field: 'commercial_pricing_factor',
    aggregate: 'AVG',
    alias: '平均系数',
    description: 'AVG(commercial_pricing_factor)',
  },
  {
    id: 'total_claims',
    label: '总赔款',
    field: 'reported_claims',
    aggregate: 'SUM',
    alias: '总赔款',
    description: 'SUM(reported_claims)',
  },
  {
    id: 'total_fees',
    label: '总费用',
    field: 'fee_amount',
    aggregate: 'SUM',
    alias: '总费用',
    description: 'SUM(fee_amount)',
  },
];

/**
 * 所有字段（维度 + 度量）
 */
export const ALL_FIELDS: FieldDefinition[] = [...DIMENSION_FIELDS, ...MEASURE_FIELDS];

/**
 * 根据字段名获取字段定义
 */
export function getFieldDefinition(fieldName: string): FieldDefinition | undefined {
  return ALL_FIELDS.find((f) => f.field === fieldName);
}

/**
 * 根据分组获取维度字段
 */
export function getDimensionsByGroup(): Map<string, FieldDefinition[]> {
  const grouped = new Map<string, FieldDefinition[]>();
  for (const field of DIMENSION_FIELDS) {
    const group = field.group || '其他';
    if (!grouped.has(group)) {
      grouped.set(group, []);
    }
    grouped.get(group)!.push(field);
  }
  return grouped;
}

/**
 * 字段分组顺序
 */
export const GROUP_ORDER = ['组织', '业务', '时间', '标志', '车辆', '渠道', '其他'];

/**
 * 筛选操作符配置
 */
export const FILTER_OPERATORS = {
  string: [
    { value: '=', label: '等于' },
    { value: '!=', label: '不等于' },
    { value: 'IN', label: '包含于' },
    { value: 'NOT IN', label: '不包含于' },
    { value: 'LIKE', label: '模糊匹配' },
    { value: 'IS NULL', label: '为空' },
    { value: 'IS NOT NULL', label: '不为空' },
  ],
  number: [
    { value: '=', label: '等于' },
    { value: '!=', label: '不等于' },
    { value: '>', label: '大于' },
    { value: '>=', label: '大于等于' },
    { value: '<', label: '小于' },
    { value: '<=', label: '小于等于' },
    { value: 'BETWEEN', label: '介于' },
    { value: 'IS NULL', label: '为空' },
    { value: 'IS NOT NULL', label: '不为空' },
  ],
  date: [
    { value: '=', label: '等于' },
    { value: '>=', label: '大于等于' },
    { value: '<=', label: '小于等于' },
    { value: 'BETWEEN', label: '介于' },
    { value: 'IS NULL', label: '为空' },
    { value: 'IS NOT NULL', label: '不为空' },
  ],
  boolean: [
    { value: '=', label: '等于' },
    { value: 'IS NULL', label: '为空' },
    { value: 'IS NOT NULL', label: '不为空' },
  ],
} as const;
