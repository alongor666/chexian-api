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
 * CTE 兼容的权限注入。
 *
 * 策略：对 SQL 中每个直接读取 PolicyFact 的位置（`FROM PolicyFact [alias]`）
 * 应用与 injectWhereAfterFrom 相同的注入规则。引用其它 CTE 别名的 FROM 不动 ——
 * 因为它的上游 CTE 已经被过滤过了。
 *
 * 非 CTE 情况直接委托给 injectPermissionFilter，保持兼容。
 *
 * @param sql - 原始用户 SQL（可能含 CTE）
 * @param permissionFilter - 权限过滤条件
 * @returns 注入权限后的 SQL
 */
export function injectPermissionIntoAnySql(sql: string, permissionFilter: string): string {
  if (!permissionFilter || permissionFilter === '1=1') {
    return sql;
  }

  if (!hasCTE(sql)) {
    return injectPermissionFilter(sql, permissionFilter);
  }

  // CTE 路径：遍历每个 `FROM PolicyFact [alias]` 引用，注入 WHERE
  // 用大小写不敏感的全局正则定位 PolicyFact 引用的范围（含可选别名）
  const polRefPattern = /\bFROM\s+PolicyFact(?:\s+AS\s+\w+|\s+\w+)?\b/gi;
  let result = sql;
  let consumedUpTo = 0;
  const out: string[] = [];
  let match: RegExpExecArray | null;

  // 我们对每个匹配 FROM PolicyFact 后的子句应用 inject 逻辑。为避免正则反复
  // 撞到已替换的文本，构造一份替换计划再一次性拼接。
  const replacements: Array<{ start: number; end: number; replaced: string }> = [];

  while ((match = polRefPattern.exec(sql)) !== null) {
    const fromStart = match.index;
    // 找到该 PolicyFact 引用所属的子查询/CTE 的结尾：
    // 即下一个 `)` 之前、或下一个 CTE 起点之前、或 SQL 结尾。
    // 简化做法：取从 FROM 起到下一个不被括号闭合的 `)`、或全文末尾的范围。
    const fragmentEnd = findFragmentEnd(sql, fromStart);
    const fragment = sql.slice(fromStart, fragmentEnd);
    // 把"FROM PolicyFact [alias] <rest>"片段当作一个独立 SQL 走原 inject 逻辑。
    // injectWhereAfterFrom 的几种 case 都是 "FROM <table> ..." 起始；
    // 我们这里片段也以 FROM 起始，可直接复用。
    const injected = injectWhereAfterFrom(fragment, permissionFilter);
    replacements.push({ start: fromStart, end: fragmentEnd, replaced: injected });
  }

  if (replacements.length === 0) {
    // 兜底：没匹配到 PolicyFact 引用（理论上 validateSQL 已要求必须含 PolicyFact）
    return sql;
  }

  // 按起点排序，重建 SQL
  replacements.sort((a, b) => a.start - b.start);
  let cursor = 0;
  result = '';
  for (const r of replacements) {
    result += sql.slice(cursor, r.start) + r.replaced;
    cursor = r.end;
  }
  result += sql.slice(cursor);
  return result;
}

/**
 * 找到从 fromIndex 起一个 PolicyFact-from 片段的逻辑结尾：
 * 下一个未匹配的 `)`、或下一个 CTE 头（`)\s*,\s*<ident>\s+AS\s*\(`）、或 SQL 末尾。
 * 简化策略：括号深度跟踪，深度 < 0 时停。
 */
function findFragmentEnd(sql: string, fromIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  for (let i = fromIndex; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // 处理 '' 转义
      if (inSingleQuote && sql[i + 1] === "'") { i++; continue; }
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) return i; // 遇到所属 CTE 的闭合括号
      depth--;
    }
  }
  return sql.length;
}

/**
 * 允许在权限过滤条件中使用的字段名白名单
 */
const ALLOWED_PERMISSION_FIELDS = new Set([
  'org_level_3',
  'org_level_2',
  'org_level_1',
  'salesman_name',
  'organization',
]);

/**
 * 验证权限过滤条件格式（白名单方式，防止注入）
 *
 * 只允许以下格式（及其 AND/OR 组合）：
 * - field_name LIKE '%value%'
 * - field_name = 'value'
 * - field_name IN ('v1', 'v2', ...)
 *
 * @param filter - 权限过滤条件
 * @returns 是否有效
 */
export function isValidPermissionFilter(filter: string): boolean {
  // 空或默认值是有效的
  if (!filter || filter === '1=1') {
    return true;
  }

  // 长度限制（权限过滤不应太长）
  if (filter.length > 500) {
    return false;
  }

  // 禁止危险字符和模式（第一道防线）
  const dangerousPatterns = [
    /;/,               // 语句终止符
    /--/,              // 单行注释
    /\/\*/,            // 多行注释
    /\bunion\b/i,      // UNION 注入
    /\bselect\b/i,     // 子查询
    /\bdrop\b/i,
    /\bdelete\b/i,
    /\bupdate\b/i,
    /\binsert\b/i,
    /\bcreate\b/i,
    /\balter\b/i,
    /\bexec\b/i,
    /\bexecute\b/i,
    /\bxp_/i,
    /\binto\b/i,
    /\bcopy\b/i,
    /\bload\b/i,
    /\bimport\b/i,
    /\bpragma\b/i,
    /\bcall\b/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(filter)) {
      return false;
    }
  }

  // 白名单校验：提取所有标识符并检查是否在允许列表中
  // 将 filter 按 AND/OR 分割为子条件，逐个校验格式
  const conditions = filter.split(/\b(?:AND|OR)\b/i);

  for (const cond of conditions) {
    const trimmed = cond.trim();
    if (!trimmed) continue;

    // 允许的格式：
    // 1. field LIKE '%value%'
    // 2. field = 'value'
    // 3. field IN ('v1', 'v2', ...)
    const likePattern = /^(\w+)\s+LIKE\s+'[^']*'(?:\s+ESCAPE\s+'[^']*')?$/i;
    const eqPattern = /^(\w+)\s*=\s*'[^']*'$/i;
    const inPattern = /^(\w+)\s+IN\s*\(\s*(?:'[^']*'(?:\s*,\s*'[^']*')*)\s*\)$/i;

    let fieldName: string | null = null;

    const likeMatch = trimmed.match(likePattern);
    const eqMatch = trimmed.match(eqPattern);
    const inMatch = trimmed.match(inPattern);

    if (likeMatch) {
      fieldName = likeMatch[1];
    } else if (eqMatch) {
      fieldName = eqMatch[1];
    } else if (inMatch) {
      fieldName = inMatch[1];
    } else {
      // 不匹配任何允许的格式
      return false;
    }

    // 检查字段名是否在白名单中
    if (!ALLOWED_PERMISSION_FIELDS.has(fieldName.toLowerCase())) {
      return false;
    }
  }

  return true;
}
