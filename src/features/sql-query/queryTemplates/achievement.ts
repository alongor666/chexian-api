import type { QueryTemplate } from '../../../shared/types/sql-query';

export const ACHIEVEMENT_TEMPLATES: QueryTemplate[] = [
  {
    id: 'achievement-by-org',
    name: '分机构目标达成率',
    description: '统计各机构2026年目标完成情况',
    category: '达成分析',
    parameters: [
      {
        name: 'cutoff_date',
        label: '统计截止日期',
        type: 'date',
        required: true,
        defaultValue: (() => new Date().toISOString().split('T')[0])(),
        helpText: '截至该日期的累计保费',
      },
    ],
    sql: (params) => {
      const cutoffDate = params.cutoff_date || 'CURRENT_DATE';

      const { createTargetsTableSQL } = require('../../../shared/data/targets-2026');
      const createTableSQL = createTargetsTableSQL();

      return `
${createTableSQL};

WITH actual_premium AS (
  SELECT
    org_level_3,
    SUM(premium) AS actual_premium
  FROM PolicyFact
  WHERE YEAR(CAST(policy_date AS DATE)) = 2026
    AND CAST(policy_date AS DATE) <= DATE '${cutoffDate}'
  GROUP BY org_level_3
)
SELECT
  t.name AS org_level_3,
  t.target_premium,
  COALESCE(a.actual_premium, 0) AS actual_premium,
  ROUND(COALESCE(a.actual_premium, 0) * 100.0 / t.target_premium, 2) AS achievement_rate_pct,
  t.target_premium - COALESCE(a.actual_premium, 0) AS gap_premium
FROM Targets2026 t
LEFT JOIN actual_premium a ON t.name = a.org_level_3
WHERE t.dimension = 'org'
ORDER BY achievement_rate_pct DESC NULLS LAST
      `.trim();
    },
  },
  {
    id: 'achievement-by-salesman',
    name: '分业务员目标达成率',
    description: '统计业务员2026年目标完成情况',
    category: '达成分析',
    parameters: [
      {
        name: 'cutoff_date',
        label: '统计截止日期',
        type: 'date',
        required: true,
        defaultValue: (() => new Date().toISOString().split('T')[0])(),
      },
      {
        name: 'min_achievement',
        label: '最低达成率（%）',
        type: 'number',
        required: false,
        defaultValue: 0,
        validation: { min: 0, max: 100 },
        helpText: '只显示达成率超过此值的业务员',
      },
    ],
    sql: (params) => {
      const cutoffDate = params.cutoff_date || 'CURRENT_DATE';
      const minAchievement = params.min_achievement || 0;

      const { createTargetsTableSQL } = require('../../../shared/data/targets-2026');
      const createTableSQL = createTargetsTableSQL();

      return `
${createTableSQL};

WITH actual_premium AS (
  SELECT
    salesman_name,
    SUM(premium) AS actual_premium
  FROM PolicyFact
  WHERE YEAR(CAST(policy_date AS DATE)) = 2026
    AND CAST(policy_date AS DATE) <= DATE '${cutoffDate}'
  GROUP BY salesman_name
)
SELECT
  t.name AS salesman_name,
  t.target_premium,
  COALESCE(a.actual_premium, 0) AS actual_premium,
  ROUND(COALESCE(a.actual_premium, 0) * 100.0 / t.target_premium, 2) AS achievement_rate_pct,
  t.target_premium - COALESCE(a.actual_premium, 0) AS gap_premium
FROM Targets2026 t
LEFT JOIN actual_premium a ON t.name = a.salesman_name
WHERE t.dimension = 'salesman'
  AND COALESCE(a.actual_premium, 0) * 100.0 / t.target_premium >= ${minAchievement}
ORDER BY achievement_rate_pct DESC NULLS LAST
      `.trim();
    },
  },
];

