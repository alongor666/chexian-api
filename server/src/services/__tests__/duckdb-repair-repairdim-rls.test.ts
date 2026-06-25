/**
 * repair RepairDim 登记表侧分省 RLS 隔离集成测试（PR-7 · RLS-on 硬前置第二半 · 真 DuckDB）。
 *
 * 被测：repair.ts 影子/孤儿/导流 CTE 的 bare `NOT IN/IN (SELECT FROM RepairDim)` 子查询经
 * repairBranchCode（resolveBranchRlsCode(req,'RepairDim')）下推 branch_code 后的真实隔离。
 *
 * codex 闸-2 发现的缺口（本测试复现 + 证明修复）：PR-6 只过滤 ClaimsDetail（赔案侧），但影子分类
 * 用的 NOT IN RepairDim 子查询跨省全读——SX 赔案网点码若登记在 SC RepairDim，会被误判为「已登记」
 * 而从 SX 孤儿清单漏掉。PR-7 给 bare 子查询下推 branch_code 后，本省视角只参照本省登记表。
 *
 * 关键：repairBranchCode 与 ClaimsDetail 的 branchCode 独立 gate（gate b 在 RepairDim 列存在性）。
 * 本测试造的 RepairDim **含 branch_code 列**（模拟 PR-7 数据物化后态）。
 *
 * 需 DuckDB 原生二进制，归入 bun run test:integration（duckdb-* 自动入 integration / CI exclude）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { duckdbService } from '../duckdb.js';
import {
  generateRepairCoopTierQuery,
  generateRepairOrphanShopsQuery,
  generateRepairDiversionListQuery,
  type RepairFiltersV2,
} from '../../sql/repair.js';

const F: RepairFiltersV2 = {};

describe('repair RepairDim 登记表侧分省 RLS 隔离（PR-7）', () => {
  beforeAll(async () => {
    await duckdbService.init();
    // RepairDim **含 branch_code**（模拟 PR-7 物化后）：SCREG001 是 SC 登记的生效厂。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE RepairDim AS
      SELECT * FROM (VALUES
        ('SCREG001四川登记', '四川机构', '1生效中', false, '川市', '川区', '直营',
         CAST(0 AS DOUBLE), CAST(0 AS DOUBLE), CAST(10000 AS DOUBLE), TIMESTAMP '2026-01-01', '川', 'SC')
      ) AS t(repair_shop_name, org_level_3, cooperation_status, is_4s_shop, city, district,
             channel_type, damage_assessment_amount, parts_discount_rate, net_premium, report_date, province, branch_code)
    `);
    // ClaimsDetail：① SX 赔案撞 SC 登记码 SCREG001（codex 场景）② SX 赔案真孤儿 SXTRUE01。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE ClaimsDetail AS
      SELECT * FROM (VALUES
        ('618晋A', 'C-SX-1', 'SCREG001', 'SCREG001四川登记', '山西区', CAST(3000 AS DOUBLE), TIMESTAMP '2026-01-10', 'SX'),
        ('618晋B', 'C-SX-2', 'SXTRUE01', '山西真影子店', '山西区', CAST(2000 AS DOUBLE), TIMESTAMP '2026-01-10', 'SX')
      ) AS t(policy_no, claim_no, subject_shop_code, subject_repair_shop, accident_district,
             settled_vehicle_amount, accident_time, branch_code)
    `);
    // PolicyFact **无 branch_code 列**（模拟 schema skew：RepairDim 已物化、PolicyFact 未物化）
    // 用于验证 diversion 不再把 RepairDim 的 branch_code 污染进 PolicyFact（codex 闸-2 PR-7 HIGH）。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE PolicyFact AS
      SELECT * FROM (VALUES
        ('618晋A', CAST(8000 AS DOUBLE), '山西机构', '李四', '私家车'),
        ('618晋B', CAST(6000 AS DOUBLE), '山西机构', '王五', '私家车')
      ) AS t(policy_no, premium, org_level_3, salesman_name, customer_category)
    `);
  });

  afterAll(async () => {
    for (const t of ['RepairDim', 'ClaimsDetail', 'PolicyFact']) {
      try { await duckdbService.query(`DROP TABLE IF EXISTS ${t}`); } catch { /* ignore */ }
    }
    try { await duckdbService.close(); } catch { /* ignore */ }
  });

  it('🔴 orphan-shops：repairBranchCode=SX → 撞 SC 登记码的 SX 赔案正确判为本省孤儿（不被 SC 登记表抑制）', async () => {
    // 本省过滤：NOT IN（SX RepairDim=空）→ SCREG001 与 SXTRUE01 对 SX 都是孤儿。
    const rows = await duckdbService.query<{ shop_code: string }>(
      generateRepairOrphanShopsQuery(F, 100, '1=1', 'SX', 'SX'),
    );
    const codes = rows.map((r) => r.shop_code);
    expect(codes).toContain('SCREG001'); // 关键：codex 缺口已修——SC 登记不再抑制 SX 孤儿
    expect(codes).toContain('SXTRUE01');
  });

  it('🔴 对照（证明修复必要）：无 repairBranchCode → SC 登记码抑制 SX 孤儿（codex 复现的缺口）', async () => {
    // bare NOT IN（全 RepairDim 含 SC）→ SCREG001 在 SC 登记表 → 被错误排除出 SX 孤儿。
    const rows = await duckdbService.query<{ shop_code: string }>(
      generateRepairOrphanShopsQuery(F, 100, '1=1', 'SX'),
    );
    const codes = rows.map((r) => r.shop_code);
    expect(codes).not.toContain('SCREG001'); // 缺口：跨省登记表误抑制本省孤儿
    expect(codes).toContain('SXTRUE01');
  });

  it('coop-tier：repairBranchCode=SX → none_shadow 计入撞 SC 码的 SX 赔案（本省视角孤儿）', async () => {
    const rows = await duckdbService.query<{ coop_tier: string; shop_count: number }>(
      generateRepairCoopTierQuery(F, '1=1', 'SX', 'SX'),
    );
    // SX 两个影子网点（SCREG001 本省未登记 + SXTRUE01）
    expect(Number(rows.find((r) => r.coop_tier === 'none_shadow')?.shop_count ?? 0)).toBe(2);
  });

  it('③ RepairDim 含 branch_code 列时注入执行无 Binder Error', async () => {
    // 仅验证带 repairBranchCode 的 SQL 在 RepairDim 有列时可执行。
    const rows = await duckdbService.query<{ shop_code: string }>(
      generateRepairOrphanShopsQuery(F, 100, '1=1', 'SX', 'SX'),
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  it('🔴 diversion skew fail-safe（codex 闸-2 PR-7 HIGH）：RepairDim 有列/PolicyFact 无列 → 不 Binder', async () => {
    // 模拟 schema skew：RepairDim+ClaimsDetail 已物化 branch_code、PolicyFact 未物化。
    // 修复后路由对 diversion 传 org-only whereClause（'1=1'，无 branch_code）+ policyBranchCode=undefined
    // （PolicyFact gate b 不过）→ policy_dedup 不含 branch_code → 不 Binder。repairBranchCode='SX'
    // 仍过滤 RepairDim 子查询。修复前路由传 buildRepairWhere（含 RepairDim branch_code）会污染 PolicyFact 致 Binder。
    const rows = await duckdbService.query<{ subject_shop_code: string }>(
      generateRepairDiversionListQuery(F, 500, 0, '1=1', 'SX', undefined, 'SX'),
    );
    expect(Array.isArray(rows)).toBe(true); // 执行成功，无 Binder Error
    // diversion_claims 经 claimsBranchCode='SX' + repairBranchCode='SX'：两 SX 赔案均 none_shadow
    expect(rows.map((r) => r.subject_shop_code).sort()).toEqual(['SCREG001', 'SXTRUE01']);
  });
});
