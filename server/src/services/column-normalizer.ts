/**
 * 列名标准化服务
 * Column Normalization Service
 *
 * 将中文列名映射为英文标准列名
 */

import { COLUMN_ALIASES } from '../normalize/mapping.js';

/**
 * 布尔字段列表（需要类型转换）
 */
const BOOLEAN_FIELDS = [
  'is_renewal',
  'is_renewable',
  'is_new_car',
  'is_transfer',
  'is_nev',
  'is_telemarketing',
  'is_commercial_insure',
  'is_quote',
];

/**
 * 生成列名映射SQL
 * 根据COLUMN_ALIASES配置，将中文列名映射为英文列名
 */
export function generateColumnMappingSQL(
  sourceTable: string,
  actualColumns: string[]
): string {
  const mappings: string[] = [];

  // 遍历标准字段定义
  for (const [standardName, aliases] of Object.entries(COLUMN_ALIASES)) {
    // 查找实际列名
    const actualColumn = actualColumns.find((col) =>
      aliases.some((alias) => col === alias || col.includes(alias))
    );

    if (actualColumn) {
      // 检查是否需要类型转换
      if (BOOLEAN_FIELDS.includes(standardName)) {
        // 布尔字段：将字符串转换为布尔值
        // 假设: "是"/"1"/"true" -> true, 其他 -> false
        mappings.push(
          `CASE WHEN CAST("${actualColumn}" AS VARCHAR) IN ('是', '1', 'true', 'TRUE') THEN true ELSE false END as ${standardName}`
        );
      } else if (standardName.includes('date')) {
        // 日期字段：转换为DATE类型
        mappings.push(`TRY_CAST("${actualColumn}" AS DATE) as ${standardName}`);
      } else {
        // 普通字段：直接映射
        mappings.push(`"${actualColumn}" as ${standardName}`);
      }
    } else {
      // 如果找不到，使用默认值
      if (BOOLEAN_FIELDS.includes(standardName)) {
        mappings.push(`false as ${standardName}`);
      } else {
        mappings.push(`NULL as ${standardName}`);
      }
    }
  }

  return `
    CREATE OR REPLACE VIEW PolicyFact AS
    SELECT
      ${mappings.join(',\n      ')}
    FROM ${sourceTable}
  `;
}

/**
 * 获取列名映射关系
 */
export function getColumnMapping(actualColumns: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};

  for (const [standardName, aliases] of Object.entries(COLUMN_ALIASES)) {
    const actualColumn = actualColumns.find((col) =>
      aliases.some((alias) => col === alias || col.includes(alias))
    );
    mapping[standardName] = actualColumn || null;
  }

  return mapping;
}
