/**
 * 报表模板纯逻辑（从 ReportTemplatesPanel 提取）
 *
 * - deriveCategories：模板集 → 分类标签（「全部」+ 去重分类）
 * - filterTemplatesByCategory：按分类筛选（「全部」返回全集）
 *
 * 泛型化（仅约束 { category: string }），行为与原组件内联实现一致。
 */

/** 模板集 → 分类列表：固定首项「全部」+ 按出现顺序去重的分类 */
export function deriveCategories<T extends { category: string }>(items: T[]): string[] {
  return ['全部', ...Array.from(new Set(items.map((t) => t.category)))];
}

/** 按分类筛选模板；「全部」返回全集（同一引用），其余按 category 精确匹配 */
export function filterTemplatesByCategory<T extends { category: string }>(
  items: T[],
  category: string
): T[] {
  return category === '全部' ? items : items.filter((t) => t.category === category);
}
