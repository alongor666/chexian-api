/**
 * SQL 权限注入工具
 *
 * 安全地将行级权限过滤条件注入到用户 SQL 中
 * 简化实现，处理常见场景
 */

/**
 * 移除 SQL 注释（防止注释中的关键字干扰解析）
 * @param sql - 原始 SQL
 * @returns 移除注释后的 SQL
 */
function removeComments(sql: string): string {
  // 移除 -- 单行注释
  let result = sql.replace(/--[^\n]*/g, '');
  // 移除 /* */ 多行注释
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

/**
 * 检查 SQL 是否包含 CTE (WITH 子句)
 */
function hasCTE(sql: string): boolean {
  const cleanSql = removeComments(sql);
  return /^\s*WITH\s+/i.test(cleanSql);
}

/**
 * 在表名后插入 WHERE 子句
 * 处理常见的 FROM 表名 模式
 * @param sql - 原始 SQL
 * @param permissionFilter - 权限过滤条件
 * @returns 注入后的 SQL
 */
function injectWhereAfterFrom(sql: string, permissionFilter: string): string {
  const cleanSql = removeComments(sql);

  // 模式1: FROM table_name WHERE ... (已有 WHERE)
  // 在现有 WHERE 条件后添加 AND
  const whereExistsPattern = /\bFROM\s+(\w+)(\s+AS\s+\w+|\s+\w+)?\s+WHERE\s+/i;
  if (whereExistsPattern.test(cleanSql)) {
    // 替换 WHERE 为 WHERE (existing_condition) AND (permission)
    // 需要找到 WHERE 后面的条件并包裹
    return sql.replace(
      /(\bWHERE\s+)(.+?)(\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s+HAVING|\s+UNION|\s+EXCEPT|\s+INTERSECT|$)/i,
      (match, where, condition, suffix) => {
        return `${where}(${condition.trim()}) AND (${permissionFilter})${suffix}`;
      }
    );
  }

  // 模式2: FROM table_name GROUP BY / ORDER BY / LIMIT (无 WHERE)
  // 在 FROM table_name 后、GROUP BY/ORDER BY/LIMIT 前插入 WHERE
  const fromWithClausePattern = /(\bFROM\s+\w+(?:\s+AS\s+\w+|\s+\w+)?)\s*(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|UNION|EXCEPT|INTERSECT)/i;
  if (fromWithClausePattern.test(cleanSql)) {
    return sql.replace(
      /(\bFROM\s+\w+(?:\s+AS\s+\w+|\s+\w+)?)\s*(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|UNION|EXCEPT|INTERSECT)/i,
      `$1 WHERE ${permissionFilter} $2`
    );
  }

  // 模式3: FROM table_name JOIN ... (有 JOIN)
  // 在所有 JOIN 之后、WHERE/GROUP BY/ORDER BY 之前插入
  const fromWithJoinPattern = /\bFROM\s+\w+(?:\s+AS\s+\w+|\s+\w+)?.*?\bJOIN\b/i;
  if (fromWithJoinPattern.test(cleanSql)) {
    // 找到最后一个 JOIN 的 ON 条件之后
    // 简化处理：在 WHERE/GROUP BY/ORDER BY/LIMIT 前插入
    const insertPattern = /(\bON\s+[^)]+?)(\s+WHERE|\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s+HAVING|$)/i;
    if (insertPattern.test(cleanSql)) {
      return sql.replace(
        insertPattern,
        `$1 WHERE ${permissionFilter}$2`
      );
    }
  }

  // 模式4: 简单的 FROM table_name (无其他子句)
  // 在 FROM table_name 后追加 WHERE
  const simpleFromPattern = /(\bFROM\s+\w+(?:\s+AS\s+\w+|\s+\w+)?)\s*$/i;
  if (simpleFromPattern.test(cleanSql)) {
    return sql.replace(
      /(\bFROM\s+\w+(?:\s+AS\s+\w+|\s+\w+)?)\s*$/i,
      `$1 WHERE ${permissionFilter}`
    );
  }

  // 无法识别的模式，抛出错误
  throw new Error('无法解析 SQL 语句格式，请使用标准 SELECT ... FROM ... 格式');
}

/**
 * 安全地将权限过滤条件注入到 SQL 中
 * @param sql - 原始用户 SQL
 * @param permissionFilter - 权限过滤条件（如 "org_level_3 LIKE '%乐山%'"）
 * @returns 注入权限后的 SQL
 */
export function injectPermissionFilter(sql: string, permissionFilter: string): string {
  // 1=1 表示无需过滤
  if (!permissionFilter || permissionFilter === '1=1') {
    return sql;
  }

  // 检查是否有 CTE
  if (hasCTE(sql)) {
    // CTE 查询暂不支持自动注入，需要手动处理
    throw new Error('CTE (WITH 子句) 查询暂不支持自动权限注入，请在主查询中手动添加 WHERE 条件');
  }

  return injectWhereAfterFrom(sql, permissionFilter);
}

/**
 * 验证权限过滤条件格式（防止注入）
 * @param filter - 权限过滤条件
 * @returns 是否有效
 */
export function isValidPermissionFilter(filter: string): boolean {
  // 空或默认值是有效的
  if (!filter || filter === '1=1') {
    return true;
  }

  // 权限过滤只允许特定格式
  // 格式1: field_name LIKE '%value%'
  // 格式2: field_name = 'value'
  // 格式3: field_name IN ('v1', 'v2', ...)
  // 可以用 AND/OR 组合多个条件

  // 禁止的模式
  const dangerousPatterns = [
    /;\s*$/,           // SQL 语句终止符
    /;\s*\w/,          // 多语句
    /--/,              // 单行注释
    /\/\*/,            // 多行注释开始
    /\bunion\b/i,      // UNION 注入
    /\bdrop\b/i,       // DROP 语句
    /\bdelete\b/i,     // DELETE 语句
    /\bupdate\b/i,     // UPDATE 语句
    /\binsert\b/i,     // INSERT 语句
    /\bcreate\b/i,     // CREATE 语句
    /\balter\b/i,      // ALTER 语句
    /\bexec\b/i,       // EXEC 语句
    /\bexecute\b/i,    // EXECUTE 语句
    /\bxp_/i,          // SQL Server 扩展存储过程
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(filter)) {
      return false;
    }
  }

  return true;
}
