/**
 * 视角SQL生成器适配层
 *
 * 提供SQL生成辅助函数，支持根据视角生成对应的：
 * - SELECT聚合表达式
 * - WHERE筛选条件
 * - GROUP BY子句适配
 *
 * 用于现有SQL生成器（trend.ts, truck.ts, growth.ts等）的视角切换集成。
 *
 * @module perspective-adapter
 */

import type { ViewPerspective } from '../types/index.js';
import {
  generateAggregation,
  generateWhereClause,
  getPerspectiveConfig,
} from '../types/index.js';

/**
 * 生成视角SELECT子句
 *
 * @param perspective 视角类型
 * @param alias 别名（默认 'value'）
 * @param options 可选配置
 * @returns SELECT子句字符串
 *
 * @example
 * // 保费视角
 * generatePerspectiveSelect('premium', 'total_premium')
 * // 返回: "SUM(premium) AS total_premium"
 *
 * // 保单件数视角
 * generatePerspectiveSelect('policy_count', 'policy_count')
 * // 返回: "COUNT(*) AS policy_count"
 */
export function generatePerspectiveSelect(
  perspective: ViewPerspective,
  alias: string = 'value',
  options?: {
    /** 是否添加ROUND函数（保费视角自动四舍五入到万元） */
    round?: boolean;
  }
): string {
  const aggregation = generateAggregation(perspective, alias);

  // 保费视角默认四舍五入到万元
  if (perspective === 'premium' && (options?.round !== false)) {
    return aggregation.replace(/SUM\(premium\)/, 'ROUND(SUM(premium), 2)');
  }

  return aggregation;
}

/**
 * 生成视角WHERE子句数组
 *
 * @param perspective 视角类型
 * @param existingConditions 现有WHERE条件数组
 * @returns 合并后的WHERE条件数组
 *
 * @example
 * // 保费视角（不添加额外条件）
 * generatePerspectiveWhere('premium', ['org_name = "北京"'])
 * // 返回: ["org_name = \"北京\""]
 *
 * // 保单件数视角（不添加额外条件）
 * generatePerspectiveWhere('policy_count', ['org_name = "北京"'])
 * // 返回: ["org_name = \"北京\""]
 */
export function generatePerspectiveWhere(
  perspective: ViewPerspective,
  existingConditions: string[] = []
): string[] {
  const perspectiveConditions = generateWhereClause(perspective);
  return [...existingConditions, ...perspectiveConditions];
}

/**
 * 构建完整WHERE子句字符串
 *
 * @param perspective 视角类型
 * @param existingConditions 现有WHERE条件数组
 * @returns WHERE子句字符串（包含 "WHERE " 前缀），如果没有条件则返回空字符串
 *
 * @example
 * buildWhereClause('policy_count', ['org_name = "北京"'])
 * // 返回: "WHERE org_name = \"北京\""
 */
export function buildWhereClause(
  perspective: ViewPerspective,
  existingConditions: string[] = []
): string {
  const allConditions = generatePerspectiveWhere(perspective, existingConditions);
  if (allConditions.length === 0) {
    return '';
  }
  return `WHERE ${allConditions.join(' AND ')}`;
}

/**
 * 生成视角值格式化函数名
 *
 * @param perspective 视角类型
 * @returns 格式化函数名（'formatPremium' 或 'formatNumber'）
 *
 * @example
 * getFormatterName('premium')
 * // 返回: "formatPremium"
 *
 * getFormatterName('policy_count')
 * // 返回: "formatNumber"
 */
export function getFormatterName(perspective: ViewPerspective): 'formatPremium' | 'formatNumber' {
  const config = getPerspectiveConfig(perspective);
  return config.valueFormatter === 'premium' ? 'formatPremium' : 'formatNumber';
}

/**
 * 生成ECharts Y轴配置
 *
 * @param perspective 视角类型
 * @param options 可选配置
 * @returns ECharts Y轴配置对象
 *
 * @example
 * generateYAxisConfig('premium')
 * // 返回: { name: "保费（万元）", ... }
 *
 * generateYAxisConfig('policy_count')
 * // 返回: { name: "件数", ... }
 */
export function generateYAxisConfig(
  perspective: ViewPerspective,
  options?: {
    /** 是否显示轴名称 */
    showName?: boolean;
    /** 自定义轴名称位置 */
    nameLocation?: 'start' | 'middle' | 'end';
  }
) {
  const config = getPerspectiveConfig(perspective);

  return {
    name: options?.showName !== false ? config.yAxisLabel : '',
    nameLocation: options?.nameLocation || 'end',
    type: 'value' as const,
    axisLabel: {
      formatter: perspective === 'premium' ? '{value}' : '{value}',
    },
  };
}

/**
 * 生成ECharts tooltip格式化函数
 *
 * @param perspective 视角类型
 * @returns tooltip formatter函数
 *
 * @example
 * const formatter = generateTooltipFormatter('premium');
 * formatter({ value: 10000 })
 * // 返回: "10,000万元"
 */
export function generateTooltipFormatter(perspective: ViewPerspective) {
  const config = getPerspectiveConfig(perspective);

  return (params: any) => {
    const value = params.value || 0;
    if (config.valueFormatter === 'premium') {
      // 保费格式化：万元，千分位
      return `${value.toLocaleString('zh-CN')}万元`;
    } else {
      // 件数格式化：整数，千分位
      return `${Math.round(value).toLocaleString('zh-CN')}件`;
    }
  };
}

/**
 * 视角SQL适配器工具对象（导出所有辅助函数）
 */
export const PerspectiveAdapter = {
  generateSelect: generatePerspectiveSelect,
  generateWhere: generatePerspectiveWhere,
  buildWhereClause,
  getFormatterName,
  generateYAxisConfig,
  generateTooltipFormatter,
};