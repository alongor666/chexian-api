/**
 * 派生域多省共存加载集成测试（ADR G4 · GATED 能力预备）。
 *
 * 被测：duckdb-domain-loaders.ts selectUnionWithBranchCode / loadQuoteConversion / loadCrossSell
 * 的多省扩展（取代原 selectWithBranchCode 单源补列）。
 *
 * 安全核心（必须验证）：
 *   🔴 单省（SC-only，extra 源为空）→ 派生视图**恒含 branch_code 列**（P0.5 行为，federation RLS 视图必备），
 *      且全为部署省份常量（'SC'）→ 与历史 selectWithBranchCode 逐字节一致（字节安全回归）。
 *   ② 多省（SC + SX）→ SC 行补常量 'SC'、SX 行携源自带 branch_code='SX'；`WHERE branch_code='SX'` 精确过滤。
 *   ③ SX 源缺 branch_code（如 cross_sell frozen 源未注入）→ 多省时补对应省份常量。
 *
 * 需 DuckDB 原生二进制，归入 bun run test:integration（duckdb-* 自动入 integration include / CI exclude）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { duckdbService } from '../duckdb.js';
import { loadQuoteConversion, loadCrossSell, loadNewEnergyClaims } from '../duckdb-domain-loaders.js';

let tmpDir: string;
let scQuote: string, sxQuote: string, scCross: string, sxCrossNoBc: string;
let scNec: string, sxNecNoBc: string;

describe('派生域多省共存加载（ADR G4）', () => {
  beforeAll(async () => {
    await duckdbService.init();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chexian-branch-fact-'));
    const p = (n: string) => path.join(tmpDir, n).replace(/\\/g, '/');
    scQuote = p('sc_quote.parquet'); sxQuote = p('sx_quote.parquet');
    scCross = p('sc_cross.parquet'); sxCrossNoBc = p('sx_cross_nobc.parquet');
    scNec = p('sc_nec.parquet'); sxNecNoBc = p('sx_nec_nobc.parquet');

    // SC 报价源：不含 branch_code（模拟 SC fact parquet）
    // is_telemarketing 列（varchar 电销/非电销）— loadQuoteConversion REPLACE 转 boolean 必需
    await duckdbService.query(`
      COPY (SELECT '川报价' AS policy_no, '乐山' AS org_level_3, '川业务员' AS salesman_name,
                   '非电销' AS is_telemarketing)
      TO '${scQuote}' (FORMAT PARQUET)
    `);
    // SX 报价源：自带 branch_code='SX'（G1 runStandardDomain ETL 已注入）
    await duckdbService.query(`
      COPY (SELECT '晋报价' AS policy_no, '太原' AS org_level_3, '晋业务员' AS salesman_name,
                   '非电销' AS is_telemarketing, 'SX' AS branch_code)
      TO '${sxQuote}' (FORMAT PARQUET)
    `);
    // SC 交叉销售源：不含 branch_code
    await duckdbService.query(`
      COPY (SELECT '川交叉' AS policy_no, '乐山' AS org_level_3)
      TO '${scCross}' (FORMAT PARQUET)
    `);
    // SX 交叉销售源：也不含 branch_code（模拟 frozen 源未注入 → 多省时由 loader 补常量）
    await duckdbService.query(`
      COPY (SELECT '晋交叉' AS policy_no, '太原' AS org_level_3)
      TO '${sxCrossNoBc}' (FORMAT PARQUET)
    `);
    // P3-E SC 新能源出险源：含 branch_code='SC'（ETL VIN JOIN 派生后产物）
    await duckdbService.query(`
      COPY (SELECT
        TIMESTAMP '2026-01-07' AS report_time,
        '川出险' AS claim_no,
        'VIN_SC_001' AS vehicle_frame_no,
        '川A12345' AS plate_no,
        '乐山' AS org_level_3,
        'SC' AS branch_code,
        '未业务结案' AS claim_status,
        CAST(NULL AS DOUBLE) AS settled_amount,
        CAST(5000 AS DOUBLE) AS reserve_amount,
        '20260607' AS source_batch_date)
      TO '${scNec}' (FORMAT PARQUET)
    `);
    // P3-E SX 新能源出险源：不含 branch_code（模拟旧产物 / 跨省加载兜底）
    await duckdbService.query(`
      COPY (SELECT
        TIMESTAMP '2026-01-08' AS report_time,
        '晋出险' AS claim_no,
        'VIN_SX_001' AS vehicle_frame_no,
        '晋A99999' AS plate_no,
        '太原' AS org_level_3,
        '未业务结案' AS claim_status,
        CAST(NULL AS DOUBLE) AS settled_amount,
        CAST(3000 AS DOUBLE) AS reserve_amount,
        '20260607' AS source_batch_date)
      TO '${sxNecNoBc}' (FORMAT PARQUET)
    `);
  });

  afterAll(async () => {
    try { await duckdbService.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('🔴 单省（SC-only）：QuoteConversion 恒含 branch_code 列、全为 SC（P0.5 字节回归）', async () => {
    await loadQuoteConversion(duckdbService, scQuote);
    const cols = await duckdbService.query<{ column_name: string }>('DESCRIBE QuoteConversion');
    expect(cols.some(c => c.column_name.toLowerCase() === 'branch_code')).toBe(true);
    const rows = await duckdbService.query<{ branch_code: string }>('SELECT DISTINCT branch_code FROM QuoteConversion');
    expect(rows.map(r => r.branch_code)).toEqual(['SC']);
  });

  it('多省（SC+SX）：QuoteConversion SC 补常量 / SX 携源 branch_code，按省精确过滤', async () => {
    await loadQuoteConversion(duckdbService, scQuote, [{ branchCode: 'SX', path: sxQuote }]);
    const byBranch = await duckdbService.query<{ branch_code: string; policy_no: string }>(
      'SELECT branch_code, policy_no FROM QuoteConversion ORDER BY branch_code',
    );
    expect(byBranch.length).toBe(2);
    expect(byBranch.find(r => r.branch_code === 'SC')?.policy_no).toBe('川报价');
    expect(byBranch.find(r => r.branch_code === 'SX')?.policy_no).toBe('晋报价');

    const sxOnly = await duckdbService.query<{ c: number }>(
      "SELECT CAST(COUNT(*) AS INTEGER) AS c FROM QuoteConversion WHERE branch_code = 'SX'",
    );
    expect(Number(sxOnly[0].c)).toBe(1);
  });

  it('多省（两源均缺 branch_code）：CrossSellFact 各补对应省份常量', async () => {
    await loadCrossSell(duckdbService, scCross, [{ branchCode: 'SX', path: sxCrossNoBc }]);
    const rows = await duckdbService.query<{ branch_code: string; policy_no: string }>(
      'SELECT branch_code, policy_no FROM CrossSellFact ORDER BY branch_code',
    );
    expect(rows.map(r => r.branch_code)).toEqual(['SC', 'SX']);
    expect(rows.find(r => r.branch_code === 'SX')?.policy_no).toBe('晋交叉');
  });

  it('🔴 单省（SC-only）：CrossSellFact 恒含 branch_code 列、全为 SC（P0.5 字节回归）', async () => {
    await loadCrossSell(duckdbService, scCross);
    const cols = await duckdbService.query<{ column_name: string }>('DESCRIBE CrossSellFact');
    expect(cols.some(c => c.column_name.toLowerCase() === 'branch_code')).toBe(true);
    const rows = await duckdbService.query<{ branch_code: string }>('SELECT DISTINCT branch_code FROM CrossSellFact');
    expect(rows.map(r => r.branch_code)).toEqual(['SC']);
  });

  // P3-E 2026-06-23：new_energy_claims branch_code 派生化 loader 自适应验证
  it('🔴 P3-E 单省（SC-only）：NewEnergyClaims 含源 branch_code 列 → DESCRIBE 自适应直用、全为 SC', async () => {
    await loadNewEnergyClaims(duckdbService, scNec);
    const cols = await duckdbService.query<{ column_name: string }>('DESCRIBE NewEnergyClaims');
    expect(cols.some(c => c.column_name.toLowerCase() === 'branch_code')).toBe(true);
    expect(cols.some(c => c.column_name.toLowerCase() === 'is_telemarketing')).toBe(true);
    const rows = await duckdbService.query<{ branch_code: string }>(
      'SELECT DISTINCT branch_code FROM NewEnergyClaims',
    );
    expect(rows.map(r => r.branch_code)).toEqual(['SC']);
  });

  it('P3-E 多省（SC 携源 + SX 无 branch_code）：NewEnergyClaims SC 用源值 / SX 补部署省常量兜底', async () => {
    // 注：当前部署省 SC，跨省源加载场景下，SX 旧产物无 branch_code 列 → buildFactSelectSql 补部署省常量。
    // 这是 R28/R30 已验证的 DESCRIBE 自适应路径；本测试锁定 NewEnergyClaims 同走该路径。
    await loadNewEnergyClaims(duckdbService, scNec, [{ branchCode: 'SX', path: sxNecNoBc }]);
    const rows = await duckdbService.query<{ branch_code: string; claim_no: string }>(
      'SELECT branch_code, claim_no FROM NewEnergyClaims ORDER BY claim_no',
    );
    expect(rows.length).toBe(2);
    expect(rows.find(r => r.claim_no === '川出险')?.branch_code).toBe('SC');
    expect(rows.find(r => r.claim_no === '晋出险')?.branch_code).toBe('SX');
  });
});
