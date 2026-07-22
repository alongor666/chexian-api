import { escapeSqlString } from './sql-sanitizer.js';

/**
 * 经代名称唯一规范化口径：只剥离前导数字机构码，保留业务全称。
 *
 * 禁止在此做“邮政/邮储”等模糊短名归并；中国邮政储蓄银行全名包含“邮政”，
 * LIKE/包含关系会把两个独立业务主体错误合并。
 */
export const NORMALIZED_AGENT_NAME_SQL =
  "COALESCE(NULLIF(TRIM(REGEXP_REPLACE(agent_name, '^[0-9]+', '')), ''), '无经代')";

/** 精确匹配规范化后的经代全名；值只进入转义后的 IN 列表。 */
export function buildNormalizedAgentNameInCondition(values: readonly string[]): string {
  if (values.length === 0) {
    throw new Error('buildNormalizedAgentNameInCondition requires non-empty values');
  }
  const sanitizedValues = values.map((value) => `'${escapeSqlString(value)}'`).join(', ');
  return `${NORMALIZED_AGENT_NAME_SQL} IN (${sanitizedValues})`;
}
