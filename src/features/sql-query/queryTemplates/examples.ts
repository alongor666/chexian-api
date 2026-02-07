import type { QueryTemplate } from '../../../shared/types/sql-query';

export const EXAMPLE_TEMPLATES: QueryTemplate[] = [
  {
    id: 'example-filter',
    name: '自定义过滤示例',
    description: '演示如何添加 WHERE 条件',
    category: '示例',
    sql: `SELECT
  org_level_3,
  COUNT(*) as policy_count,
  SUM(premium) as total_premium
FROM PolicyFact
WHERE policy_date >= CURRENT_DATE - INTERVAL 30 DAY
GROUP BY org_level_3
ORDER BY total_premium DESC
LIMIT 10`,
  },
  {
    id: 'param-top-salesmen',
    name: '业务员绩效 Top N（参数化）',
    description: '支持自定义排名数量和日期范围',
    category: '示例',
    parameters: [
      {
        name: 'top_n',
        label: '显示数量',
        type: 'number',
        required: true,
        defaultValue: 10,
        validation: { min: 1, max: 100, message: '显示数量必须在 1-100 之间' },
        helpText: '显示前 N 名业务员',
      },
      {
        name: 'date_from',
        label: '开始日期',
        type: 'date',
        required: false,
        defaultValue: '2026-01-01',
        helpText: '统计开始日期（可选，默认2026-01-01）',
      },
      {
        name: 'date_to',
        label: '结束日期',
        type: 'date',
        required: false,
        defaultValue: (() => {
          const today = new Date();
          return today.toISOString().split('T')[0];
        })(),
        helpText: '统计结束日期（可选，默认今天）',
      },
    ],
    sql: `SELECT
  salesman_name,
  COUNT(*) as policy_count,
  SUM(premium) as total_premium,
  AVG(premium) as avg_premium,
  ROUND(SUM(premium) * 100.0 / (
    SELECT SUM(premium)
    FROM PolicyFact
    {{#if date_from}}WHERE policy_date >= {{date_from}}{{/if}}
    {{#if date_to}}{{#if date_from}}AND{{/if}}{{#unless date_from}}WHERE{{/unless}} policy_date <= {{date_to}}{{/if}}
  ), 2) as premium_share_pct
FROM PolicyFact
{{#if date_from}}WHERE policy_date >= {{date_from}}{{/if}}
{{#if date_to}}{{#if date_from}}AND{{/if}}{{#unless date_from}}WHERE{{/unless}} policy_date <= {{date_to}}{{/if}}
GROUP BY salesman_name
ORDER BY total_premium DESC
LIMIT {{top_n}}`,
  },
  {
    id: 'param-org-analysis',
    name: '机构保费分析（参数化）',
    description: '按日期范围统计各机构保费',
    category: '示例',
    parameters: [
      {
        name: 'year',
        label: '年份',
        type: 'number',
        required: true,
        defaultValue: 2026,
        validation: { min: 2020, max: 2030 },
        helpText: '选择统计年份',
      },
      {
        name: 'min_premium',
        label: '最低保费阈值',
        type: 'number',
        required: false,
        defaultValue: 100000,
        validation: { min: 0 },
        helpText: '只显示保费超过此值的机构（元）',
      },
    ],
    sql: (params) => {
      const year = params.year || 2026;
      const minPremium = params.min_premium || 0;

      return `
SELECT
  org_level_3,
  COUNT(*) as policy_count,
  SUM(premium) as total_premium,
  AVG(premium) as avg_premium,
  ROUND(SUM(premium) * 100.0 / (
    SELECT SUM(premium)
    FROM PolicyFact
    WHERE YEAR(CAST(policy_date AS DATE)) = ${year}
  ), 2) as share_pct
FROM PolicyFact
WHERE YEAR(CAST(policy_date AS DATE)) = ${year}
GROUP BY org_level_3
HAVING SUM(premium) >= ${minPremium}
ORDER BY total_premium DESC
      `.trim();
    },
  },
  {
    id: 'param-customer-filter',
    name: '客户类别筛选（参数化）',
    description: '按客户类别和险种筛选保单',
    category: '示例',
    parameters: [
      {
        name: 'customer_category',
        label: '客户类别',
        type: 'select',
        required: false,
        options: [
          { label: '不限', value: '' },
          { label: '企业', value: '企业' },
          { label: '个人', value: '个人' },
        ],
        helpText: '选择客户类别进行筛选',
      },
      {
        name: 'is_nev',
        label: '是否新能源',
        type: 'select',
        required: false,
        options: [
          { label: '不限', value: '' },
          { label: '是', value: '1' },
          { label: '否', value: '0' },
        ],
        helpText: '筛选新能源或燃油车',
      },
    ],
    sql: `SELECT
  CAST(policy_date AS DATE) as date,
  customer_category,
  CASE WHEN is_nev = 1 THEN '新能源' ELSE '燃油' END as vehicle_type,
  COUNT(*) as policy_count,
  SUM(premium) as total_premium
FROM PolicyFact
WHERE 1=1
  {{#if customer_category}}AND customer_category = {{customer_category}}{{/if}}
  {{#if is_nev}}AND is_nev = {{is_nev}}{{/if}}
GROUP BY CAST(policy_date AS DATE), customer_category, is_nev
ORDER BY date DESC
LIMIT 100`,
  },
];

