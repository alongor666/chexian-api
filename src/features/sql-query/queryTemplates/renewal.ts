import type { QueryTemplate } from '../../../shared/types/sql-query';

export const RENEWAL_TEMPLATES: QueryTemplate[] = [
  {
    id: 'renewal-rate-by-org',
    name: '分机构续保率统计',
    description: '按机构统计续保率（基于PolicyFactRenewal）',
    category: '续保分析',
    parameters: [
      {
        name: 'target_year',
        label: '目标年份',
        type: 'number',
        required: true,
        defaultValue: 2026,
        validation: { min: 2020, max: 2030 },
        helpText: '统计该年份到期保单的续保情况',
      },
    ],
    sql: (params) => {
      const targetYear = params.target_year || 2026;

      return `
SELECT
  org_level_3,
  COUNT(*) AS total_count,
  COUNT(CASE WHEN is_renewal THEN 1 END) AS renewal_count,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE ROUND(COUNT(CASE WHEN is_renewal THEN 1 END) * 100.0 / COUNT(*), 2)
  END AS renewal_rate_pct,
  SUM(premium) AS total_premium,
  SUM(CASE WHEN is_renewal THEN premium ELSE 0 END) AS renewal_premium
FROM PolicyFactRenewal
WHERE YEAR(CAST(policy_date AS DATE)) = ${targetYear}
GROUP BY org_level_3
ORDER BY renewal_rate_pct DESC
      `.trim();
    },
  },
  {
    id: 'renewal-rate-monthly-trend',
    name: '月度续保率趋势',
    description: '按月统计续保率变化趋势',
    category: '续保分析',
    parameters: [
      {
        name: 'year',
        label: '年份',
        type: 'number',
        required: true,
        defaultValue: 2026,
        validation: { min: 2020, max: 2030 },
      },
    ],
    sql: (params) => {
      const year = params.year || 2026;

      return `
SELECT
  DATE_TRUNC('month', policy_date) AS month,
  COUNT(*) AS total_count,
  COUNT(CASE WHEN is_renewal THEN 1 END) AS renewal_count,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE ROUND(COUNT(CASE WHEN is_renewal THEN 1 END) * 100.0 / COUNT(*), 2)
  END AS renewal_rate_pct
FROM PolicyFactRenewal
WHERE YEAR(CAST(policy_date AS DATE)) = ${year}
GROUP BY DATE_TRUNC('month', policy_date)
ORDER BY month
      `.trim();
    },
  },
];

