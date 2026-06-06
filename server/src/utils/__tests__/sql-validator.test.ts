/**
 * server sql-validator.ts 专属单元测试（B332 phase-1 安全闸门覆盖补强）
 *
 * 范围：server 端 `server/src/utils/sql-validator.ts`（AI/NL2SQL passthrough 的准入闸门，
 * 校验不可信 LLM 生成 SQL）。**刻意不重复** `sql-passthrough-validation.test.ts` 已覆盖的
 * 注入链子集（合法聚合通过 / 非聚合拒绝 / DDL 拒绝 / 裸 policy_no 拒绝 / 文件函数拒绝 / 超长拒绝 /
 * CTE 通过）。本文件补齐其未覆盖的高价值面：
 *   - 多语句分号注入（主注入向量）
 *   - 字符串字面量 / 注释内的禁用关键词不误判（maskStringLiterals + removeSqlComments 防御）
 *   - GROUP BY / ORDER BY policy_no 隐私保护
 *   - isReadOnlyQuery / hasAggregation 直测
 *   - analyzePerformance（LIMIT/JOIN/子查询/CTE/复杂度上限/各类建议）
 *   - validateSQLWithPerformance（非法短路 + 合法附性能）
 *
 * 注意：本文件测的是 server 版；`tests/sql-validator.test.ts` 与
 * `src/shared/utils/__tests__/sql-validator.test.ts` 测的是 `src/shared` 前端版，不同实现。
 */
import { describe, expect, it } from 'vitest';
import {
  validateSQL,
  isReadOnlyQuery,
  hasAggregation,
  analyzePerformance,
  validateSQLWithPerformance,
  MAX_SQL_LENGTH,
} from '../sql-validator.js';

const VALID_BASE = 'SELECT SUM(premium) FROM PolicyFact';

describe('validateSQL — 多语句分号注入（主注入向量）', () => {
  it('中段分号拼接第二语句 → 拒绝（禁止多语句）', () => {
    const r = validateSQL('SELECT SUM(premium) FROM PolicyFact; DROP TABLE PolicyFact');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('多语句');
  });

  it('双分号 → 拒绝', () => {
    const r = validateSQL('SELECT SUM(premium) FROM PolicyFact;;');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('多语句');
  });

  it('仅末尾单分号 → 允许（合法收尾）', () => {
    expect(validateSQL('SELECT SUM(premium) FROM PolicyFact;').valid).toBe(true);
  });

  it('空 SQL → 拒绝（不能为空）', () => {
    const r = validateSQL('   ');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('不能为空');
  });

  it('超过 MAX_SQL_LENGTH → 拒绝（trim 后仍超长，非空白填充）', () => {
    const padded = `SELECT SUM(premium) FROM PolicyFact WHERE ch = '${'a'.repeat(MAX_SQL_LENGTH)}'`;
    expect(padded.trim().length).toBeGreaterThan(MAX_SQL_LENGTH);
    const r = validateSQL(padded);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('长度');
  });
});

describe('validateSQL — 黑名单 / 访问边界', () => {
  it('WITH 前缀 + 中段 DELETE → 黑名单拒绝', () => {
    const r = validateSQL('WITH evil AS (SELECT 1) DELETE FROM PolicyFact');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('DELETE');
  });

  it('访问 raw_parquet → 拒绝（访问边界）', () => {
    const r = validateSQL('SELECT SUM(x) FROM raw_parquet');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('边界');
  });

  it('访问非 PolicyFact 表 → 拒绝', () => {
    const r = validateSQL('SELECT SUM(x) FROM secret_table');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('边界');
  });

  it('完全不引用 PolicyFact → 拒绝', () => {
    const r = validateSQL('SELECT SUM(1)');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('PolicyFact');
  });
});

describe('validateSQL — 绕过防御（masking 不误判合法查询）', () => {
  it('字符串字面量内的 DROP 不触发黑名单 → 允许', () => {
    // channel 取值恰为 'DROP'，masking 后应不被当作 DDL
    const r = validateSQL("SELECT SUM(premium) FROM PolicyFact WHERE channel = 'DROP'");
    expect(r.valid).toBe(true);
  });

  it('行注释内的 DROP TABLE 不触发黑名单 → 允许', () => {
    const r = validateSQL('SELECT SUM(premium) FROM PolicyFact -- TODO: DROP TABLE old');
    expect(r.valid).toBe(true);
  });

  it('块注释内的 INSERT 不触发黑名单 → 允许', () => {
    const r = validateSQL('SELECT SUM(premium) FROM PolicyFact /* INSERT INTO x */ WHERE 1=1');
    expect(r.valid).toBe(true);
  });
});

describe('validateSQL — 隐私保护 policy_no', () => {
  it('COUNT(policy_no) 计数 → 允许', () => {
    expect(validateSQL('SELECT COUNT(policy_no) FROM PolicyFact').valid).toBe(true);
  });

  it('GROUP BY policy_no → 拒绝（隐私）', () => {
    const r = validateSQL('SELECT COUNT(policy_no) FROM PolicyFact GROUP BY policy_no');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('隐私');
  });

  it('ORDER BY policy_no → 拒绝（隐私）', () => {
    const r = validateSQL('SELECT COUNT(policy_no) FROM PolicyFact ORDER BY policy_no');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('隐私');
  });
});

describe('isReadOnlyQuery', () => {
  it('SELECT 开头 → true', () => {
    expect(isReadOnlyQuery(VALID_BASE)).toBe(true);
  });

  it('WITH 开头 → true', () => {
    expect(isReadOnlyQuery('WITH a AS (SELECT 1) SELECT * FROM a')).toBe(true);
  });

  it('DELETE 开头 → false', () => {
    expect(isReadOnlyQuery('DELETE FROM PolicyFact')).toBe(false);
  });

  it('UPDATE 开头 → false', () => {
    expect(isReadOnlyQuery('UPDATE PolicyFact SET x = 1')).toBe(false);
  });

  it('SELECT 开头但含写入关键词 → false', () => {
    expect(isReadOnlyQuery('SELECT * FROM PolicyFact WHERE x = 1 INSERT')).toBe(false);
  });
});

describe('hasAggregation', () => {
  it('含聚合函数 SUM → true', () => {
    expect(hasAggregation('SELECT SUM(premium) FROM PolicyFact')).toBe(true);
  });

  it('含 GROUP BY → true', () => {
    expect(hasAggregation('SELECT channel FROM PolicyFact GROUP BY channel')).toBe(true);
  });

  it('纯明细 SELECT → false', () => {
    expect(hasAggregation('SELECT premium FROM PolicyFact')).toBe(false);
  });
});

describe('analyzePerformance', () => {
  it('缺 LIMIT → missingLimit=true + 建议 + 分数累加', () => {
    const p = analyzePerformance('SELECT SUM(premium) FROM PolicyFact');
    expect(p.missingLimit).toBe(true);
    expect(p.suggestions.some((s) => s.includes('LIMIT'))).toBe(true);
    expect(p.complexityScore).toBeGreaterThanOrEqual(20);
  });

  it('有 LIMIT → missingLimit=false', () => {
    const p = analyzePerformance('SELECT SUM(premium) FROM PolicyFact LIMIT 10');
    expect(p.missingLimit).toBe(false);
  });

  it('统计 JOIN 数量', () => {
    const p = analyzePerformance(
      'SELECT SUM(p.premium) FROM PolicyFact p JOIN a ON 1=1 LEFT JOIN b ON 1=1 LIMIT 10'
    );
    expect(p.hasJoins).toBe(true);
    expect(p.joinCount).toBe(2);
  });

  it('统计子查询与 CTE 数量', () => {
    const p = analyzePerformance(
      'WITH t AS (SELECT SUM(x) AS s FROM PolicyFact) SELECT s FROM t WHERE s > (SELECT AVG(x) FROM PolicyFact)'
    );
    expect(p.hasCTE).toBe(true);
    expect(p.cteCount).toBeGreaterThanOrEqual(1);
    expect(p.hasSubqueries).toBe(true);
    expect(p.subqueryCount).toBeGreaterThanOrEqual(1);
  });

  it('复杂度分数封顶 100', () => {
    const manyJoins = `SELECT SUM(p.x) FROM PolicyFact p ${'JOIN t ON 1=1 '.repeat(11)}`;
    const p = analyzePerformance(manyJoins);
    expect(p.joinCount).toBe(11);
    expect(p.complexityScore).toBeLessThanOrEqual(100);
    expect(p.complexityScore).toBe(100);
  });

  it('UNION / 窗口函数 / 前导通配符 LIKE 各产生建议', () => {
    const union = analyzePerformance('SELECT SUM(a) FROM PolicyFact UNION SELECT SUM(b) FROM PolicyFact');
    expect(union.suggestions.some((s) => s.includes('UNION'))).toBe(true);

    const win = analyzePerformance('SELECT SUM(x) OVER (PARTITION BY ch) FROM PolicyFact');
    expect(win.suggestions.some((s) => s.includes('窗口'))).toBe(true);

    const like = analyzePerformance("SELECT SUM(x) FROM PolicyFact WHERE ch LIKE '%abc'");
    expect(like.suggestions.some((s) => s.includes('通配符'))).toBe(true);
  });
});

describe('validateSQLWithPerformance', () => {
  it('非法 SQL → 短路返回，不带 performance', () => {
    const r = validateSQLWithPerformance('DELETE FROM PolicyFact');
    expect(r.valid).toBe(false);
    expect(r.performance).toBeUndefined();
  });

  it('合法 SQL → 附带 performance 分析', () => {
    const r = validateSQLWithPerformance(VALID_BASE);
    expect(r.valid).toBe(true);
    expect(r.performance).toBeDefined();
    expect(r.performance?.missingLimit).toBe(true);
  });
});
