/**
 * SQL 参数安全处理工具
 *
 * 防止 SQL 注入攻击，提供安全的参数构建方法
 */

import { escapeSqlLiteral } from './security.js';

/**
 * 验证日期格式是否为 YYYY-MM-DD
 */
export function isValidDateFormat(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * 验证日期时间格式是否为 YYYY-MM-DD HH:MM:SS
 */
export function isValidDateTimeFormat(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(value);
}

/**
 * @deprecated 使用 security.ts 的 escapeSqlLiteral 替代。保留仅为向后兼容。
 */
export function escapeSqlString(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('escapeSqlString expects a string');
  }
  return escapeSqlLiteral(value);
}

/**
 * 验证并转义日期值
 * @throws Error 如果日期格式无效
 */
export function sanitizeDate(value: string): string {
  if (!isValidDateFormat(value) && !isValidDateTimeFormat(value)) {
    throw new Error(`Invalid date format: ${value}. Expected YYYY-MM-DD`);
  }
  return escapeSqlString(value);
}

/**
 * 构建安全的日期条件
 * @param field - 字段名
 * @param operator - 操作符 (>=, <=, =, >, <)
 * @param value - 日期值
 * @returns SQL 条件字符串
 */
export function buildDateCondition(
  field: string,
  operator: '>=' | '<=' | '=' | '>' | '<',
  value: string
): string {
  // 验证字段名只包含合法字符
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
    throw new Error(`Invalid field name: ${field}`);
  }

  // 验证操作符
  const validOperators = ['>=', '<=', '=', '>', '<'];
  if (!validOperators.includes(operator)) {
    throw new Error(`Invalid operator: ${operator}`);
  }

  // 验证并转义日期值
  const sanitizedValue = sanitizeDate(value);

  return `${field} ${operator} '${sanitizedValue}'`;
}

/**
 * 构建安全的字符串相等条件
 * @param field - 字段名
 * @param value - 字符串值
 * @returns SQL 条件字符串
 */
export function buildStringCondition(field: string, value: string): string {
  // 验证字段名只包含合法字符
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
    throw new Error(`Invalid field name: ${field}`);
  }

  const sanitizedValue = escapeSqlString(value);
  return `${field} = '${sanitizedValue}'`;
}

/**
 * 构建安全的 LIKE 条件
 * @param field - 字段名
 * @param pattern - LIKE 模式
 * @returns SQL 条件字符串
 */
export function buildLikeCondition(field: string, pattern: string): string {
  // 验证字段名只包含合法字符
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
    throw new Error(`Invalid field name: ${field}`);
  }

  // 转义 LIKE 特殊字符和 SQL 引号
  const sanitizedPattern = pattern
    .replace(/'/g, "''")
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');

  return `${field} LIKE '%${sanitizedPattern}%' ESCAPE '\\'`;
}

/**
 * 验证数字值
 */
export function sanitizeNumber(value: unknown): number {
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return num;
}

/**
 * 构建安全的数字条件
 */
export function buildNumberCondition(
  field: string,
  operator: '>=' | '<=' | '=' | '>' | '<',
  value: number
): string {
  // 验证字段名
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
    throw new Error(`Invalid field name: ${field}`);
  }

  const sanitizedValue = sanitizeNumber(value);
  return `${field} ${operator} ${sanitizedValue}`;
}

/**
 * 构建安全的 IN 条件（字符串数组）
 */
export function buildInCondition(field: string, values: string[]): string {
  // 验证字段名
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
    throw new Error(`Invalid field name: ${field}`);
  }

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('buildInCondition requires non-empty array');
  }

  const sanitizedValues = values.map(v => `'${escapeSqlString(v)}'`).join(', ');
  return `${field} IN (${sanitizedValues})`;
}
