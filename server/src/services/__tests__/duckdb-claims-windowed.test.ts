/**
 * B299 出险日期窗口化赔款 CTE 数据级集成测试（需 DuckDB 原生二进制，仅本地：bun run test:integration）
 *
 * 合成 ClaimsDetail（同一保单两笔赔案：一笔 cutoff 前出险、一笔 cutoff 后出险）+
 * 验证 buildWindowedClaimsAggCTE：
 *   1) cutoff=早期 → 只计 cutoff 前出险赔款（排除未来出险），与静态 ClaimsAgg 不同；
 *   2) cutoff=最新出险日 → 窗口赔款 == 静态 ClaimsAgg（逐分钱一致，证字节安全 no-op）；
 *   3) 金额口径与静态 ClaimsAgg 一致（复用 CLAIMS_REPORTED_AMOUNT_CASE）：剔除无责/零结/注销/拒赔；
 *      已结案取 settled_amount、未结案取 reserve_amount。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import {
  createClaimsAggFromDetail,
  buildWindowedClaimsAggCTE,
} from '../duckdb-domain-loaders.js';

let db: DuckDBService;

beforeAll(async () => {
  db = createDuckDBService({ path: ':memory:' });
  await db.init();

  // 合成 ClaimsDetail：
  //  P001 两笔赔案 —— C1 出险 2026-02-10（cutoff 前，已结案 settled=1000），
  //                    C2 出险 2026-05-20（cutoff 后，未结案 reserve=3000）
  //  P002 一笔无责案件（liability_ratio=0）出险 2026-02-15 settled=9999 → 金额应被剔除
  //  P003 一笔拒赔（case_type='拒赔'）出险 2026-02-15 reserve=8888 → 金额应被剔除
  // 显式列类型对齐生产 Parquet（settled/reserve 为 double、liability_ratio 为 bigint），
  // 避免 VALUES 字面量被推断成 DECIMAL（Neo 驱动返回 {width,scale,value} 对象，Number() 得 NaN）。
  await db.query(`
    CREATE TABLE ClaimsDetail (
      policy_no VARCHAR, claim_no VARCHAR, accident_time TIMESTAMP,
      liability_ratio BIGINT, case_type VARCHAR, settlement_time TIMESTAMP,
      settled_amount DOUBLE, reserve_amount DOUBLE
    )
  `);
  await db.query(`
    INSERT INTO ClaimsDetail VALUES
      ('P001','C1', TIMESTAMP '2026-02-10 09:00:00', 100, '正常', TIMESTAMP '2026-03-01 00:00:00', 1000.0, 0.0),
      ('P001','C2', TIMESTAMP '2026-05-20 09:00:00', 100, '正常', NULL,                              0.0,    3000.0),
      ('P002','C3', TIMESTAMP '2026-02-15 09:00:00',   0, '正常', TIMESTAMP '2026-03-01 00:00:00', 9999.0, 0.0),
      ('P003','C4', TIMESTAMP '2026-02-15 09:00:00', 100, '拒赔', NULL,                              0.0,    8888.0)
  `);
});

afterAll(async () => {
  await db?.close?.();
});

describe('buildWindowedClaimsAggCTE — 出险日期窗口化赔款（B299）', () => {
  it('cutoff=早期：只计 cutoff 前出险赔款，排除未来出险（C2 不计入）', async () => {
    const cte = buildWindowedClaimsAggCTE('2026-03-31');
    const rows = await db.query<{ policy_no: string; claim_cases: number; reported_claims: number }>(
      `WITH claims_w AS (${cte}) SELECT * FROM claims_w WHERE policy_no = 'P001'`
    );
    expect(rows).toHaveLength(1);
    // C1 出险 2026-02-10 在窗口内（已结案 settled=1000）；C2 出险 2026-05-20 在窗口外 → 排除
    expect(Number(rows[0].reported_claims)).toBe(1000);
    // claim_cases 也仅计窗口内出险件数
    expect(Number(rows[0].claim_cases)).toBe(1);
  });

  it('cutoff=最新出险日：窗口赔款 == 静态 ClaimsAgg（逐分钱一致，证字节安全 no-op）', async () => {
    await createClaimsAggFromDetail(db);
    const cte = buildWindowedClaimsAggCTE('2026-05-20'); // = MAX(accident_time)
    const windowed = await db.query<{ policy_no: string; reported_claims: number }>(
      `WITH claims_w AS (${cte}) SELECT policy_no, reported_claims FROM claims_w ORDER BY policy_no`
    );
    const staticAgg = await db.query<{ policy_no: string; reported_claims: number }>(
      `SELECT policy_no, reported_claims FROM ClaimsAgg ORDER BY policy_no`
    );
    expect(windowed.map((r) => [r.policy_no, Number(r.reported_claims)])).toEqual(
      staticAgg.map((r) => [r.policy_no, Number(r.reported_claims)])
    );
  });

  it('金额口径：剔除无责(P002)与拒赔(P003)金额，与静态 ClaimsAgg 一致', async () => {
    const cte = buildWindowedClaimsAggCTE('2026-12-31');
    const rows = await db.query<{ policy_no: string; reported_claims: number }>(
      `WITH claims_w AS (${cte}) SELECT policy_no, reported_claims FROM claims_w WHERE policy_no IN ('P002','P003') ORDER BY policy_no`
    );
    // P002 无责 + P003 拒赔 → reported_claims 均为 0
    expect(Number(rows.find((r) => r.policy_no === 'P002')!.reported_claims)).toBe(0);
    expect(Number(rows.find((r) => r.policy_no === 'P003')!.reported_claims)).toBe(0);
  });

  it('P001 全窗口：已结案取 settled(1000) + 未结案取 reserve(3000) = 4000', async () => {
    const cte = buildWindowedClaimsAggCTE('2026-12-31');
    const rows = await db.query<{ reported_claims: number }>(
      `WITH claims_w AS (${cte}) SELECT reported_claims FROM claims_w WHERE policy_no = 'P001'`
    );
    expect(Number(rows[0].reported_claims)).toBe(4000);
  });
});
