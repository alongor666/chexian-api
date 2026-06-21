/**
 * 维度表多省共存加载集成测试（ADR G3 · GATED 能力预备）。
 *
 * 被测：duckdb-domain-loaders.ts loadDimParquet / loadRepairDim 的多省扩展。
 *
 * 安全核心（必须验证）：
 *   🔴 单省（SC-only，extra 源为空）→ 维度表**不含 branch_code 列**、内容与 read_parquet 等价
 *      （= 历史行为，按构造证字节安全；golden-baseline BLOCKED 时的回归网）。
 *   ② 多省（SC + SX）→ 维度表含 branch_code 列，SC 行=补常量 'SC'、SX 行=各源自带/补常量；
 *      `WHERE branch_code='SX'` 可精确过滤（branch RLS 的数据层前提）。
 *   ③ SX 源自带 branch_code（G1 ETL 已注入）→ 不被重复补列，原值保留。
 *
 * 需 DuckDB 原生二进制，归入 bun run test:integration（文件名 duckdb-* 自动命中
 * vitest.integration.config.ts include，并被 vite.config.ts 同名 exclude 排除出 CI）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { duckdbService } from '../duckdb.js';
import { loadDimParquet, loadRepairDim } from '../duckdb-domain-loaders.js';

let tmpDir: string;
let scSalesman: string, scPlan: string, sxSalesman: string, sxPlan: string;
let scRepair: string, sxRepair: string;

async function copySalesman(target: string, names: Array<[string, string, string]>): Promise<void> {
  // (business_no, full_name, organization) → 最小可加载 SalesmanDim schema 子集
  const values = names
    .map(([bn, fn, org]) => `('${bn}', '${fn}', '${fn}', '组', '${org}', 12)`)
    .join(',\n          ');
  await duckdbService.query(`
    COPY (
      SELECT * FROM (VALUES
          ${values}
      ) AS t(business_no, salesman_name, full_name, team, organization, tenure_months)
    ) TO '${target}' (FORMAT PARQUET)
  `);
}

describe('维度表多省共存加载（ADR G3）', () => {
  beforeAll(async () => {
    await duckdbService.init();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chexian-branch-dim-'));
    const p = (n: string) => path.join(tmpDir, n).replace(/\\/g, '/');
    scSalesman = p('sc_salesman.parquet'); scPlan = p('sc_plan.parquet');
    sxSalesman = p('sx_salesman.parquet'); sxPlan = p('sx_plan.parquet');
    scRepair = p('sc_repair.parquet'); sxRepair = p('sx_repair.parquet');

    await copySalesman(scSalesman, [['100000001', '川业务员', '乐山']]);
    // SX 业务员源「自带 branch_code 列」（模拟 G1 ETL 注入），验证不被重复补列
    await duckdbService.query(`
      COPY (
        SELECT '200000002' AS business_no, '晋业务员' AS salesman_name, '晋业务员' AS full_name,
               '组' AS team, '太原' AS organization, 12 AS tenure_months, 'SX' AS branch_code
      ) TO '${sxSalesman}' (FORMAT PARQUET)
    `);

    const planRow = (fn: string, year: number) =>
      `('${fn}', ${year}, 'salesman', CAST(100 AS DOUBLE), CAST(120 AS DOUBLE))`;
    await duckdbService.query(`
      COPY (SELECT full_name, plan_year, level, CAST(plan_vehicle AS DOUBLE) AS plan_vehicle, CAST(plan_total AS DOUBLE) AS plan_total
        FROM (VALUES ${planRow('川业务员', 2026)}) AS t(full_name, plan_year, level, plan_vehicle, plan_total)
      ) TO '${scPlan}' (FORMAT PARQUET)
    `);
    await duckdbService.query(`
      COPY (SELECT full_name, plan_year, level, CAST(plan_vehicle AS DOUBLE) AS plan_vehicle, CAST(plan_total AS DOUBLE) AS plan_total
        FROM (VALUES ${planRow('晋业务员', 2026)}) AS t(full_name, plan_year, level, plan_vehicle, plan_total)
      ) TO '${sxPlan}' (FORMAT PARQUET)
    `);

    // RepairDim 最小 schema（org_level_3 编码格式 + 店名）
    await duckdbService.query(`
      COPY (SELECT '011019乐山中心支公司' AS org_level_3, '川修理厂' AS repair_shop_name)
      TO '${scRepair}' (FORMAT PARQUET)
    `);
    await duckdbService.query(`
      COPY (SELECT '099001太原中心支公司' AS org_level_3, '晋修理厂' AS repair_shop_name, 'SX' AS branch_code)
      TO '${sxRepair}' (FORMAT PARQUET)
    `);

    // buildAchievementView 依赖 PolicyFact（loadDimParquet 第 5 步）
    await duckdbService.query(`
      CREATE OR REPLACE TABLE PolicyFact AS
      SELECT DATE '2026-03-01' AS policy_date, '川业务员' AS salesman_name,
             CAST(50000 AS DOUBLE) AS premium, '乐山' AS org_level_3
    `);
  });

  afterAll(async () => {
    try { await duckdbService.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('🔴 单省（SC-only）：SalesmanDim 不含 branch_code 列（字节安全回归）', async () => {
    await loadDimParquet(duckdbService, scSalesman, scPlan);
    const cols = await duckdbService.query<{ column_name: string }>('DESCRIBE SalesmanDim');
    expect(cols.some(c => c.column_name.toLowerCase() === 'branch_code')).toBe(false);
    const cnt = await duckdbService.query<{ c: number }>('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM SalesmanDim');
    expect(Number(cnt[0].c)).toBe(1);
  });

  it('多省（SC+SX）：SalesmanDim 含 branch_code，SC 补常量 / SX 原值，可按省过滤', async () => {
    await loadDimParquet(
      duckdbService, scSalesman, scPlan,
      [{ branchCode: 'SX', path: sxSalesman }],
      [{ branchCode: 'SX', path: sxPlan }],
    );
    const cols = await duckdbService.query<{ column_name: string }>('DESCRIBE SalesmanDim');
    expect(cols.some(c => c.column_name.toLowerCase() === 'branch_code')).toBe(true);

    const byBranch = await duckdbService.query<{ branch_code: string; full_name: string }>(
      'SELECT branch_code, full_name FROM SalesmanDim ORDER BY branch_code',
    );
    expect(byBranch.length).toBe(2);
    expect(byBranch.find(r => r.branch_code === 'SC')?.full_name).toBe('川业务员');
    expect(byBranch.find(r => r.branch_code === 'SX')?.full_name).toBe('晋业务员');

    const sxOnly = await duckdbService.query<{ c: number }>(
      "SELECT CAST(COUNT(*) AS INTEGER) AS c FROM SalesmanDim WHERE branch_code = 'SX'",
    );
    expect(Number(sxOnly[0].c)).toBe(1);
  });

  it('🔴 单省（SC-only）：RepairDim 不含 branch_code 列（字节安全回归）', async () => {
    await loadRepairDim(duckdbService, scRepair);
    const cols = await duckdbService.query<{ column_name: string }>('DESCRIBE RepairDim');
    expect(cols.some(c => c.column_name.toLowerCase() === 'branch_code')).toBe(false);
  });

  it('多省（SC+SX）：RepairDim 含 branch_code，按省过滤精确', async () => {
    await loadRepairDim(duckdbService, scRepair, [{ branchCode: 'SX', path: sxRepair }]);
    const rows = await duckdbService.query<{ branch_code: string; repair_shop_name: string }>(
      'SELECT branch_code, repair_shop_name FROM RepairDim ORDER BY branch_code',
    );
    expect(rows.map(r => r.branch_code).sort()).toEqual(['SC', 'SX']);
    const sx = await duckdbService.query<{ shop: string }>(
      "SELECT repair_shop_name AS shop FROM RepairDim WHERE branch_code = 'SX'",
    );
    expect(sx[0].shop).toBe('晋修理厂');
  });
});
