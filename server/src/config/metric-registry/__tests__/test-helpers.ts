/**
 * 领域断言测试 — 共享常量与工具函数
 *
 * 避免 L4_IDS 等常量在多个测试文件中重复硬编码。
 */

/** L4 占位符指标 — SQL 以注释 "-- L4" 开头，无法执行 */
export const L4_METRIC_IDS: ReadonlySet<string> = new Set([
  'fixed_cost_amount',
  'fixed_cost_ratio',
  'combined_cost_amount',
  'combined_cost_ratio',
  'earned_profit_amount',
]);

/** L4 ID 数组形式（用于 it.each） */
export const L4_METRIC_ID_LIST: readonly string[] = [...L4_METRIC_IDS];

/**
 * 从 SQL 表达式中提取所有 AS alias（大小写不敏感）。
 *
 * 注意：正则必须在函数内部创建（非模块级），
 * 否则 /g 标志的 lastIndex 会跨调用污染。
 */
export function extractAliases(expression: string): Set<string> {
  const re = /\bAS\s+(\w+)/gi;
  const aliases = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) {
    aliases.add(m[1].toLowerCase());
  }
  return aliases;
}

/** testCase whereClause 安全格式校验（禁止分号、注释、引号注入） */
const SAFE_WHERE_RE = /^[^;'"\\-]{0,500}$/;
export function assertSafeWhereClause(whereClause: string, context: string): void {
  if (!SAFE_WHERE_RE.test(whereClause)) {
    throw new Error(`${context}: whereClause 格式非法 — "${whereClause}"`);
  }
}
