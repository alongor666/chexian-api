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

  it('非 CTE + 已有 WHERE — 过滤内联视图 + 保留原 WHERE', () => {
    const sql = "SELECT SUM(premium) FROM PolicyFact WHERE policy_date >= '2026-01-01' GROUP BY org_level_3";
    const out = injectPermissionIntoAnySql(sql, PF);
    // 权限过滤进入内联视图
    expect(out).toMatch(/FROM\s+\(SELECT\s+\*\s+FROM\s+PolicyFact\s+WHERE\s+org_level_3\s*=\s*'乐山'\)\s+AS\s+PolicyFact/i);
    // 用户原有 WHERE 完整保留
    expect(out).toMatch(/policy_date\s*>=\s*'2026-01-01'/);
    expect(out).toContain('GROUP BY org_level_3');
  });

  it('保留表别名 — FROM PolicyFact p / FROM PolicyFact AS p', () => {
    const out1 = injectPermissionIntoAnySql('SELECT p.premium FROM PolicyFact p', PF);
    expect(out1).toMatch(/FROM\s+\(SELECT\s+\*\s+FROM\s+PolicyFact\s+WHERE\s+org_level_3\s*=\s*'乐山'\)\s+AS\s+p\b/i);
    const out2 = injectPermissionIntoAnySql('SELECT p.premium FROM PolicyFact AS p', PF);
    expect(out2).toMatch(/FROM\s+\(SELECT\s+\*\s+FROM\s+PolicyFact\s+WHERE\s+org_level_3\s*=\s*'乐山'\)\s+AS\s+p\b/i);
  });

  it('RLS 子查询绕过回归 — SELECT 列表中的标量子查询也被过滤', () => {
    // 修复前：仅最外层 FROM 被注入 WHERE，内层 (SELECT ... FROM PolicyFact) 读全量 → 越权
    const sql =
      "SELECT SUM(premium) AS t, (SELECT SUM(premium) FROM PolicyFact) AS all_orgs FROM PolicyFact GROUP BY org_level_3";
    const out = injectPermissionIntoAnySql(sql, PF);
    // 两处 PolicyFact 读取点都必须被过滤
    const filterOccurrences = (out.match(/org_level_3\s*=\s*'乐山'/g) ?? []).length;
    expect(filterOccurrences).toBe(2);
    // 原始未过滤的裸 FROM PolicyFact 不应再以"非内联视图"形式存在
    expect(out).not.toMatch(/\(SELECT\s+SUM\(premium\)\s+FROM\s+PolicyFact\)\s+AS\s+all_orgs/i);
  });

  it('RLS 子查询绕过回归 — WHERE 中的 IN 子查询也被过滤', () => {
    const sql =
      "SELECT SUM(premium) FROM PolicyFact WHERE policy_no IN (SELECT policy_no FROM PolicyFact)";
    const out = injectPermissionIntoAnySql(sql, PF);
    const filterOccurrences = (out.match(/org_level_3\s*=\s*'乐山'/g) ?? []).length;
    expect(filterOccurrences).toBe(2);
  });

  it('CTE + CTE 内无 WHERE — 在 CTE 内 FROM PolicyFact 后注入 WHERE', () => {
    const sql = 'WITH base AS (SELECT * FROM PolicyFact) SELECT COUNT(*) FROM base';
    const out = injectPermissionIntoAnySql(sql, PF);
    expect(out).toMatch(/FROM\s+PolicyFact\s+WHERE\s+org_level_3\s*=\s*'乐山'/i);
  });

  it('CTE + CTE 内有 WHERE — 过滤内联视图 + 保留 CTE 内原 WHERE', () => {
    const sql =
      "WITH base AS (SELECT * FROM PolicyFact WHERE policy_date >= '2026-01-01') SELECT SUM(premium) FROM base";
    const out = injectPermissionIntoAnySql(sql, PF);
    expect(out).toMatch(/policy_date\s*>=\s*'2026-01-01'/);
    expect(out).toMatch(/FROM\s+\(SELECT\s+\*\s+FROM\s+PolicyFact\s+WHERE\s+org_level_3\s*=\s*'乐山'\)\s+AS\s+PolicyFact/i);
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

  it('CTE 内嵌套子查询 JOIN — 内外两处 PolicyFact 读取都被过滤', () => {
    // 过滤内联视图法：JOIN 子查询里的 FROM PolicyFact 与外层 FROM PolicyFact
    // 都各自包成 (SELECT * FROM PolicyFact WHERE <filter>)，两处都强制行级过滤，
    // 不存在"内层子查询读全量"的越权窗口。
    const sql =
      'WITH base AS (' +
      'SELECT * FROM PolicyFact JOIN (SELECT id FROM PolicyFact) sub ON PolicyFact.id = sub.id' +
      ') SELECT * FROM base';
    const out = injectPermissionIntoAnySql(sql, PF);
    // 内外两处 PolicyFact 读取点都被过滤
    const filterOccurrences = (out.match(/org_level_3\s*=\s*'乐山'/g) ?? []).length;
    expect(filterOccurrences).toBe(2);
    // 结构完整：主查询部分 FROM base 未被破坏
    expect(out).toMatch(/\)\s*SELECT\s+\*\s+FROM\s+base\s*$/i);
  });
});
