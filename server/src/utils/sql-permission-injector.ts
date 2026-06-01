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
 * 不可作为表别名的 SQL 关键字 —— 用于区分 `FROM PolicyFact p`（p 是别名）
 * 与 `FROM PolicyFact WHERE ...`（WHERE 是子句关键字，不是别名）。
 */
const NON_ALIAS_KEYWORDS = new Set([
  'WHERE', 'GROUP', 'ORDER', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL',
  'CROSS', 'ON', 'USING', 'LIMIT', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT',
  'QUALIFY', 'WINDOW', 'LATERAL', 'OFFSET', 'FETCH', 'AS', 'NATURAL', 'ASOF',
  'POSITIONAL', 'ANTI', 'SEMI', 'TABLESAMPLE', 'PIVOT', 'UNPIVOT',
]);

/**
 * CTE / 子查询安全的权限注入（RLS 强制）。
 *
 * 策略：把每个直接读取 PolicyFact 的位置 `FROM/JOIN/逗号连接 PolicyFact [alias]`
 * 替换为 **过滤内联视图**：
 *
 *   FROM PolicyFact            →  FROM (SELECT * FROM PolicyFact WHERE <filter>) AS PolicyFact
 *   FROM PolicyFact p          →  FROM (SELECT * FROM PolicyFact WHERE <filter>) AS p
 *   JOIN PolicyFact q          →  JOIN (SELECT * FROM PolicyFact WHERE <filter>) AS q
 *   FROM a, PolicyFact b       →  FROM a, (SELECT * FROM PolicyFact WHERE <filter>) AS b
 *
 * 相比旧实现（在外层查询里找位置插 WHERE），此法对每个 PolicyFact 读取点
 * 都独立、就地强制行级过滤——无论它出现在主查询、SELECT 列表/WHERE 中的标量
 * 子查询、JOIN/逗号连接的第 2+ 个引用、CTE 体，还是窗口函数上下文。彻底杜绝
 * "子查询 / 第二个 JOIN 引用读全量"的 RLS 绕过。
 *
 * 引用其它 CTE 别名的 `FROM <cte_alias>` 不受影响（仅匹配字面表名 PolicyFact），
 * 它们的上游 CTE 已经被过滤。`PolicyFact.col` 形式的列引用（紧跟 `.`）不被误改。
 *
 * 单次全局正则替换：String.replace 不回扫替换后文本，故注入文本里新增的
 * `FROM PolicyFact` 不会被二次匹配，无需额外去重。替换后再做 fail-closed 残留
 * 扫描：若仍有未被内联视图包裹的 PolicyFact 关系引用（例如未来出现的怪异语法），
 * 抛错拒绝执行，绝不放行一条可能未过滤的查询。
 *
 * @param sql - 原始用户 SQL（可能含 CTE / 子查询）
 * @param permissionFilter - 权限过滤条件
 * @returns 注入权限后的 SQL
 */
export function injectPermissionIntoAnySql(sql: string, permissionFilter: string): string {
  if (!permissionFilter || permissionFilter === '1=1') {
    return sql;
  }

  // fail-closed 白名单校验：permissionFilter 虽由服务端（permissionMiddleware）生成，
  // 但在拼进 SQL 前再过一道白名单（字段 + 格式），纵深防御任何上游回归/注入。
  if (!isValidPermissionFilter(permissionFilter)) {
    throw new Error('RLS 注入失败：权限过滤条件未通过白名单校验，拒绝执行');
  }

  const filteredView = `(SELECT * FROM PolicyFact WHERE ${permissionFilter})`;
  // 捕获组：(1) 引导关键字（FROM/JOIN/逗号），(2) 可选别名片段（含前导空白），
  // (3) 别名标识符本身。`(?!\s*\.)` 排除 `PolicyFact.col` 列引用（仅匹配关系引用）。
  // JOIN 覆盖 LEFT/RIGHT/INNER/OUTER/CROSS JOIN —— JOIN 永远紧贴表名出现。
  const polRefPattern = /(\bFROM\b|\bJOIN\b|,)\s+PolicyFact\b(?!\s*\.)(\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi;
  let injectedCount = 0;

  const result = sql.replace(
    polRefPattern,
    (
      _full: string,
      lead: string,
      aliasPart: string | undefined,
      aliasName: string | undefined,
    ) => {
      injectedCount++;
      let alias = 'PolicyFact';
      let tail = '';
      if (aliasName && !NON_ALIAS_KEYWORDS.has(aliasName.toUpperCase())) {
        // 真实别名：… PolicyFact p / … PolicyFact AS p
        alias = aliasName;
      } else if (aliasPart) {
        // 紧跟的是子句关键字（WHERE/GROUP/ON/JOIN…）而非别名 → 原样保留
        tail = aliasPart;
      }
      // 保留引导关键字（FROM/JOIN/,），只替换表引用为过滤内联视图
      return `${lead} ${filteredView} AS ${alias}${tail}`;
    },
  );

  if (injectedCount === 0) {
    // fail-closed：validateSQL 已要求 SQL 必须引用 PolicyFact；若仍未匹配到，
    // 说明 SQL 形态异常，拒绝执行而非放行一条未注入权限的查询。
    throw new Error('RLS 注入失败：未能定位 PolicyFact 引用，拒绝执行');
  }

  // fail-closed 残留扫描：剥离所有已注入的过滤视图后，若仍有"关系位置"的
  // PolicyFact 引用（FROM/JOIN/逗号 紧跟 PolicyFact）说明有读取点漏过滤 → 拒绝执行。
  // 注意只查关系位置：被注入的派生表别名 `AS PolicyFact`（无原始别名时）与列引用
  // `PolicyFact.col` 都不在此模式内，不会误报。
  const stripped = result.split(filteredView).join('');
  if (/(\bFROM\b|\bJOIN\b|,)\s+PolicyFact\b/i.test(stripped)) {
    throw new Error('RLS 注入失败：检测到未被行级过滤覆盖的 PolicyFact 关系引用，拒绝执行');
  }
  return result;
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
  // 电销 dataScope 过滤器 `is_telemarketing = true`（middleware/permission.ts:64）
  'is_telemarketing',
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

    // 允许的格式（字符串值用 '...'，内部单引号以 '' 转义）：
    // 1. field LIKE '%value%'
    // 2. field = 'value'
    // 3. field IN ('v1', 'v2', ...)
    // 4. field = true | false   （布尔字面量，如电销 is_telemarketing = true）
    const STR = "'(?:[^']|'')*'"; // 单引号字符串，兼容 '' 转义（escapeSqlString 产物）
    const likePattern = new RegExp(`^(\\w+)\\s+LIKE\\s+${STR}(?:\\s+ESCAPE\\s+${STR})?$`, 'i');
    const eqPattern = new RegExp(`^(\\w+)\\s*=\\s*${STR}$`, 'i');
    const inPattern = new RegExp(`^(\\w+)\\s+IN\\s*\\(\\s*(?:${STR}(?:\\s*,\\s*${STR})*)\\s*\\)$`, 'i');
    const boolPattern = /^(\w+)\s*=\s*(?:true|false)$/i;

    let fieldName: string | null = null;

    const likeMatch = trimmed.match(likePattern);
    const eqMatch = trimmed.match(eqPattern);
    const inMatch = trimmed.match(inPattern);
    const boolMatch = trimmed.match(boolPattern);

    if (likeMatch) {
      fieldName = likeMatch[1];
    } else if (eqMatch) {
      fieldName = eqMatch[1];
    } else if (inMatch) {
      fieldName = inMatch[1];
    } else if (boolMatch) {
      fieldName = boolMatch[1];
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
