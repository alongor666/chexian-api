import type { QueryTemplate } from '../../../shared/types/sql-query';

export const GROWTH_TEMPLATES: QueryTemplate[] = [
  {
    id: 'growth-yoy-policy-date',
    name: '同比增长率（签单口径）',
    description: '按签单日期计算保费同比增长率',
    category: '增长分析',
    parameters: [
      {
        name: 'year',
        label: '目标年份',
        type: 'number',
        required: true,
        defaultValue: 2026,
        validation: { min: 2020, max: 2030 },
        helpText: '选择统计年份',
      },
      {
        name: 'cutoff_date',
        label: '截止日期',
        type: 'date',
        required: true,
        defaultValue: (() => new Date().toISOString().split('T')[0])(),
        helpText: '统计截止日期（默认今天）',
      },
    ],
    sql: (params) => {
      const year = params.year || 2026;
      const cutoffDate = params.cutoff_date || 'CURRENT_DATE';

      return `
WITH current_year AS (
  SELECT
    org_level_3,
    SUM(premium) AS current_premium
  FROM PolicyFact
  WHERE YEAR(CAST(policy_date AS DATE)) = ${year}
    AND CAST(policy_date AS DATE) <= DATE '${cutoffDate}'
  GROUP BY org_level_3
),
previous_year AS (
  SELECT
    org_level_3,
    SUM(premium) AS previous_premium
  FROM PolicyFact
  WHERE YEAR(CAST(policy_date AS DATE)) = ${year - 1}
    AND DAYOFYEAR(CAST(policy_date AS DATE)) <= DAYOFYEAR(DATE '${cutoffDate}')
  GROUP BY org_level_3
)
SELECT
  COALESCE(c.org_level_3, p.org_level_3) AS org_level_3,
  COALESCE(c.current_premium, 0) AS current_premium,
  COALESCE(p.previous_premium, 0) AS previous_premium,
  CASE
    WHEN COALESCE(p.previous_premium, 0) = 0 THEN NULL
    ELSE ROUND((COALESCE(c.current_premium, 0) - COALESCE(p.previous_premium, 0)) * 100.0 / p.previous_premium, 2)
  END AS growth_rate_pct
FROM current_year c
FULL OUTER JOIN previous_year p ON c.org_level_3 = p.org_level_3
ORDER BY growth_rate_pct DESC NULLS LAST
      `.trim();
    },
  },
  {
    id: 'growth-yoy-insurance-start',
    name: '同比增长率（起保口径）',
    description: '按起保日期计算保费同比增长率',
    category: '增长分析',
    parameters: [
      {
        name: 'year',
        label: '目标年份',
        type: 'number',
        required: true,
        defaultValue: 2026,
        validation: { min: 2020, max: 2030 },
      },
      {
        name: 'cutoff_date',
        label: '截止日期',
        type: 'date',
        required: true,
        defaultValue: (() => new Date().toISOString().split('T')[0])(),
      },
    ],
    sql: (params) => {
      const year = params.year || 2026;
      const cutoffDate = params.cutoff_date || 'CURRENT_DATE';

      return `
WITH current_year AS (
  SELECT
    org_level_3,
    SUM(premium) AS current_premium
  FROM PolicyFact
  WHERE YEAR(CAST(insurance_start_date AS DATE)) = ${year}
    AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
  GROUP BY org_level_3
),
previous_year AS (
  SELECT
    org_level_3,
    SUM(premium) AS previous_premium
  FROM PolicyFact
  WHERE YEAR(CAST(insurance_start_date AS DATE)) = ${year - 1}
    AND DAYOFYEAR(CAST(insurance_start_date AS DATE)) <= DAYOFYEAR(DATE '${cutoffDate}')
  GROUP BY org_level_3
)
SELECT
  COALESCE(c.org_level_3, p.org_level_3) AS org_level_3,
  COALESCE(c.current_premium, 0) AS current_premium,
  COALESCE(p.previous_premium, 0) AS previous_premium,
  CASE
    WHEN COALESCE(p.previous_premium, 0) = 0 THEN NULL
    ELSE ROUND((COALESCE(c.current_premium, 0) - COALESCE(p.previous_premium, 0)) * 100.0 / p.previous_premium, 2)
  END AS growth_rate_pct
FROM current_year c
FULL OUTER JOIN previous_year p ON c.org_level_3 = p.org_level_3
ORDER BY growth_rate_pct DESC NULLS LAST
      `.trim();
    },
  },
];

