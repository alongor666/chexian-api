/**
 * SQL 权限注入工具
 *
 * 安全地将行级权限过滤条件注入到用户 SQL 中
 * 简化实现，处理常见场景
 */

import {
  getInjectableRelations,
  relationSupportsFilterColumns,
  isFederationEnabled,
} from '../config/sql-federation-policy.js';

/**
 * m1 fail-closed 不变量（plan 风险表 m1）：permissionMiddleware 必为**每个**已认证请求生成
 * req.permissionFilter（branch_admin='1=1' / org='org_level_3=...' / 电销='is_telemarketing=true'）。
 *
 * 若 permissionFilter 为 `undefined` → 说明权限中间件**未执行**（路由装配回归 / 绕过）= bug，
 * 调用方（sql-passthrough）必须 fail-closed 拒绝，**绝不**退化为 `?? '1=1'` 放行全表
 * （federation 下 = 跨机构越权泄漏面）。
 *
 * 关键区分：`'1=1'` 是 branch_admin 的**合法**值（injectPermissionIntoAnySql 短路放行），不算缺失；
 * 只有 `undefined` 才是「中间件没跑」。类型守卫使调用方 throw 后 permissionFilter 收窄为 string。
 */
export function isPermissionFilterMissing(
  permissionFilter: string | undefined,
): permissionFilter is undefined {
  return permissionFilter === undefined;
}

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
/**
 * 构造匹配某关系「关系位置引用」的全局正则（用于包裹替换）。
 * relationName 来自联邦注册表（合法标识符，无正则元字符），可安全内插。
 * 捕获组：(1) 引导关键字（FROM/JOIN/逗号），(2) 可选别名片段，(3) 别名标识符。
 * `(?!\s*\.)` 排除 `Relation.col` 列引用（仅匹配关系引用）。
 */
function relationRefPattern(relationName: string): RegExp {
  return new RegExp(
    `(\\bFROM\\b|\\bJOIN\\b|,)\\s+${relationName}\\b(?!\\s*\\.)(\\s+(?:AS\\s+)?([A-Za-z_]\\w*))?`,
    'gi',
  );
}

/** 非全局版：仅判断某关系是否以关系位置出现在 SQL 中（不推进 lastIndex）。 */
function relationPresenceRegex(relationName: string): RegExp {
  return new RegExp(`(?:\\bFROM\\b|\\bJOIN\\b|,)\\s+${relationName}\\b(?!\\s*\\.)`, 'i');
}

/**
 * 从已通过 isValidPermissionFilter 校验的权限过滤条件中提取被引用列名（小写）。
 * 形如 `field = 'v'` / `field LIKE '%v%'` / `field IN (...)` / `field = true`，以 AND/OR 切分。
 *
 * ⚠️ 安全不变量（勿删依赖）：本函数仅用于注入前的**快速 fail-closed 预检**（判断视图是否声明了
 * 过滤所需列）。**安全下界不依赖其完备性**——`permissionFilter` 始终被**原样**注入 WHERE
 * （wrapRelationRefs），且 DuckDB 要求列存在；故即便此提取遗漏某列，最坏也只是 DuckDB 报错
 * （fail-closed），绝不会越权。这是设计的纵深防御兜底，扩展时不可移除"原样注入 + 列必存在"这一层。
 */
function extractPermissionFilterColumns(filter: string): string[] {
  const cols: string[] = [];
  for (const rawCond of filter.split(/\b(?:AND|OR)\b/i)) {
    let cond = rawCond.trim();
    if (!cond) continue;
    if (cond.startsWith('(') && cond.endsWith(')')) cond = cond.slice(1, -1).trim();
    const m = cond.match(/^(\w+)\s*(?:=|LIKE\b|IN\b)/i);
    if (m) cols.push(m[1].toLowerCase());
  }
  return cols;
}

/**
 * 把 SQL 中某关系的所有「关系位置引用」替换为过滤内联视图。
 * 逻辑与历史 PolicyFact 注入一致，仅把表名参数化。
 */
function wrapRelationRefs(
  sql: string,
  relationName: string,
  permissionFilter: string,
): { sql: string; count: number } {
  const filteredView = `(SELECT * FROM ${relationName} WHERE ${permissionFilter})`;
  let count = 0;
  const out = sql.replace(
    relationRefPattern(relationName),
    (
      _full: string,
      lead: string,
      aliasPart: string | undefined,
      aliasName: string | undefined,
    ) => {
      count++;
      let alias = relationName;
      let tail = '';
      if (aliasName && !NON_ALIAS_KEYWORDS.has(aliasName.toUpperCase())) {
        // 真实别名：… Relation p / … Relation AS p
        alias = aliasName;
      } else if (aliasPart) {
        // 紧跟的是子句关键字（WHERE/GROUP/ON/JOIN…）而非别名 → 原样保留
        tail = aliasPart;
      }
      return `${lead} ${filteredView} AS ${alias}${tail}`;
    },
  );
  return { sql: out, count };
}

/**
 * CTE / 子查询安全的权限注入（RLS 强制，派生域联邦感知）。
 *
 * 对当前开关状态下「需注入行级权限」的每个关系（getInjectableRelations：关闭=仅
 * PolicyFact；开启=PolicyFact + 联邦 direct 视图），把其每个关系位置引用
 * `FROM/JOIN/, <Relation> [alias]` 替换为过滤内联视图：
 *   FROM Relation → FROM (SELECT * FROM Relation WHERE <filter>) AS Relation
 * 对每个读取点独立、就地强制行级过滤，杜绝子查询 / 第 2+ JOIN 引用读全量的绕过。
 *
 * 派生域联邦（SQL_FEDERATION_ENABLED='true'）下，对每个被引用的 direct 关系做 fail-closed：
 * 过滤条件引用的列必须**全部**存在于该关系，否则抛错拒绝执行（绝不静默丢弃过滤——
 * 丢弃 = 跨机构越权泄漏）。exempt 参照表不在 getInjectableRelations 内，放行不注入。
 *
 * 替换后做全局 fail-closed 残留扫描：任一 direct 关系若仍有未被内联视图包裹的关系位置
 * 引用 → 抛错拒绝执行，绝不放行一条可能未过滤的查询。
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

  const filterColumns = extractPermissionFilterColumns(permissionFilter);
  let result = sql;
  let anyDirectRelationPresent = false;

  for (const policy of getInjectableRelations()) {
    if (!relationPresenceRegex(policy.canonical).test(result)) continue;
    anyDirectRelationPresent = true;

    // fail-closed：该关系必须支持过滤条件引用的所有列，否则拒绝（禁止丢弃过滤）
    if (!relationSupportsFilterColumns(policy, filterColumns)) {
      const missing = filterColumns.filter(
        (c) => !policy.permissionColumns.has(c.toLowerCase()),
      );
      throw new Error(
        `RLS 注入失败：${policy.canonical} 缺少权限列 [${missing.join(', ')}]，拒绝执行（fail-closed，禁止丢弃过滤条件）`,
      );
    }

    result = wrapRelationRefs(result, policy.canonical, permissionFilter).sql;
  }

  if (!anyDirectRelationPresent) {
    if (!isFederationEnabled()) {
      // 关闭态：validateSQL 已保证 PolicyFact 存在；走到这里说明 SQL 形态异常 → 拒绝
      throw new Error('RLS 注入失败：未能定位 PolicyFact 引用，拒绝执行');
    }
    // 开启态：查询仅触及 exempt 参照表 / CTE，无机构作用域，放行不注入
    return result;
  }

  // 全局 fail-closed 残留扫描：任一 direct 关系若仍有未被内联视图包裹的关系位置引用 → 拒绝。
  // 被注入的派生表别名 `AS <Relation>` 与列引用 `<Relation>.col` 不在关系位置模式内，不误报。
  for (const policy of getInjectableRelations()) {
    const filteredView = `(SELECT * FROM ${policy.canonical} WHERE ${permissionFilter})`;
    const stripped = result.split(filteredView).join('');
    if (relationPresenceRegex(policy.canonical).test(stripped)) {
      throw new Error(
        `RLS 注入失败：检测到未被行级过滤覆盖的 ${policy.canonical} 关系引用，拒绝执行`,
      );
    }
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
  // 多分公司 RLS（plan v2 0F）：permission.ts 注入 `branch_code = 'SC' | 'SX'`
  'branch_code',
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
    let trimmed = cond.trim();
    if (!trimmed) continue;

    // 容忍一层外层括号（permission.ts 合成 `(baseFilter) AND branch_code='SC'` 时，
    // baseFilter 部分会带括号，例如 `(org_level_3 = '乐山')`）。
    // 多层括号 / 嵌套 AND-OR 不在本 PR 范围（permission.ts 不会生成此类形式）。
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      trimmed = trimmed.slice(1, -1).trim();
    }

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
