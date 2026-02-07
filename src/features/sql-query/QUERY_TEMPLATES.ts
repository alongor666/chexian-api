import type { QueryTemplate } from '../../shared/types/sql-query';
import { KPI_TEMPLATES } from './queryTemplates/kpi';
import { ANALYSIS_TEMPLATES } from './queryTemplates/analysis';
import { TREND_TEMPLATES } from './queryTemplates/trend';
import { EXAMPLE_TEMPLATES } from './queryTemplates/examples';
import { GROWTH_TEMPLATES } from './queryTemplates/growth';
import { ACHIEVEMENT_TEMPLATES } from './queryTemplates/achievement';
import { RENEWAL_TEMPLATES } from './queryTemplates/renewal';

export const QUERY_TEMPLATES: QueryTemplate[] = [
  ...KPI_TEMPLATES,
  ...ANALYSIS_TEMPLATES,
  ...TREND_TEMPLATES,
  ...EXAMPLE_TEMPLATES,
  ...GROWTH_TEMPLATES,
  ...ACHIEVEMENT_TEMPLATES,
  ...RENEWAL_TEMPLATES,
];

/**
 * 根据分类过滤模板
 */
export function getTemplatesByCategory(category: string): QueryTemplate[] {
  return QUERY_TEMPLATES.filter((t) => t.category === category);
}

/**
 * 根据 ID 获取模板
 */
export function getTemplateById(id: string): QueryTemplate | undefined {
  return QUERY_TEMPLATES.find((t) => t.id === id);
}
