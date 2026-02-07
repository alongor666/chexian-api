/**
 * SQL 生成器
 *
 * 根据查询构建器状态生成 SQL 语句
 */

import type {
  QueryBuilderState,
  SelectedMeasure,
  FilterCondition,
} from './types';
import { getFieldDefinition } from './fieldConfig';

/**
 * 构建聚合表达式
 */
function buildAggregateExpression(measure: SelectedMeasure): string {
  const { field, aggregate } = measure;

  switch (aggregate) {
    case 'COUNT':
      return `COUNT(${field})`;
    case 'COUNT_DISTINCT':
      return `COUNT(DISTINCT ${field})`;
    case 'SUM':
      return `SUM(${field})`;
    case 'AVG':
      return `AVG(${field})`;
    case 'MIN':
      return `MIN(${field})`;
    case 'MAX':
      return `MAX(${field})`;
    default:
      return `${aggregate}(${field})`;
  }
}

/**
 * 转义 SQL 字符串值
 */
function escapeValue(value: string): string {
  // 转义单引号
  return value.replace(/'/g, "''");
}

/**
 * 格式化值用于 SQL
 */
function formatValue(value: string, dataType: string): string {
  if (dataType === 'number') {
    return value;
  }
  if (dataType === 'date') {
    return `'${escapeValue(value)}'`;
  }
  if (dataType === 'boolean') {
    // 布尔值处理：支持多种表示
    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true' || lowerValue === '是' || lowerValue === '1') {
      return 'TRUE';
    }
    if (lowerValue === 'false' || lowerValue === '否' || lowerValue === '0') {
      return 'FALSE';
    }
    return `'${escapeValue(value)}'`;
  }
  return `'${escapeValue(value)}'`;
}

/**
 * 构建筛选条件表达式
 */
function buildFilterExpression(filter: FilterCondition): string {
  const { field, operator, value, value2 } = filter;
  const fieldDef = getFieldDefinition(field);
  const dataType = fieldDef?.dataType || 'string';

  switch (operator) {
    case '=':
    case '!=':
    case '>':
    case '>=':
    case '<':
    case '<=':
      if (value === null || value === '') {
        return '';
      }
      return `${field} ${operator} ${formatValue(value as string, dataType)}`;

    case 'IN':
    case 'NOT IN': {
      if (!value || (Array.isArray(value) && value.length === 0)) {
        return '';
      }
      const values = Array.isArray(value) ? value : [value];
      const formattedValues = values.map((v) => formatValue(v, dataType)).join(', ');
      return `${field} ${operator} (${formattedValues})`;
    }

    case 'LIKE':
      if (value === null || value === '') {
        return '';
      }
      return `${field} LIKE '%${escapeValue(value as string)}%'`;

    case 'IS NULL':
      return `${field} IS NULL`;

    case 'IS NOT NULL':
      return `${field} IS NOT NULL`;

    case 'BETWEEN':
      if (!value || !value2) {
        return '';
      }
      return `${field} BETWEEN ${formatValue(value as string, dataType)} AND ${formatValue(value2, dataType)}`;

    default:
      return '';
  }
}

/**
 * 验证查询构建器状态
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateQueryBuilderState(state: QueryBuilderState): ValidationResult {
  const errors: string[] = [];

  // 必须至少有一个度量
  if (state.measures.length === 0) {
    errors.push('请至少选择一个度量字段');
  }

  // 检查度量别名唯一性
  const aliases = state.measures.map((m) => m.alias);
  const uniqueAliases = new Set(aliases);
  if (aliases.length !== uniqueAliases.size) {
    errors.push('度量别名不能重复');
  }

  // 检查筛选条件有效性
  for (const filter of state.filters) {
    if (!filter.field) {
      errors.push('筛选条件必须选择字段');
    }
    if (!filter.operator) {
      errors.push('筛选条件必须选择操作符');
    }
    // 某些操作符需要值
    const needsValue = !['IS NULL', 'IS NOT NULL'].includes(filter.operator);
    if (needsValue && (filter.value === null || filter.value === '')) {
      errors.push(`筛选条件 "${filter.field}" 需要输入值`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 根据查询构建器状态生成 SQL
 */
export function generateSqlFromBuilder(state: QueryBuilderState): string {
  const { dimensions, measures, filters, orderBy, limit } = state;

  // 验证状态
  const validation = validateQueryBuilderState(state);
  if (!validation.valid) {
    return `-- 查询配置错误:\n-- ${validation.errors.join('\n-- ')}`;
  }

  // SELECT 子句
  const selectParts: string[] = [];

  // 添加维度
  for (const dim of dimensions) {
    const alias = dim.alias && dim.alias !== dim.field ? ` AS "${dim.alias}"` : '';
    selectParts.push(`${dim.field}${alias}`);
  }

  // 添加度量
  for (const measure of measures) {
    const aggExpr = buildAggregateExpression(measure);
    selectParts.push(`${aggExpr} AS "${measure.alias}"`);
  }

  // FROM 子句
  const fromClause = 'FROM PolicyFact';

  // WHERE 子句
  const filterExpressions = filters
    .map(buildFilterExpression)
    .filter((expr) => expr !== '');
  const whereClause = filterExpressions.length > 0
    ? `WHERE ${filterExpressions.join('\n  AND ')}`
    : '';

  // GROUP BY 子句
  const groupByClause = dimensions.length > 0
    ? `GROUP BY ${dimensions.map((d) => d.field).join(', ')}`
    : '';

  // ORDER BY 子句
  let orderByClause = '';
  if (orderBy && orderBy.field) {
    orderByClause = `ORDER BY "${orderBy.field}" ${orderBy.direction}`;
  } else if (measures.length > 0) {
    // 默认按第一个度量降序
    orderByClause = `ORDER BY "${measures[0].alias}" DESC`;
  }

  // LIMIT 子句
  const limitClause = `LIMIT ${limit}`;

  // 组装 SQL
  const parts = [
    `SELECT ${selectParts.join(',\n       ')}`,
    fromClause,
    whereClause,
    groupByClause,
    orderByClause,
    limitClause,
  ].filter((part) => part !== '');

  return parts.join('\n');
}

/**
 * 生成预览 SQL（不包含 LIMIT）
 */
export function generatePreviewSql(state: QueryBuilderState): string {
  const fullSql = generateSqlFromBuilder(state);
  // 移除最后一行的 LIMIT
  const lines = fullSql.split('\n');
  const lastLine = lines[lines.length - 1];
  if (lastLine.startsWith('LIMIT')) {
    return lines.slice(0, -1).join('\n');
  }
  return fullSql;
}

/**
 * 生成字段选项加载 SQL
 */
export function generateDistinctValuesSql(field: string, limit = 100): string {
  return `SELECT DISTINCT ${field}
FROM PolicyFact
WHERE ${field} IS NOT NULL
ORDER BY ${field}
LIMIT ${limit}`;
}

/**
 * 生成计数预览 SQL
 */
export function generateCountPreviewSql(state: QueryBuilderState): string {
  const { dimensions, filters } = state;

  // WHERE 子句
  const filterExpressions = filters
    .map(buildFilterExpression)
    .filter((expr) => expr !== '');
  const whereClause = filterExpressions.length > 0
    ? `WHERE ${filterExpressions.join(' AND ')}`
    : '';

  // GROUP BY 子句
  const groupByClause = dimensions.length > 0
    ? `GROUP BY ${dimensions.map((d) => d.field).join(', ')}`
    : '';

  // 如果有维度，计算分组数量；否则计算总行数
  if (dimensions.length > 0) {
    return `SELECT COUNT(*) as group_count FROM (
  SELECT ${dimensions.map((d) => d.field).join(', ')}
  FROM PolicyFact
  ${whereClause}
  ${groupByClause}
)`;
  } else {
    return `SELECT COUNT(*) as row_count FROM PolicyFact ${whereClause}`;
  }
}
