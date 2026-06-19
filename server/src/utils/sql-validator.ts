/**
 * SQL 查询验证器 (只读 + 口径保护 + 性能建议)
 *
 * 强制约束:
 * 1. 只读:禁止任何写入/修改/导入/导出
 * 2. 视图边界:只能访问 PolicyFact 视图
 * 3. 隐私口径:禁止单条保单明细
 * 4. 单语句:只允许单条 SELECT/WITH
 * 5. 性能建议:检测潜在的性能问题
 */

import type { ValidationResult } from '../types/sql-query.js';
import { isRelationAllowed, isFederationEnabled } from '../config/sql-federation-policy.js';

/**
 * SQL 长度限制 (字符)
 */
export const MAX_SQL_LENGTH = 8000;

/**
 * 禁止的 SQL 关键词 (DDL/DML/文件操作/系统级)
 *
 * 包括:
 * - DDL: CREATE, ALTER, DROP
 * - DML: DELETE, INSERT, UPDATE, TRUNCATE, REPLACE
 * - 连接与扩展: ATTACH, DETACH, INSTALL, LOAD
 * - 文件操作: COPY, EXPORT, IMPORT
 * - 系统级: PRAGMA, SET, CALL
 */
const FORBIDDEN_KEYWORDS = [
  // DDL
  'CREATE',
  'ALTER',
  'DROP',
  // DML
  'DELETE',
  'INSERT',
  'UPDATE',
  'TRUNCATE',
  'REPLACE',
  // 连接与扩展
  'ATTACH',
  'DETACH',
  'INSTALL',
  'LOAD',
  // 文件操作
  'COPY',
  'EXPORT',
  'IMPORT',
  // 系统级
  'PRAGMA',
  'SET',
  'CALL',
];

/**
 * 禁止的文件操作函数
 */
const FORBIDDEN_FUNCTIONS = [
  'read_parquet',
  'read_csv',
  'read_json',
  'write_parquet',
  'write_csv',
  'copy_to',
];

/**
 * 禁止访问的表/视图
 */
const FORBIDDEN_TABLES = ['raw_parquet'];

/**
 * 隐私保护:禁止选择的字段 (保单明细)
 */
const FORBIDDEN_FIELDS = ['policy_no'];

/**
 * 聚合函数列表 (必须出现至少一个)
 */
const AGGREGATE_FUNCTIONS = [
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'MEDIAN',
  'PERCENTILE',
  'STDDEV',
  'VARIANCE',
  'ARRAY_AGG',
  'STRING_AGG',
];

function removeSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n\r]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function maskStringLiterals(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, "''");
}

function sqlForStructuralChecks(sql: string): string {
  return maskStringLiterals(removeSqlComments(sql));
}

function collectCteAliases(sql: string): Set<string> {
  const aliases = new Set<string>();
  const ctePattern = /(?:\bWITH|,)\s+([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = ctePattern.exec(sql)) !== null) {
    aliases.add(match[1].toUpperCase());
  }
  return aliases;
}

function collectReferencedRelations(sql: string): string[] {
  const refs: string[] = [];
  const relationPattern = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = relationPattern.exec(sql)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

/**
 * 访问边界校验（派生域联邦感知）。
 *
 * 每个被引用的关系必须是：CTE 别名、或当前开关状态下被授权的关系
 * （PolicyFact 始终授权；联邦白名单仅 SQL_FEDERATION_ENABLED='true' 时授权）。
 * 授权清单见 config/sql-federation-policy.ts。
 *
 * 行为兼容：开关关闭时退化为「仅 PolicyFact」，报错文案与历史一致。
 */
function validateRelationBoundary(sql: string): ValidationResult | null {
  const cteAliases = collectCteAliases(sql);
  const relations = collectReferencedRelations(sql);
  let hasAllowedBaseRelation = false;

  for (const relation of relations) {
    const normalized = relation.toUpperCase();
    if (cteAliases.has(normalized)) {
      continue;
    }
    if (isRelationAllowed(relation)) {
      hasAllowedBaseRelation = true;
      continue;
    }
    return {
      valid: false,
      error: `禁止访问 ${relation} 表 (访问边界限制)`,
    };
  }

  if (!hasAllowedBaseRelation) {
    return {
      valid: false,
      error: isFederationEnabled()
        ? '查询必须使用已授权的视图 (访问边界限制)'
        : '查询必须使用 PolicyFact 视图 (访问边界限制)',
    };
  }

  return null;
}

/**
 * 验证 SQL 查询
 *
 * @param sql - SQL 查询语句
 * @returns 验证结果
 */
export function validateSQL(sql: string): ValidationResult {
  // 去除首尾空白
  const trimmedSQL = sql.trim();

  // 1. 长度限制
  if (trimmedSQL.length === 0) {
    return {
      valid: false,
      error: 'SQL 语句不能为空',
    };
  }

  if (trimmedSQL.length > MAX_SQL_LENGTH) {
    return {
      valid: false,
      error: `SQL 语句长度超过限制 (${MAX_SQL_LENGTH} 字符)`,
    };
  }

  // 2. 单语句限制 (禁止分号分隔的多语句)
  const semicolonCount = (trimmedSQL.match(/;/g) || []).length;
  // 允许末尾有一个分号,但不允许中间有分号
  if (semicolonCount > 1 || (semicolonCount === 1 && !trimmedSQL.endsWith(';'))) {
    return {
      valid: false,
      error: '禁止多语句执行,只允许单条查询',
    };
  }

  // 规范化 SQL (转大写,用于关键词检测)
  const normalizedSQL = trimmedSQL.toUpperCase();
  const structuralSQL = sqlForStructuralChecks(trimmedSQL);
  const normalizedStructuralSQL = structuralSQL.toUpperCase();

  // 3. 只读语句限制 (仅允许 SELECT 或 WITH 开头)
  if (!normalizedStructuralSQL.startsWith('SELECT') && !normalizedStructuralSQL.startsWith('WITH')) {
    return {
      valid: false,
      error: '只允许 SELECT 或 WITH 查询语句',
    };
  }

  // 4. 黑名单检测 (DDL/DML/文件操作/系统级)
  for (const keyword of FORBIDDEN_KEYWORDS) {
    // 使用单词边界匹配,避免误判 (例如 INSERT 不应匹配到 INSERTED)
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(normalizedStructuralSQL)) {
      return {
        valid: false,
        error: `禁止使用 ${keyword} 语句 (只读查询模式)`,
      };
    }
  }

  // 5. 文件操作函数检测
  for (const func of FORBIDDEN_FUNCTIONS) {
    if (normalizedStructuralSQL.includes(func.toUpperCase())) {
      return {
        valid: false,
        error: `禁止使用文件操作函数 ${func} (只读查询模式)`,
      };
    }
  }

  // 6. 访问边界检测（派生域联邦感知）
  const boundaryError = validateRelationBoundary(structuralSQL);
  if (boundaryError) return boundaryError;

  // 6.1 禁止访问 raw_parquet
  for (const table of FORBIDDEN_TABLES) {
    if (normalizedStructuralSQL.includes(table.toUpperCase())) {
      return {
        valid: false,
        error: `禁止访问 ${table} 表 (访问边界限制)`,
      };
    }
  }

  // 7. 隐私口径检测 (禁止选择保单明细字段)
  // 策略：policy_no 只允许作为计数字段出现，禁止返回或重构明细值。
  for (const field of FORBIDDEN_FIELDS) {
    const allowedCountPattern = new RegExp(
      `\\bCOUNT\\s*\\(\\s*(?:DISTINCT\\s+)?(?:\\w+\\.)?${field}\\s*\\)`,
      'gi'
    );
    const sqlWithoutAllowedCounts = structuralSQL.replace(allowedCountPattern, '');
    if (new RegExp(`\\b${field}\\b`, 'i').test(sqlWithoutAllowedCounts)) {
      return {
        valid: false,
        error: `禁止查询保单明细字段 ${field} (隐私保护)`,
      };
    }

    // 7.1 检查 GROUP BY 子句（禁止 GROUP BY policy_no）
    const groupByMatch = trimmedSQL.match(/GROUP\s+BY\s+(.+?)(?:HAVING|ORDER|LIMIT|$)/is);
    if (groupByMatch) {
      const groupByClause = groupByMatch[1];
      if (new RegExp(`\\b${field}\\b`, 'i').test(groupByClause)) {
        return {
          valid: false,
          error: `禁止按保单明细字段 ${field} 分组 (隐私保护)`,
        };
      }
    }

    // 7.2 检查 ORDER BY 子句（禁止 ORDER BY policy_no）
    const orderByMatch = trimmedSQL.match(/ORDER\s+BY\s+(.+?)(?:LIMIT|$)/is);
    if (orderByMatch) {
      const orderByClause = orderByMatch[1];
      if (new RegExp(`\\b${field}\\b`, 'i').test(orderByClause)) {
        return {
          valid: false,
          error: `禁止按保单明细字段 ${field} 排序 (隐私保护)`,
        };
      }
    }
  }

  // 8. 聚合要求检测 (必须包含聚合函数或 GROUP BY)
  const hasGroupBy = /\bGROUP\s+BY\b/i.test(normalizedSQL);
  const hasAggregateFunction = AGGREGATE_FUNCTIONS.some((func) =>
    new RegExp(`\\b${func}\\s*\\(`, 'i').test(normalizedSQL)
  );

  if (!hasGroupBy && !hasAggregateFunction) {
    return {
      valid: false,
      error: '查询必须包含聚合函数 (SUM, COUNT, AVG 等) 或 GROUP BY 子句 (禁止单条明细查询)',
    };
  }

  // 所有检查通过
  return {
    valid: true,
  };
}

/**
 * 检查 SQL 是否为只读查询
 *
 * @param sql - SQL 查询语句
 * @returns 是否为只读查询
 */
export function isReadOnlyQuery(sql: string): boolean {
  const normalizedSQL = sql.trim().toUpperCase();

  // 只读查询必须以 SELECT 或 WITH 开头
  if (!normalizedSQL.startsWith('SELECT') && !normalizedSQL.startsWith('WITH')) {
    return false;
  }

  // 不能包含写入关键词
  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(normalizedSQL)) {
      return false;
    }
  }

  return true;
}

/**
 * 检查 SQL 是否包含聚合
 *
 * @param sql - SQL 查询语句
 * @returns 是否包含聚合
 */
export function hasAggregation(sql: string): boolean {
  const normalizedSQL = sql.toUpperCase();

  const hasGroupBy = /\bGROUP\s+BY\b/i.test(normalizedSQL);
  const hasAggregateFunction = AGGREGATE_FUNCTIONS.some((func) =>
    new RegExp(`\\b${func}\\s*\\(`, 'i').test(normalizedSQL)
  );

  return hasGroupBy || hasAggregateFunction;
}

/**
 * SQL 性能分析结果
 */
export interface SQLPerformanceAnalysis {
  /** 复杂度分数 (0-100, 越高越复杂) */
  complexityScore: number;
  /** 性能建议 */
  suggestions: string[];
  /** 是否缺少 LIMIT 子句 */
  missingLimit: boolean;
  /** 是否包含多表 JOIN */
  hasJoins: boolean;
  /** JOIN 数量 */
  joinCount: number;
  /** 是否包含子查询 */
  hasSubqueries: boolean;
  /** 子查询数量 */
  subqueryCount: number;
  /** 是否包含 CTE (WITH) */
  hasCTE: boolean;
  /** CTE 数量 */
  cteCount: number;
}

/**
 * 分析 SQL 性能并提供优化建议
 *
 * @param sql - SQL 查询语句
 * @returns 性能分析结果
 */
export function analyzePerformance(sql: string): SQLPerformanceAnalysis {
  const normalizedSQL = sql.toUpperCase();
  const suggestions: string[] = [];
  let complexityScore = 0;

  // 1. 检测 LIMIT 子句
  const hasLimit = /\bLIMIT\b/i.test(normalizedSQL);
  if (!hasLimit) {
    suggestions.push('建议添加 LIMIT 子句限制结果行数，避免返回过多数据');
    complexityScore += 20;
  }

  // 2. 检测 JOIN
  const joinMatches = normalizedSQL.match(/\b(JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+OUTER\s+JOIN)\b/gi);
  const joinCount = joinMatches ? joinMatches.length : 0;
  const hasJoins = joinCount > 0;

  if (joinCount > 3) {
    suggestions.push(`查询包含 ${joinCount} 个 JOIN，建议检查是否可以简化`);
    complexityScore += joinCount * 10;
  } else if (joinCount > 0) {
    complexityScore += joinCount * 5;
  }

  // 3. 检测子查询 (括号内包含 SELECT)
  const subqueryMatches = normalizedSQL.match(/\(\s*SELECT/gi);
  const subqueryCount = subqueryMatches ? subqueryMatches.length : 0;
  const hasSubqueries = subqueryCount > 0;

  if (subqueryCount > 2) {
    suggestions.push(`查询包含 ${subqueryCount} 个子查询，考虑使用 CTE (WITH) 提高可读性`);
    complexityScore += subqueryCount * 15;
  } else if (subqueryCount > 0) {
    complexityScore += subqueryCount * 8;
  }

  // 4. 检测 CTE (WITH)
  const cteMatches = normalizedSQL.match(/\bWITH\b/gi);
  const cteCount = cteMatches ? cteMatches.length : 0;
  const hasCTE = cteCount > 0;

  if (cteCount > 0) {
    complexityScore += cteCount * 3;
  }

  // 5. 检测 UNION/UNION ALL
  const hasUnion = /\bUNION\b/i.test(normalizedSQL);
  if (hasUnion) {
    suggestions.push('查询包含 UNION，建议使用 UNION ALL 提高性能（如果不需要去重）');
    complexityScore += 10;
  }

  // 6. 检测 DISTINCT
  const hasDistinct = /\bDISTINCT\b/i.test(normalizedSQL);
  if (hasDistinct && !hasUnion) {
    suggestions.push('查询使用 DISTINCT，考虑使用 GROUP BY 替代以优化性能');
    complexityScore += 5;
  }

  // 7. 检测 ORDER BY（没有 LIMIT 的 ORDER BY 性能较差）
  const hasOrderBy = /\bORDER\s+BY\b/i.test(normalizedSQL);
  if (hasOrderBy && !hasLimit) {
    suggestions.push('ORDER BY 没有 LIMIT 限制，大数据量时性能较差');
    complexityScore += 15;
  }

  // 8. 检测窗口函数
  const hasWindowFunction = /\bOVER\s*\(/i.test(normalizedSQL);
  if (hasWindowFunction) {
    suggestions.push('查询使用窗口函数，确保有适当的 PARTITION BY 子句');
    complexityScore += 20;
  }

  // 9. 检测 LIKE 操作符（可能性能较差）
  const likeMatches = normalizedSQL.match(/\bLIKE\b/gi);
  if (likeMatches && likeMatches.length > 2) {
    suggestions.push('查询包含多个 LIKE 操作，可能影响性能，考虑使用全文索引');
    complexityScore += likeMatches.length * 5;
  }

  // 10. 检测通配符 LIKE（%开头的模式无法使用索引）
  const hasLeadingWildcard = /LIKE\s+'%[^']+'/i.test(sql);
  if (hasLeadingWildcard) {
    suggestions.push('LIKE 以通配符开头，无法使用索引，考虑优化查询条件');
    complexityScore += 10;
  }

  // 限制复杂度分数在 0-100 范围内
  complexityScore = Math.min(100, complexityScore);

  return {
    complexityScore,
    suggestions,
    missingLimit: !hasLimit,
    hasJoins,
    joinCount,
    hasSubqueries,
    subqueryCount,
    hasCTE,
    cteCount,
  };
}

/**
 * 增强的 SQL 验证（包含性能分析）
 *
 * @param sql - SQL 查询语句
 * @returns 验证结果（包含性能建议）
 */
export function validateSQLWithPerformance(
  sql: string
): ValidationResult & { performance?: SQLPerformanceAnalysis } {
  // 先执行基础验证
  const baseValidation = validateSQL(sql);

  if (!baseValidation.valid) {
    return baseValidation;
  }

  // 执行性能分析
  const performance = analyzePerformance(sql);

  return {
    ...baseValidation,
    performance,
  };
}
