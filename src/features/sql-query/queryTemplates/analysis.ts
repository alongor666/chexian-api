import type { QueryTemplate } from '../../../shared/types/sql-query';

export const ANALYSIS_TEMPLATES: QueryTemplate[] = [
  {
    id: 'analysis-customer-category',
    name: '客户类别保费占比',
    description: '按客户类别统计保费分布',
    category: '分析',
    sql: `SELECT
  customer_category,
  COUNT(*) as policy_count,
  SUM(premium) as total_premium,
  ROUND(SUM(premium) * 100.0 / (SELECT SUM(premium) FROM PolicyFact), 2) as share_pct
FROM PolicyFact
GROUP BY customer_category
ORDER BY total_premium DESC`,
  },
  {
    id: 'analysis-coverage-combination',
    name: '险别组合分析',
    description: '统计不同险别组合的保费情况',
    category: '分析',
    sql: `SELECT
  coverage_combination,
  COUNT(*) as policy_count,
  SUM(premium) as total_premium,
  AVG(premium) as avg_premium
FROM PolicyFact
GROUP BY coverage_combination
ORDER BY total_premium DESC
LIMIT 20`,
  },
  {
    id: 'analysis-telemarketing',
    name: '终端来源对比',
    description: '对比电销与非电销业务',
    category: '分析',
    sql: `SELECT
  CASE
    WHEN is_telemarketing = 1 THEN '电销'
    ELSE '非电销'
  END as source,
  COUNT(*) as policy_count,
  SUM(premium) as total_premium,
  AVG(premium) as avg_premium,
  ROUND(SUM(premium) * 100.0 / (SELECT SUM(premium) FROM PolicyFact), 2) as share_pct
FROM PolicyFact
GROUP BY is_telemarketing
ORDER BY total_premium DESC`,
  },
];

