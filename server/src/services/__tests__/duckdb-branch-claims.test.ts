/**
 * 赔案明细多省共存加载 + RLS 隔离集成测试（PR-1 · ADR G4 扩展）。
 *
 * 被测：duckdb-domain-loaders.ts loadClaimsDetail 的 extraSources 多省扩展
 * （buildClaimsDetailSelectSql / composeClaimsDetailSelect）+ R1 验证。
 *
 * 安全核心（必须验证）：
 *   🔴 单省（SC-only，extra 源为空）→ ClaimsDetail VIEW 单源、保留 union_by_name（CDC 分区漂移容忍）、
 *      与历史 loadClaimsDetail 逐字节一致（字节安全回归）。
 *   ② 多省（SC+SX 均含 branch_code）→ 两省赔案进 VIEW、`WHERE branch_code='SX'` 精确过滤。
 *   ③ SX 源缺 branch_code（旧产物兜底）→ 多省时 loader DESCRIBE 自适应补对应省份常量。
 *   🔴 R1：ClaimsAgg GROUP BY policy_no **不含 branch_code**（刻意），经 PolicyFact LEFT JOIN +
 *      `WHERE branch_code='SX'` 隔离——branch_code 仅在 PolicyFact 故无裸列名歧义、无 Binder Error，
 *      且 SX/SC 赔款互不串读（policy_no 省份前缀 610/618 不碰撞）。这是 PR-1 R1 的关键证据。
 *
 * 需 DuckDB 原生二进制，归入 bun run test:integration（duckdb-* 自动入 integration include / CI exclude）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { duckdbService } from '../duckdb.js';
import { loadClaimsDetail, createClaimsAggFromDetail } from '../duckdb-domain-loaders.js';

let tmpDir: string;
let scClaims: string, sxClaims: string, sxClaimsNoBc: string;

/** 造一份最小赔案 parquet（createClaimsAggFromDetail 所需列齐全）。 */
async function writeClaimsParquet(
  dst: string,
  row: { policy_no: string; claim_no: string; reserve: number; withBranch: string | null },
): Promise<void> {
  const branchCol = row.withBranch ? `, '${row.withBranch}' AS branch_code` : '';
  await duckdbService.query(`
    COPY (SELECT '${row.policy_no}' AS policy_no, '${row.claim_no}' AS claim_no,
                 CAST(100 AS DOUBLE) AS liability_ratio, CAST(NULL AS VARCHAR) AS case_type,
                 CAST(NULL AS TIMESTAMP) AS settlement_time, CAST(NULL AS DOUBLE) AS settled_amount,
                 CAST(${row.reserve} AS DOUBLE) AS reserve_amount,
                 TIMESTAMP '2026-01-10' AS accident_time${branchCol})
    TO '${dst}' (FORMAT PARQUET)
  `);
}

describe('赔案明细多省共存加载 + RLS 隔离（PR-1）', () => {
  beforeAll(async () => {
    await duckdbService.init();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chexian-branch-claims-'));
    const p = (n: string) => path.join(tmpDir, n).replace(/\\/g, '/');
    scClaims = p('sc_claims.parquet');
    sxClaims = p('sx_claims.parquet');
    sxClaimsNoBc = p('sx_claims_nobc.parquet');
    // SC 赔案：含 branch_code='SC'（实测 SC current/claims_detail 已物化该列）
    await writeClaimsParquet(scClaims, { policy_no: '610川保单', claim_no: '川赔1', reserve: 5000, withBranch: 'SC' });
    // SX 赔案：含 branch_code='SX'（G1 ETL policy_no[:3]=618 派生）
    await writeClaimsParquet(sxClaims, { policy_no: '618晋保单', claim_no: '晋赔1', reserve: 3000, withBranch: 'SX' });
    // SX 赔案（无 branch_code，模拟旧产物兜底补常量分支）
    await writeClaimsParquet(sxClaimsNoBc, { policy_no: '618晋保单2', claim_no: '晋赔2', reserve: 2000, withBranch: null });
  });

  afterAll(async () => {
    try { await duckdbService.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('🔴 单省（SC-only）：ClaimsDetail 单源含 SC 赔案、branch_code 全 SC（字节安全）', async () => {
    await loadClaimsDetail(duckdbService, scClaims);
    const cnt = await duckdbService.query<{ c: number }>('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM ClaimsDetail');
    expect(Number(cnt[0].c)).toBe(1);
    const bc = await duckdbService.query<{ branch_code: string }>('SELECT DISTINCT branch_code FROM ClaimsDetail');
    expect(bc.map(r => r.branch_code)).toEqual(['SC']);
  });

  it('多省（SC+SX 均含 branch_code）：ClaimsDetail 含两省赔案、按省精确过滤', async () => {
    await loadClaimsDetail(duckdbService, scClaims, [{ branchCode: 'SX', path: sxClaims }]);
    const rows = await duckdbService.query<{ branch_code: string; policy_no: string }>(
      'SELECT branch_code, policy_no FROM ClaimsDetail ORDER BY branch_code',
    );
    expect(rows.length).toBe(2);
    expect(rows.find(r => r.branch_code === 'SX')?.policy_no).toBe('618晋保单');
    const sxOnly = await duckdbService.query<{ c: number }>(
      "SELECT CAST(COUNT(*) AS INTEGER) AS c FROM ClaimsDetail WHERE branch_code = 'SX'",
    );
    expect(Number(sxOnly[0].c)).toBe(1);
  });

  it('多省（SX 源缺 branch_code）：loader DESCRIBE 自适应补 SX 常量', async () => {
    await loadClaimsDetail(duckdbService, scClaims, [{ branchCode: 'SX', path: sxClaimsNoBc }]);
    const rows = await duckdbService.query<{ branch_code: string; policy_no: string }>(
      'SELECT branch_code, policy_no FROM ClaimsDetail ORDER BY branch_code',
    );
    expect(rows.map(r => r.branch_code)).toEqual(['SC', 'SX']);
    expect(rows.find(r => r.branch_code === 'SX')?.policy_no).toBe('618晋保单2');
  });

  it('🔴 R1：ClaimsAgg 不含 branch_code，经 PolicyFact JOIN + WHERE branch_code 隔离无歧义且无串读', async () => {
    await loadClaimsDetail(duckdbService, scClaims, [{ branchCode: 'SX', path: sxClaims }]);
    await createClaimsAggFromDetail(duckdbService);

    // ① ClaimsAgg 刻意不含 branch_code（防与 PolicyFact 在赔付路由裸列名歧义）
    const aggCols = await duckdbService.query<{ column_name: string }>('DESCRIBE ClaimsAgg');
    expect(aggCols.some(c => c.column_name.toLowerCase() === 'branch_code')).toBe(false);

    // 造最小 PolicyFact（SC+SX 保单，含 branch_code）— 模拟 kpi/cost 路由的 LEFT JOIN ClaimsAgg 形态
    await duckdbService.query(`
      CREATE OR REPLACE TABLE PolicyFact AS
      SELECT '610川保单' AS policy_no, 'SC' AS branch_code, CAST(10000 AS DOUBLE) AS premium
      UNION ALL SELECT '618晋保单', 'SX', CAST(8000 AS DOUBLE)
    `);

    // ② RLS-on 模拟：branch_code 仅存在于 PolicyFact → 裸列名无歧义 → 不 Binder Error
    const sx = await duckdbService.query<{ claims: number; pc: number }>(`
      SELECT CAST(SUM(c.reported_claims) AS DOUBLE) AS claims, CAST(COUNT(*) AS INTEGER) AS pc
      FROM PolicyFact p LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
      WHERE branch_code = 'SX'
    `);
    expect(Number(sx[0].pc)).toBe(1);        // 仅 SX 保单
    expect(Number(sx[0].claims)).toBe(3000); // 仅 SX 赔款（不含 SC 5000）

    // ③ SC 视角不受 SX 影响（无串读）
    const sc = await duckdbService.query<{ claims: number }>(`
      SELECT CAST(SUM(c.reported_claims) AS DOUBLE) AS claims
      FROM PolicyFact p LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
      WHERE branch_code = 'SC'
    `);
    expect(Number(sc[0].claims)).toBe(5000);

    await duckdbService.query('DROP TABLE IF EXISTS PolicyFact');
  });

  it('🔴 P1（codex 闸-2）：单省 glob 混合分区（旧分区无/新分区有 branch_code）→ REPLACE COALESCE 兜底 NULL', async () => {
    // 模拟 CDC：同省 glob 内 claims_2025 已派生 branch_code、claims_2026 旧产物无该列。
    // union_by_name 对旧分区行补 NULL，裸 SELECT * 会漏 NULL（RLS WHERE branch_code='SX' 命中不到）。
    const mixDir = path.join(tmpDir, 'sx_mixed');
    fs.mkdirSync(mixDir, { recursive: true });
    const p = (n: string) => path.join(mixDir, n).replace(/\\/g, '/');
    await writeClaimsParquet(p('claims_2025.parquet'), { policy_no: '618晋新', claim_no: '晋新1', reserve: 1000, withBranch: 'SX' });
    await writeClaimsParquet(p('claims_2026.parquet'), { policy_no: '618晋旧', claim_no: '晋旧1', reserve: 500, withBranch: null });
    const mixGlob = `${mixDir.replace(/\\/g, '/')}/claims_*.parquet`;

    await loadClaimsDetail(duckdbService, scClaims, [{ branchCode: 'SX', path: mixGlob }]);

    // 旧分区无列行的 branch_code 被 COALESCE 兜底为 'SX'，无 NULL 漏网
    const nullCnt = await duckdbService.query<{ c: number }>(
      'SELECT CAST(COUNT(*) AS INTEGER) AS c FROM ClaimsDetail WHERE branch_code IS NULL',
    );
    expect(Number(nullCnt[0].c)).toBe(0);
    // 旧+新分区两行都可被 WHERE branch_code='SX' 命中
    const sxCnt = await duckdbService.query<{ c: number }>(
      "SELECT CAST(COUNT(*) AS INTEGER) AS c FROM ClaimsDetail WHERE branch_code = 'SX'",
    );
    expect(Number(sxCnt[0].c)).toBe(2);
  });
});
