/**
 * SQL 直通端点的核心校验链：validateSQL → injectPermissionIntoAnySql。
 *
 * 实际路由 handler 的端到端测试由 curl smoke test 覆盖；
 * 此处验证两个纯函数组合的不变量，避免实际启动 DuckDB。
 */
import { describe, expect, it } from 'vitest';
import { validateSQL } from '../sql-validator.js';
import { injectPermissionIntoAnySql } from '../sql-permission-injector.js';

const PF = "org_level_3 = '乐山'";

describe('sql passthrough validation chain', () => {
  it('合法聚合查询通过 validateSQL，并被 RLS 注入', () => {
    const sql = 'SELECT customer_category, SUM(premium) AS p FROM PolicyFact GROUP BY 1';
    const v = validateSQL(sql);
    expect(v.valid).toBe(true);
    const safe = injectPermissionIntoAnySql(sql, PF);
    expect(safe).toMatch(/org_level_3\s*=\s*'乐山'/);
  });

  it('非聚合查询被拒绝（聚合要求）', () => {
    const v = validateSQL('SELECT * FROM PolicyFact LIMIT 10');
    expect(v.valid).toBe(false);
    expect(v.error).toMatch(/聚合/);
  });

  it('DDL（CREATE TABLE）被拒绝', () => {
    const v = validateSQL('CREATE TABLE foo AS SELECT * FROM PolicyFact');
    expect(v.valid).toBe(false);
  });

  it('裸 policy_no 被拒绝（隐私）', () => {
    const v = validateSQL('SELECT policy_no, SUM(premium) FROM PolicyFact GROUP BY 1');
    expect(v.valid).toBe(false);
    expect(v.error).toMatch(/policy_no/);
  });

  it('COUNT(DISTINCT policy_no) 允许（聚合内）', () => {
    const v = validateSQL('SELECT COUNT(DISTINCT policy_no) FROM PolicyFact');
    expect(v.valid).toBe(true);
  });

  it('注释中的 PolicyFact 不满足访问边界要求', () => {
    const v = validateSQL('WITH x AS (SELECT 1) SELECT COUNT(*) FROM ApiToken -- PolicyFact');
    expect(v.valid).toBe(false);
    expect(v.error).toMatch(/访问边界/);
  });

  it('拒绝会泄漏 policy_no 明细值的聚合函数', () => {
    for (const sql of [
      "SELECT STRING_AGG(policy_no, ',') AS policies FROM PolicyFact GROUP BY org_level_3",
      'SELECT ARRAY_AGG(policy_no) AS policies FROM PolicyFact GROUP BY org_level_3',
      'SELECT MIN(policy_no) AS one_policy FROM PolicyFact GROUP BY org_level_3',
      'SELECT MAX(policy_no) AS one_policy FROM PolicyFact GROUP BY org_level_3',
    ]) {
      const v = validateSQL(sql);
      expect(v.valid).toBe(false);
      expect(v.error).toMatch(/policy_no/);
    }
  });

  it('不引用 PolicyFact 被拒绝', () => {
    const v = validateSQL('SELECT 1 AS x');
    expect(v.valid).toBe(false);
  });

  it('CTE 查询通过 validateSQL 并被 injectPermissionIntoAnySql 安全注入', () => {
    const sql =
      'WITH base AS (SELECT week_number, premium FROM PolicyFact WHERE week_number = 1) ' +
      'SELECT week_number, SUM(premium) p FROM base GROUP BY 1';
    const v = validateSQL(sql);
    expect(v.valid).toBe(true);
    const safe = injectPermissionIntoAnySql(sql, PF);
    expect(safe).toMatch(/AND\s+\(org_level_3\s*=\s*'乐山'\)/);
  });

  it('文件函数被拒绝', () => {
    const v = validateSQL("SELECT * FROM read_parquet('/tmp/foo.parquet')");
    expect(v.valid).toBe(false);
  });

  it('超长 SQL 被拒绝', () => {
    const padding = 'x'.repeat(9000);
    const v = validateSQL(`SELECT SUM(premium) FROM PolicyFact -- ${padding}`);
    expect(v.valid).toBe(false);
    expect(v.error).toMatch(/长度/);
  });
});
