import type { QueryTemplate } from '../../../shared/types/sql-query';

export const KPI_TEMPLATES: QueryTemplate[] = [
  {
    id: 'kpi-overview',
    name: '核心 KPI 总览',
    description: '汇总保费、保单数、业务员数等核心指标',
    category: 'KPI',
    sql: `SELECT
  COUNT(*) as policy_count,
  SUM(premium) as total_premium,
  AVG(premium) as avg_premium,
  COUNT(DISTINCT salesman_name) as salesman_count,
  COUNT(DISTINCT org_level_3) as org_count
FROM PolicyFact`,
  },
  {
    id: 'kpi-top-salesmen',
    name: '业务员绩效 Top 10',
    description: '按保费排序的业务员排名',
    category: 'KPI',
    sql: `SELECT
  salesman_name,
  COUNT(*) as policy_count,
  SUM(premium) as total_premium,
  AVG(premium) as avg_premium,
  ROUND(SUM(premium) * 100.0 / (SELECT SUM(premium) FROM PolicyFact), 2) as premium_share_pct
FROM PolicyFact
GROUP BY salesman_name
ORDER BY total_premium DESC
LIMIT 10`,
  },
];

