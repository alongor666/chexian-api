/**
 * repair 影子网点 CTE 分省 RLS 隔离集成测试（PR-6 · RLS-on 硬前置 · 真 DuckDB）。
 *
 * 被测：repair.ts 5 端点（coop-tier / scatter / local-resource / diversion-list / orphan-shops）
 * 的 ClaimsDetail 影子扫描经 branchCode 下推（claimsBranchAnd / claimsTimeWindow）后的真实隔离。
 * 这些 CTE **不经 PolicyFact JOIN**，无法靠 JOIN 传导 RLS——多源后若不在 ClaimsDetail 扫描处
 * 直接过滤 branch_code，RLS-on + SX 账号激活会跨省串读影子网点（SX 看 SC 赔案 / 反之）。
 *
 * 安全核心（必须验证）：
 *   🔴 branchCode='SX' → 仅见 SX 影子网点 / SX 赔案，**不串读 SC**（关闭泄漏）
 *   🔴 branchCode=undefined（RLS-off / 单省）→ SC+SX 全见（与历史单省行为一致，证明修复 opt-in）
 *   ② 同码跨省登记厂（local-resource）：本省过滤后仅计本省赔案，防对方省赔案灌入本省网点指标
 *   ③ 全部查询执行无 Binder Error（RepairDim 无 branch_code 列、branch_code 仅在 ClaimsDetail）
 *
 * 需 DuckDB 原生二进制，归入 bun run test:integration（duckdb-* 自动入 integration / CI exclude）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { duckdbService } from '../duckdb.js';
import {
  generateRepairCoopTierQuery,
  generateRepairScatterQuery,
  generateRepairLocalResourceQuery,
  generateRepairDiversionListQuery,
  generateRepairOrphanShopsQuery,
  type RepairFiltersV2,
} from '../../sql/repair.js';

const F: RepairFiltersV2 = {};

describe('repair 影子网点分省 RLS 隔离（PR-6）', () => {
  beforeAll(async () => {
    await duckdbService.init();
    // 登记厂（RepairDim，无 branch_code 列）：REGSHOP1 属测试机构、生效中。
    // 注：SUBSTR('REGSHOP1登记店',1,8)='REGSHOP1'（前 8 字符 ASCII）。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE RepairDim AS
      SELECT * FROM (VALUES
        ('REGSHOP1登记店', '测试机构', '1生效中', false, '本市', '本区', '直营',
         CAST(0 AS DOUBLE), CAST(0 AS DOUBLE), CAST(10000 AS DOUBLE), TIMESTAMP '2026-01-01', '川')
      ) AS t(repair_shop_name, org_level_3, cooperation_status, is_4s_shop, city, district,
             channel_type, damage_assessment_amount, parts_discount_rate, net_premium, report_date, province)
    `);
    // 赔案（ClaimsDetail，含 branch_code）：2 孤儿影子厂（SC/SX 各一，不在 RepairDim）
    // + 2 条登记厂 REGSHOP1 同码跨省赔案（SC/SX 各一，验 local-resource 灌入隔离）。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE ClaimsDetail AS
      SELECT * FROM (VALUES
        ('610川A', 'C-SC-1', 'SCORPH01', '四川影子店', '四川区', CAST(5000 AS DOUBLE), TIMESTAMP '2026-01-10', 'SC'),
        ('618晋B', 'C-SX-1', 'SXORPH01', '山西影子店', '山西区', CAST(3000 AS DOUBLE), TIMESTAMP '2026-01-10', 'SX'),
        ('610川C', 'C-SC-2', 'REGSHOP1', 'REGSHOP1登记店', '本区', CAST(2000 AS DOUBLE), TIMESTAMP '2026-01-11', 'SC'),
        ('618晋D', 'C-SX-2', 'REGSHOP1', 'REGSHOP1登记店', '本区', CAST(1000 AS DOUBLE), TIMESTAMP '2026-01-11', 'SX')
      ) AS t(policy_no, claim_no, subject_shop_code, subject_repair_shop, accident_district,
             settled_vehicle_amount, accident_time, branch_code)
    `);
    // 保单（PolicyFact）：diversion 的 policy_dedup FROM PolicyFact 需存在。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE PolicyFact AS
      SELECT * FROM (VALUES
        ('610川A', CAST(10000 AS DOUBLE), '测试机构', '张三', '私家车', 'SC'),
        ('618晋B', CAST(8000 AS DOUBLE), '测试机构', '李四', '私家车', 'SX')
      ) AS t(policy_no, premium, org_level_3, salesman_name, customer_category, branch_code)
    `);
  });

  afterAll(async () => {
    for (const t of ['RepairDim', 'ClaimsDetail', 'PolicyFact']) {
      try { await duckdbService.query(`DROP TABLE IF EXISTS ${t}`); } catch { /* ignore */ }
    }
    try { await duckdbService.close(); } catch { /* ignore */ }
  });

  it('🔴 orphan-shops：branchCode=SX 仅见 SX 影子厂，不串读 SC', async () => {
    const sx = await duckdbService.query<{ shop_code: string }>(generateRepairOrphanShopsQuery(F, 100, '1=1', 'SX'));
    const codes = sx.map((r) => r.shop_code);
    expect(codes).toContain('SXORPH01');
    expect(codes).not.toContain('SCORPH01');
  });

  it('🔴 orphan-shops：branchCode=undefined（RLS-off）SC+SX 全见（字节安全·历史行为）', async () => {
    const all = await duckdbService.query<{ shop_code: string }>(generateRepairOrphanShopsQuery(F, 100, '1=1'));
    const codes = all.map((r) => r.shop_code);
    expect(codes).toContain('SXORPH01');
    expect(codes).toContain('SCORPH01');
  });

  it('coop-tier：branchCode=SX 影子计数仅本省（none_shadow=1），RLS-off=2', async () => {
    const sx = await duckdbService.query<{ coop_tier: string; shop_count: number }>(
      generateRepairCoopTierQuery(F, '1=1', 'SX'),
    );
    expect(Number(sx.find((r) => r.coop_tier === 'none_shadow')?.shop_count ?? 0)).toBe(1);
    const all = await duckdbService.query<{ coop_tier: string; shop_count: number }>(generateRepairCoopTierQuery(F));
    expect(Number(all.find((r) => r.coop_tier === 'none_shadow')?.shop_count ?? 0)).toBe(2);
  });

  it('scatter：branchCode=SX 影子点仅 SX，不串读 SC', async () => {
    const sx = await duckdbService.query<{ shop_code: string; coop_tier: string }>(
      generateRepairScatterQuery(F, '1=1', 'SX'),
    );
    const shadow = sx.filter((r) => r.coop_tier === 'none_shadow').map((r) => r.shop_code);
    expect(shadow).toContain('SXORPH01');
    expect(shadow).not.toContain('SCORPH01');
  });

  it('🔴 diversion-list：branchCode=SX 仅 SX 赔案，RLS-off 见 SC+SX（证明 opt-in）', async () => {
    const sx = await duckdbService.query<{ subject_shop_code: string }>(
      generateRepairDiversionListQuery(F, 500, 0, '1=1', 'SX'),
    );
    const sxCodes = sx.map((r) => r.subject_shop_code);
    expect(sxCodes).toContain('SXORPH01');
    expect(sxCodes).not.toContain('SCORPH01');
    const all = await duckdbService.query<{ subject_shop_code: string }>(generateRepairDiversionListQuery(F));
    const allCodes = all.map((r) => r.subject_shop_code);
    expect(allCodes).toContain('SXORPH01');
    expect(allCodes).toContain('SCORPH01');
  });

  it('local-resource：同码跨省登记厂 branchCode=SX 仅计 SX 赔案（防跨省灌入），RLS-off 计两省', async () => {
    const sx = await duckdbService.query<{ shop_code: string; total_claims: number }>(
      generateRepairLocalResourceQuery(F, '1=1', 'SX'),
    );
    expect(Number(sx.find((r) => r.shop_code === 'REGSHOP1')?.total_claims ?? 0)).toBe(1);
    const all = await duckdbService.query<{ shop_code: string; total_claims: number }>(
      generateRepairLocalResourceQuery(F),
    );
    expect(Number(all.find((r) => r.shop_code === 'REGSHOP1')?.total_claims ?? 0)).toBe(2);
  });

  it('③ 时间窗 rolling12 + branchCode=SX：MAX 基准本省过滤，查询执行无 Binder Error', async () => {
    // 仅验证带时间窗 + branchCode 的 SQL 可执行（基准 MAX 子查询含 WHERE branch_code）。
    const sql = generateRepairOrphanShopsQuery({ timeWindow: 'rolling12' }, 100, '1=1', 'SX');
    expect(sql).toContain("FROM ClaimsDetail WHERE branch_code = 'SX'");
    const rows = await duckdbService.query<{ shop_code: string }>(sql);
    expect(rows.map((r) => r.shop_code)).not.toContain('SCORPH01');
  });
});
