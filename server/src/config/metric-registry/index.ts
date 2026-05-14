/**
 * 指标注册表主入口
 *
 * 集中管理所有 L1-L3 原子指标的定义、SQL 片段、展示配置。
 * L4 复杂查询（CTE/窗口函数/多表 JOIN）不在此注册，留在 SQL 生成器中。
 */

import type { MetricDefinition, MetricCategory } from './types.js';
import { foundationMetrics } from './categories/foundation.js';
import { ratioMetrics } from './categories/ratio.js';
import { costMetrics } from './categories/cost.js';
import { crossSellMetrics } from './categories/cross-sell.js';
import { growthMetrics } from './categories/growth.js';
import { repairMetrics } from './categories/repair.js';
import { planMetrics } from './categories/plan.js';
import { structureMetrics } from './categories/structure.js';

// ==================== 注册表构建 ====================

const ALL_METRICS: readonly MetricDefinition[] = [
  ...foundationMetrics,
  ...ratioMetrics,
  ...costMetrics,
  ...crossSellMetrics,
  ...growthMetrics,
  ...repairMetrics,
  ...planMetrics,
  ...structureMetrics,
];

const METRIC_MAP = new Map<string, MetricDefinition>(
  ALL_METRICS.map((m) => [m.id, m])
);

// 启动时校验：检查重复 ID
if (METRIC_MAP.size !== ALL_METRICS.length) {
  const ids = ALL_METRICS.map((m) => m.id);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  throw new Error(`[MetricRegistry] Duplicate metric IDs: ${dupes.join(', ')}`);
}

// ==================== 查询 API ====================

/** 获取指标，不存在返回 undefined */
export function getMetric(id: string): MetricDefinition | undefined {
  return METRIC_MAP.get(id);
}

/** 获取指标，不存在抛异常 */
export function getMetricOrThrow(id: string): MetricDefinition {
  const m = METRIC_MAP.get(id);
  if (!m) throw new Error(`[MetricRegistry] Metric not found: ${id}`);
  return m;
}

/** 获取指标的 SQL 表达式 */
export function getMetricSql(id: string): string {
  return getMetricOrThrow(id).sql.expression;
}

/** 获取所有指标 */
export function getAllMetrics(): readonly MetricDefinition[] {
  return ALL_METRICS;
}

/** 按分类获取指标 */
export function getMetricsByCategory(category: MetricCategory): readonly MetricDefinition[] {
  return ALL_METRICS.filter((m) => m.category === category);
}

/** 按标签获取指标 */
export function getMetricsByTag(tag: string): readonly MetricDefinition[] {
  return ALL_METRICS.filter((m) => m.tags.includes(tag));
}

/** 搜索指标（名称、ID、标签） */
export function searchMetrics(keyword: string): readonly MetricDefinition[] {
  const kw = keyword.toLowerCase();
  return ALL_METRICS.filter(
    (m) =>
      m.name.includes(kw) ||
      m.id.includes(kw) ||
      m.tags.some((t) => t.includes(kw))
  );
}

/** 检查指标是否存在 */
export function hasMetric(id: string): boolean {
  return METRIC_MAP.has(id);
}

/** 注册表统计信息 */
export function getRegistryStats(): {
  total: number;
  byCategory: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  for (const m of ALL_METRICS) {
    byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
  }
  return { total: ALL_METRICS.length, byCategory };
}

// ==================== 导出 ====================

export { ALL_METRICS, METRIC_MAP };
export type { MetricDefinition, MetricCategory } from './types.js';
