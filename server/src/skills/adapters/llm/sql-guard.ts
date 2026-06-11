/**
 * SQL Guard — 阶段 3
 *
 * 拦截 LLM 输出中的疑似 SQL 关键字。如果命中，把整段替换为占位符并返回 blocked=true。
 *
 * 实现策略：词边界匹配（避免误伤"select 一个机构"这种中文上下文里的英文词）。
 * 命中任意 sql 关键字 + 紧跟着的标点/空白即认为是 SQL 输出。
 */

const SQL_KEYWORDS = [
  // 标准 SQL DML/DDL/DCL
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'WITH', // CTE
  'UNION',
  'JOIN',
  'EXEC',
  'EXECUTE',
  'GRANT',
  'REVOKE',
  // DuckDB 方言：数据外泄 / 外部库挂载 / 扩展加载 / 元数据探查（高危，自然语言罕见紧跟标识符）
  'COPY', // COPY ... TO 可把数据导出到文件
  'EXPORT', // EXPORT DATABASE 整库导出
  'ATTACH', // ATTACH 挂载外部 DB
  'DETACH',
  'INSTALL', // INSTALL/LOAD 加载任意扩展
  'LOAD',
  'PRAGMA', // 元数据/配置探查
  'DESCRIBE', // schema 泄漏
  'SUMMARIZE',
  'PIVOT',
  'UNPIVOT',
  'CALL', // 调用内建/扩展函数
] as const;

const FORBIDDEN_PATTERN = new RegExp(
  `\\b(${SQL_KEYWORDS.join('|')})\\b\\s+[\\w*"'\\(]`,
  'i'
);

/** 单独检测 ```sql ... ``` code-fence */
const SQL_CODE_FENCE_PATTERN = /```\s*sql\b/i;

export interface SqlGuardResult {
  blocked: boolean;
  matchedKeyword?: string;
}

export function inspectForSql(text: string): SqlGuardResult {
  if (SQL_CODE_FENCE_PATTERN.test(text)) {
    return { blocked: true, matchedKeyword: 'sql-code-fence' };
  }
  const m = FORBIDDEN_PATTERN.exec(text);
  if (m) {
    return { blocked: true, matchedKeyword: m[1].toUpperCase() };
  }
  return { blocked: false };
}

export function blockedFallbackText(matched: string): string {
  return `[LLM 输出被 sql-guard 拦截：检测到关键字「${matched}」，已替换为占位文本。请在确定性报告中查看原始数据。]`;
}
