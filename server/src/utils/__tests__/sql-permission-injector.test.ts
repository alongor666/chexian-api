/**
 * 单元测试：injectPermissionIntoAnySql（CTE 兼容版）
 *
 * RLS 绕过是 P0 风险，必须覆盖：
 *   - 非 CTE 简单查询（委托给现有 injectPermissionFilter）
 *   - CTE + 无 WHERE
 *   - CTE + 有 WHERE
 *   - 多个 CTE 引用 PolicyFact
 *   - 1=1 透传（branch_admin 角色）
 */
import { describe, it, expect } from 'vitest';
import {
  injectPermissionIntoAnySql,
  injectPermissionFilter,
} from '../sql-permission-injector.js';

const PF = "org_level_3 = '乐山'";

describe('injectPermissionIntoAnySql', () => {
  it('1=1 透传 — branch_admin 不修改 SQL', () => {
    const sql = 'SELECT SUM(premium) FROM PolicyFact';
    expect(injectPermissionIntoAnySql(sql, '1=1')).toBe(sql);
    expect(injectPermissionIntoAnySql(sql, '')).toBe(sql);
  });

  it('非 CTE 简单查询 — 注入 WHERE', () => {
    const sql = 'SELECT SUM(premium) FROM PolicyFact';
    const out = injectPermissionIntoAnySql(sql, PF);
    expect(out).toMatch(/WHERE\s+org_level_3\s*=\s*'乐山'/);
  });

  it('非 CTE + 已有 WHERE — 用 AND 拼接', () => {
    const sql = "SELECT SUM(premium) FROM PolicyFact WHERE policy_date >= '2026-01-01' GROUP BY org_level_3";
    const out = injectPermissionIntoAnySql(sql, PF);
    expect(out).toMatch(/AND\s+\(org_level_3\s*=\s*'乐山'\)/);
    expect(out).toContain('GROUP BY org_level_3');
  });

  it('非 CTE 行为应与现有 injectPermissionFilter 一致', () => {
    const sql = 'SELECT SUM(premium) FROM PolicyFact GROUP BY org_level_3';
    expect(injectPermissionIntoAnySql(sql, PF)).toBe(injectPermissionFilter(sql, PF));
  });

  it('CTE + CTE 内无 WHERE — 在 CTE 内 FROM PolicyFact 后注入 WHERE', () => {
    const sql = 'WITH base AS (SELECT * FROM PolicyFact) SELECT COUNT(*) FROM base';
    const out = injectPermissionIntoAnySql(sql, PF);
    expect(out).toMatch(/FROM\s+PolicyFact\s+WHERE\s+org_level_3\s*=\s*'乐山'/i);
  });

  it('CTE + CTE 内有 WHERE — 用 AND 拼接 permission filter', () => {
    const sql =
      "WITH base AS (SELECT * FROM PolicyFact WHERE policy_date >= '2026-01-01') SELECT SUM(premium) FROM base";
    const out = injectPermissionIntoAnySql(sql, PF);
    expect(out).toMatch(/policy_date\s*>=\s*'2026-01-01'/);
    expect(out).toMatch(/AND\s+\(org_level_3\s*=\s*'乐山'\)/);
  });

  it('多个 CTE 引用 PolicyFact — 每个 FROM PolicyFact 都注入', () => {
    const sql =
      'WITH a AS (SELECT * FROM PolicyFact), b AS (SELECT premium FROM PolicyFact) SELECT * FROM a, b';
    const out = injectPermissionIntoAnySql(sql, PF);
    const matches = out.match(/WHERE\s+org_level_3\s*=\s*'乐山'/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });

  it('CTE 中引用其它 CTE 别名（FROM <cte_alias>）— 不注入', () => {
    // CTE 内只有一个直接读 PolicyFact，主查询读 base 别名
    const sql = 'WITH base AS (SELECT * FROM PolicyFact) SELECT SUM(premium) FROM base GROUP BY 1';
    const out = injectPermissionIntoAnySql(sql, PF);
    // CTE 内有 WHERE
    expect(out).toMatch(/FROM\s+PolicyFact\s+WHERE\s+org_level_3\s*=\s*'乐山'/i);
    // 主查询的 FROM base 不被改动
    expect(out).toMatch(/FROM\s+base\s+GROUP\s+BY/i);
  });

  it('原 injectPermissionFilter 仍 throw on CTE（保留旧契约）', () => {
    const sql = 'WITH base AS (SELECT * FROM PolicyFact) SELECT * FROM base';
    expect(() => injectPermissionFilter(sql, PF)).toThrow(/CTE/);
  });
});
