/**
 * 视角切换类型系统
 *
 * 用于支持分析图表在不同维度下的数据展示：
 * - 保费视角：按保费金额聚合（SUM(premium)）
 * - 保单件数视角：按保单数量聚合（COUNT(*)）
 *
 * @module view-perspective
 */

/**
 * 视角类型枚举
 */
export type ViewPerspective =
  | 'premium'       // 保费视角（默认）
  | 'policy_count'; // 保单件数视角

/**
 * 视角配置接口
 */
export interface PerspectiveConfig {
  /** 视角类型 */
  type: ViewPerspective;

  /** 显示标签（用于UI切换器） */
  label: string;

  /** 简短标签（用于紧凑布局） */
  shortLabel: string;

  /** SQL聚合表达式模板 */
  aggregation: string;

  /** Y轴标签 */
  yAxisLabel: string;

  /** 值格式化函数类型 */
  valueFormatter: 'premium' | 'count';

  /** 是否需要险类筛选 */
  requiresInsuranceTypeFilter: boolean;

  /** 险类筛选条件（如果需要） */
  insuranceTypeFilter?: '商业险' | '交强险';

  /** 描述文本（用于提示） */
  description: string;
}

/**
 * 保费视角配置
 */
export const PREMIUM_PERSPECTIVE: PerspectiveConfig = {
  type: 'premium',
  label: '保费',
  shortLabel: '保费',
  aggregation: 'SUM(premium)',
  yAxisLabel: '保费（万元）',
  valueFormatter: 'premium',
  requiresInsuranceTypeFilter: false,
  description: '按保费金额聚合分析',
};

/**
 * 保单件数视角配置
 */
export const POLICY_COUNT_PERSPECTIVE: PerspectiveConfig = {
  type: 'policy_count',
  label: '保单件数',
  shortLabel: '件数',
  aggregation: 'COUNT(*)',
  yAxisLabel: '件数',
  valueFormatter: 'count',
  requiresInsuranceTypeFilter: false,
  description: '按保单数量聚合分析',
};

/**
 * 所有视角配置映射
 */
export const PERSPECTIVE_CONFIGS: Record<ViewPerspective, PerspectiveConfig> = {
  premium: PREMIUM_PERSPECTIVE,
  policy_count: POLICY_COUNT_PERSPECTIVE,
};

/**
 * 默认视角
 */
export const DEFAULT_PERSPECTIVE: ViewPerspective = 'premium';

/**
 * 视角列表（用于UI渲染）
 */
export const PERSPECTIVE_OPTIONS: ViewPerspective[] = [
  'premium',
  'policy_count',
];

/**
 * 获取视角配置
 * @param perspective 视角类型
 * @returns 视角配置对象
 */
export function getPerspectiveConfig(perspective: ViewPerspective): PerspectiveConfig {
  return PERSPECTIVE_CONFIGS[perspective];
}

/**
 * 检查视角是否需要险类筛选
 * @param perspective 视角类型
 * @returns 是否需要险类筛选
 */
export function requiresInsuranceTypeFilter(perspective: ViewPerspective): boolean {
  return getPerspectiveConfig(perspective).requiresInsuranceTypeFilter;
}

/**
 * 获取视角的险类筛选条件
 * @param perspective 视角类型
 * @returns 险类筛选条件，如果不需要则返回 undefined
 */
export function getInsuranceTypeFilter(perspective: ViewPerspective): string | undefined {
  const config = getPerspectiveConfig(perspective);
  return config.insuranceTypeFilter;
}

/**
 * 生成视角SQL聚合表达式
 * @param perspective 视角类型
 * @param alias 别名（可选）
 * @returns SQL聚合表达式
 *
 * @example
 * generateAggregation('premium', 'total_value')
 * // 返回: "SUM(premium) AS total_value"
 *
 * generateAggregation('policy_count', 'count_value')
 * // 返回: "COUNT(*) AS count_value"
 */
export function generateAggregation(
  perspective: ViewPerspective,
  alias: string = 'value'
): string {
  const config = getPerspectiveConfig(perspective);
  return `${config.aggregation} AS ${alias}`;
}

/**
 * 生成视角WHERE子句（如果需要险类筛选）
 * @param perspective 视角类型
 * @returns WHERE子句数组，如果不需要筛选则返回空数组
 *
 * @example
 * generateWhereClause('policy_count')
 * // 返回: []
 *
 * generateWhereClause('premium')
 * // 返回: []
 */
export function generateWhereClause(perspective: ViewPerspective): string[] {
  const config = getPerspectiveConfig(perspective);
  if (!config.requiresInsuranceTypeFilter || !config.insuranceTypeFilter) {
    return [];
  }
  return [`险类 = '${config.insuranceTypeFilter}'`];
}