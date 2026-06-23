/**
 * 客户来源去向纯逻辑（从 CustomerFlowPage 提取）
 *
 * - ensureArray：防御性数组归一（应对 DuckDB LIST 序列化的非数组形态）
 * - buildFlowParams：年份筛选 → API 查询参数（空 → undefined）
 *
 * 行为与原组件内联实现逐字符一致。
 */

/**
 * 防御性归一：后端 DuckDB 字段（尤其 array_agg LIST 类型，如 metadata.years）
 * 经序列化后可能不是纯 JS 数组（null / {items:[...]} / 数字键对象），
 * 直接 `?? []` 只能挡住 null/undefined，对象会让 `.map` 抛
 * `((intermediate value) ?? []).map is not a function`。统一在消费侧归一为数组。
 */
export function ensureArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // DuckDB LIST 可能序列化为 { items: [...] }
    if (Array.isArray(obj.items)) return obj.items as T[];
    return Object.values(obj) as T[];
  }
  return [];
}

/** 年份筛选 → API 查询参数：空字符串返回 undefined（不带筛选） */
export function buildFlowParams(year: string): Record<string, string> | undefined {
  return year ? { year } : undefined;
}
