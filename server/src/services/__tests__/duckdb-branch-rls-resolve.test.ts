/**
 * resolveBranchRlsCode 双门控集成测试（ADR G4 查询期收口）。
 *
 * 被测：routes/query/shared.ts resolveBranchRlsCode —— 决定 typed 路由是否对
 * achievement_cache / SalesmanTeamMapping / RepairDim 注入 `branch_code='XX'` 分省过滤。
 *
 * 双门控（两者皆成立才返回 branchCode）：
 *   - gate a：req.permissionFilter 含 `branch_code='XX'`（⟺ BRANCH_RLS_ENABLED 且用户有 branchCode）
 *   - gate b：目标关系实测含 branch_code 列（⟺ GATED 多省加载已激活）
 *
 * 🔴 安全核心：gate b 免疫 T-3 中间态（RLS-on + 单省关系无 branch_code 列）——返回 undefined →
 * 路由不注入 → 不 Binder Error、SC 全量=零差异。需 DuckDB 原生二进制（duckdb-* → test:integration）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Request } from 'express';
import { duckdbService } from '../duckdb.js';
import { resolveBranchRlsCode } from '../../routes/query/shared.js';

const reqWith = (permissionFilter?: string): Request => ({ permissionFilter } as unknown as Request);

describe('resolveBranchRlsCode 双门控（ADR G4）', () => {
  beforeAll(async () => {
    await duckdbService.init();
    // 多省关系（含 branch_code 列）
    await duckdbService.query(`
      CREATE OR REPLACE TABLE rls_multi AS
      SELECT * FROM (VALUES ('SC', 1), ('SX', 2)) AS t(branch_code, v)
    `);
    // 单省关系（无 branch_code 列，模拟 T-3 中间态）
    await duckdbService.query(`
      CREATE OR REPLACE TABLE rls_single AS SELECT 1 AS v
    `);
  });

  afterAll(async () => {
    try { await duckdbService.close(); } catch { /* ignore */ }
  });

  it('gate a 失败：permissionFilter 无 branch_code（flag off / 1=1）→ undefined', async () => {
    expect(await resolveBranchRlsCode(reqWith('1=1'), 'rls_multi')).toBeUndefined();
    expect(await resolveBranchRlsCode(reqWith("org_level_3 = '乐山'"), 'rls_multi')).toBeUndefined();
  });

  it('gate a 失败：permissionFilter undefined（无中间件/系统超管）→ undefined', async () => {
    expect(await resolveBranchRlsCode(reqWith(undefined), 'rls_multi')).toBeUndefined();
  });

  it('🔴 gate b 失败：RLS-on 但关系无 branch_code 列（T-3 中间态）→ undefined（免 Binder Error）', async () => {
    expect(await resolveBranchRlsCode(reqWith("branch_code = 'SX'"), 'rls_single')).toBeUndefined();
    // 关系不存在亦安全降级（information_schema 返回 0 行，不抛错）
    expect(await resolveBranchRlsCode(reqWith("branch_code = 'SX'"), 'rls_absent')).toBeUndefined();
  });

  it('双门通过：RLS-on（branch_admin）+ 关系含 branch_code 列 → 返回省码', async () => {
    expect(await resolveBranchRlsCode(reqWith("branch_code = 'SX'"), 'rls_multi')).toBe('SX');
  });

  it('双门通过：org_user 复合过滤（org_level_3 AND branch_code）→ 提取 branch 段', async () => {
    expect(
      await resolveBranchRlsCode(reqWith("(org_level_3 = '乐山') AND branch_code = 'SC'"), 'rls_multi'),
    ).toBe('SC');
  });
});
