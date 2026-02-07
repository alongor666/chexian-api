import type { QueryTemplate } from '../../../shared/types/sql-query';

export const TREND_TEMPLATES: QueryTemplate[] = [
  {
    id: 'trend-daily',
    name: '每日保费趋势',
    description: '按日期统计保费走势',
    category: '趋势',
    sql: `SELECT
  CAST(policy_date AS DATE) as date,
  COUNT(*) as policy_count,
  SUM(premium) as daily_premium
FROM PolicyFact
GROUP BY CAST(policy_date AS DATE)
ORDER BY date DESC
LIMIT 90`,
  },
  {
    id: 'trend-monthly',
    name: '月度保费汇总',
    description: '按年月统计保费',
    category: '趋势',
    sql: `SELECT
  DATE_TRUNC('month', policy_date) as month,
  COUNT(*) as policy_count,
  SUM(premium) as monthly_premium,
  AVG(premium) as avg_premium
FROM PolicyFact
GROUP BY DATE_TRUNC('month', policy_date)
ORDER BY month DESC
LIMIT 12`,
  },
];

