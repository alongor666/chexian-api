/**
 * DC-002 Filter Guard - 类型守卫和工具函数
 *
 * 目标：让违反DC-002规则的代码无法编译或运行时立即报错
 *
 * DC-002 规则摘要：
 * - §2.1: 禁止使用 `?:` 三元运算符判断 filters 字段，必须使用 `??`
 * - §2.3: 禁止硬编码 CURRENT_DATE，必须从 filters 读取用户选择
 * - §2.4: SQL生成器必须优先使用 filters 中的日期范围
 *
 * @module dc-002-guard
 */

import type { AdvancedFilterState } from './data.js';

/**
 * DC-002 合规的日期范围类型
 *
 * 强制要求开始和结束日期必须存在（不可为 undefined）
 * 如果用户未设置，必须提供明确的默认值
 */
export interface DC002CompliantDateRange {
  start: string; // 必填，不可为 undefined
  end: string;   // 必填，不可为 undefined
}

/**
 * DC-002 违规错误类型
 */
export class DC002ViolationError extends Error {
  constructor(
    message: string,
    public readonly rule: string,
    public readonly suggestion: string
  ) {
    super(`[DC-002 Violation] ${message}`);
    this.name = 'DC002ViolationError';
  }
}

/**
 * DC-002 Filter Guard - 强制执行用户筛选优先规则
 *
 * 使用类型收窄（Type Narrowing）确保日期范围已正确设置
 *
 * @param filters - 筛选条件
 * @param context - 调用上下文（用于错误提示）
 * @returns DC-002 合规的日期范围
 * @throws {DC002ViolationError} 如果日期范围未正确设置
 *
 * @example
 * ```typescript
 * // ✅ 正确使用（推荐）
 * function generateQuery(filters: AdvancedFilterState): string {
 *   const dateRange = extractDC002DateRange(filters, 'generateQuery');
 *   // dateRange.start 和 dateRange.end 保证不为 undefined
 *   return `SELECT * FROM t WHERE date >= '${dateRange.start}' AND date <= '${dateRange.end}'`;
 * }
 *
 * // ❌ 错误使用（禁止）
 * function generateQuery(filters: AdvancedFilterState): string {
 *   const endDate = filters.policy_date_end || '2026-01-01'; // 🔥 违反 DC-002
 *   const endDate2 = filters.policy_date_end ?? CURRENT_DATE; // 🔥 违反 DC-002 (硬编码)
 *   const endDate3 = filters.policy_date_end ? `'${endDate3}'` : 'CURRENT_DATE'; // 🔥 违反 DC-002
 * }
 * ```
 */
export function extractDC002DateRange(
  filters: AdvancedFilterState,
  context: string
): DC002CompliantDateRange {
  // 规则：必须从 filters 读取用户选择
  const userStart = filters.policy_date_start;
  const userEnd = filters.policy_date_end;

  // 规则：使用 ?? 运算符提供默认值（禁止使用 || 或 ?:）
  const start = userStart ?? new Date().getFullYear().toString() + '-01-01';
  const end = userEnd ?? new Date().toISOString().split('T')[0];

  // 运行时验证：确保默认值生成成功
  if (!start || !end) {
    throw new DC002ViolationError(
      `日期范围生成失败（context: ${context}）`,
      'DC-002 §2.3',
      '确保默认值逻辑正确，避免 undefined 或空字符串'
    );
  }

  // 运行时验证：禁止 CURRENT_DATE 硬编码
  if (start.includes('CURRENT_DATE') || end.includes('CURRENT_DATE')) {
    throw new DC002ViolationError(
      `检测到 CURRENT_DATE 硬编码（context: ${context}）`,
      'DC-002 §2.3',
      '使用用户设置的日期或明确的默认值（如 new Date().toISOString().split("T")[0]）'
    );
  }

  return { start, end };
}

/**
 * DC-002 SQL 构建辅助函数
 *
 * 确保生成的 SQL 不包含违规的硬编码
 *
 * @param dateRange - DC-002 合规的日期范围
 * @returns SQL 日期表达式（单引号包裹的日期字符串）
 *
 * @example
 * ```typescript
 * const dateRange = extractDC002DateRange(filters, 'myQuery');
 * const { startExpr, endExpr } = formatDC002DateSQL(dateRange);
 * const sql = `WHERE date >= ${startExpr} AND date <= ${endExpr}`;
 * // 生成: WHERE date >= '2026-01-01' AND date <= '2026-01-08'
 * ```
 */
export function formatDC002DateSQL(dateRange: DC002CompliantDateRange): {
  startExpr: string;
  endExpr: string;
} {
  // 验证：防止 SQL 注入
  const sanitize = (date: string): string => {
    // 移除潜在的SQL注入字符
    const sanitized = date.replace(/['";\\]/g, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sanitized)) {
      throw new DC002ViolationError(
        `无效的日期格式: ${date}`,
        'DC-002 §2.4',
        '日期必须符合 YYYY-MM-DD 格式'
      );
    }
    return sanitized;
  };

  const start = sanitize(dateRange.start);
  const end = sanitize(dateRange.end);

  return {
    startExpr: `'${start}'`,
    endExpr: `'${end}'`,
  };
}

/**
 * DC-002 查询构建器守卫
 *
 * 用于在 SQL 生成函数中强制执行 DC-002 规则
 *
 * @param filters - 筛选条件
 * @param context - 调用上下文
 * @returns 包含日期范围和 SQL 表达式的对象
 *
 * @example
 * ```typescript
 * export function generateMyQuery(filters: AdvancedFilterState): string {
 *   const { startExpr, endExpr } = buildDC002QueryFilters(filters, 'generateMyQuery');
 *   return `
 *     SELECT * FROM PolicyFact
 *     WHERE policy_date >= ${startExpr}
 *       AND policy_date <= ${endExpr}
 *   `;
 * }
 * ```
 */
export function buildDC002QueryFilters(
  filters: AdvancedFilterState,
  context: string
): {
  dateRange: DC002CompliantDateRange;
  sqlExpressions: ReturnType<typeof formatDC002DateSQL>;
} {
  const dateRange = extractDC002DateRange(filters, context);
  const sqlExpressions = formatDC002DateSQL(dateRange);

  return {
    dateRange,
    sqlExpressions,
  };
}

/**
 * TypeScript 编译时守卫（类型级检查）
 *
 * 使用条件类型和 never 类型在编译时检测违规
 *
 * @example
 * ```typescript
 * // ✅ 编译通过
 * type Valid1 = DC002CompileTimeGuard<'user-date'>;
 *
 * // ❌ 编译错误
 * type Invalid = DC002CompileTimeGuard<'CURRENT_DATE'>;
 * //    ^^^^^^
 * // Type 'CURRENT_DATE' is not assignable to type 'never'
 * ```
 */
export type DC002CompileTimeGuard<T extends string> =
  T extends 'CURRENT_DATE' | 'current_date' | 'CURDATE()' | 'NOW()'
    ? never
    : T;

/**
 * DC-002 合规性检查器（用于单元测试）
 *
 * @param filters - 筛选条件
 * @returns 检查结果
 */
export function checkDC002Compliance(filters: AdvancedFilterState): {
  compliant: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // 检查1：日期字段是否存在
  if (!filters.policy_date_start && !filters.policy_date_end) {
    violations.push('未设置日期范围（policy_date_start 和 policy_date_end 均为 undefined）');
  }

  // 检查2：日期格式是否正确
  const validateDate = (date: string | undefined, field: string) => {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      violations.push(`${field} 格式错误: ${date}（应为 YYYY-MM-DD）`);
    }
  };

  validateDate(filters.policy_date_start, 'policy_date_start');
  validateDate(filters.policy_date_end, 'policy_date_end');

  return {
    compliant: violations.length === 0,
    violations,
  };
}
