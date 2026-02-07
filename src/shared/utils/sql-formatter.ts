/**
 * SQL 格式化工具
 *
 * 提供 SQL 代码的格式化和美化功能
 */

/**
 * SQL 关键字列表（用于大写转换）
 */
const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'OUTER',
  'ON',
  'AND',
  'OR',
  'NOT',
  'IN',
  'AS',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'UNION',
  'ALL',
  'DISTINCT',
  'WITH',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'IS',
  'NULL',
  'ASC',
  'DESC',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'INDEX',
  'TABLE',
  'VIEW',
];

/**
 * 格式化选项
 */
export interface FormatOptions {
  /** 缩进空格数（默认 2） */
  indentSpaces?: number;
  /** 关键字大写（默认 true） */
  uppercaseKeywords?: boolean;
  /** 每行最大长度（默认 80） */
  maxLineLength?: number;
  /** 在子句前添加换行（默认 true） */
  newlineBeforeClauses?: boolean;
  /** 在逗号后换行（默认 false） */
  newlineAfterComma?: boolean;
}

/**
 * 格式化 SQL 语句
 *
 * @param sql - 原始 SQL 语句
 * @param options - 格式化选项
 * @returns 格式化后的 SQL 语句
 */
export function formatSQL(sql: string, options: FormatOptions = {}): string {
  const {
    indentSpaces = 2,
    uppercaseKeywords = true,
    newlineBeforeClauses = true,
    newlineAfterComma = false,
  } = options;

  let formatted = sql;

  // 1. 标准化空白符
  formatted = formatted.replace(/\s+/g, ' ').trim();

  // 2. 关键字大写
  if (uppercaseKeywords) {
    SQL_KEYWORDS.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      formatted = formatted.replace(regex, keyword);
    });
  }

  // 3. 在主要子句前添加换行
  if (newlineBeforeClauses) {
    const clauses = [
      'SELECT',
      'FROM',
      'WHERE',
      'GROUP BY',
      'HAVING',
      'ORDER BY',
      'LIMIT',
      'WITH',
    ];

    clauses.forEach((clause) => {
      const regex = new RegExp(`\\s+${clause}\\b`, 'gi');
      formatted = formatted.replace(regex, `\n${clause}`);
    });
  }

  // 4. 在 JOIN 前添加换行
  formatted = formatted.replace(/\s+(INNER|LEFT|RIGHT|FULL|CROSS)\s+JOIN/gi, '\n$1 JOIN');

  // 5. 在 AND/OR 前添加换行（WHERE 子句中）
  formatted = formatted.replace(/\s+(AND|OR)\s+/gi, '\n  $1 ');

  // 6. 在逗号后换行（用于长列表）
  if (newlineAfterComma) {
    formatted = formatted.replace(/,\s*/g, ',\n');
  }

  // 7. 添加缩进
  const lines = formatted.split('\n');
  let indentLevel = 0;
  const indent = ' '.repeat(indentSpaces);

  const formattedLines = lines.map((line) => {
    const trimmed = line.trim();

    // 减少缩进（闭合括号、END、ELSE）
    if (
      /^\)/.test(trimmed) ||
      /^\b(ELSE|END)\b/.test(trimmed)
    ) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const indentedLine = indent.repeat(indentLevel) + trimmed;

    // 增加缩进（开括号、CASE、WITH）
    if (
      /\($/.test(trimmed) ||
      /^\b(CASE|WITH)\b/.test(trimmed)
    ) {
      indentLevel++;
    }

    return indentedLine;
  });

  formatted = formattedLines.join('\n');

  // 8. 清理多余的空行
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

  return formatted;
}

/**
 * 压缩 SQL（单行格式）
 *
 * @param sql - 原始 SQL 语句
 * @returns 压缩后的 SQL 语句（单行）
 */
export function minifySQL(sql: string): string {
  return sql
    .replace(/\s+/g, ' ') // 多个空格合并为一个
    .replace(/\s*([,()=<>!])\s*/g, '$1') // 移除运算符周围的空格
    .trim();
}

/**
 * 获取 SQL 语句的摘要（用于显示）
 *
 * @param sql - SQL 语句
 * @param maxLength - 最大长度（默认 50）
 * @returns SQL 摘要
 */
export function getSQLSummary(sql: string, maxLength: number = 50): string {
  const compressed = minifySQL(sql);

  if (compressed.length <= maxLength) {
    return compressed;
  }

  return compressed.substring(0, maxLength) + '...';
}

/**
 * 提取 SQL 中的表名
 *
 * @param sql - SQL 语句
 * @returns 表名列表
 */
export function extractTableNames(sql: string): string[] {
  const tables: string[] = [];

  // 匹配 FROM 和 JOIN 后的表名
  const fromJoinRegex = /\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let match;

  while ((match = fromJoinRegex.exec(sql)) !== null) {
    const tableName = match[1];
    // 过滤掉子查询和常见表别名
    if (!tableName.startsWith('(') && !tables.includes(tableName)) {
      tables.push(tableName);
    }
  }

  return tables;
}

/**
 * 提取 SQL 中的字段名（SELECT 子句）
 *
 * @param sql - SQL 语句
 * @returns 字段名列表
 */
export function extractColumnNames(sql: string): string[] {
  const columns: string[] = [];

  // 提取 SELECT 和 FROM 之间的内容
  const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM/is);
  if (selectMatch) {
    const selectClause = selectMatch[1];

    // 分割逗号，提取字段名
    const parts = selectClause.split(',');
    parts.forEach((part) => {
      const trimmed = part.trim();

      // 处理 "column AS alias" 或 "column alias" 格式
      const columnName = trimmed.replace(/\s+(AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*$/i, '').trim();

      // 过滤掉聚合函数和常量
      if (
        columnName &&
        !/^\(/.test(columnName) && // 不是函数调用
        !/^[0-9]/.test(columnName) // 不是数字常量
      ) {
        columns.push(columnName);
      }
    });
  }

  return columns;
}

/**
 * 验证 SQL 语法的基本检查
 *
 * @param sql - SQL 语句
 * @returns 语法检查结果
 */
export interface SyntaxCheckResult {
  /** 是否有语法错误 */
  hasErrors: boolean;
  /** 错误列表 */
  errors: string[];
  /** 警告列表 */
  warnings: string[];
}

export function checkSyntax(sql: string): SyntaxCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 检查括号匹配
  const openParens = (sql.match(/\(/g) || []).length;
  const closeParens = (sql.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push(`括号不匹配：${openParens} 个开括号，${closeParens} 个闭括号`);
  }

  // 2. 检查基本 SQL 结构
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    errors.push('SQL 语句必须以 SELECT 或 WITH 开头');
  }

  // 3. 检查常见的语法错误
  if (/\bSELECT\s*\*\s*,/i.test(sql)) {
    warnings.push('SELECT *, 可能返回过多数据，建议明确指定字段');
  }

  if (/\bFROM\s+$/i.test(sql.trim())) {
    errors.push('FROM 子句后缺少表名');
  }

  if (/\bWHERE\s+$/i.test(sql.trim())) {
    errors.push('WHERE 子句后缺少条件');
  }

  return {
    hasErrors: errors.length > 0,
    errors,
    warnings,
  };
}
