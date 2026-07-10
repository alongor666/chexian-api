/**
 * 分省 RLS × 团队维度 JOIN SalesmanTeamMapping 活体 oracle（DuckDB 原生绑定，test:integration）。
 *
 * ## 为什么要这个 oracle（PR #997 / #1016 复盘）
 *
 * #997 修的生产事故是「多分省 RLS 下按团队维度下钻，裸 branch_code JOIN SalesmanTeamMapping
 * 触发 DuckDB Binder Error: Ambiguous reference」。但当时的回归网只有 branch-rls-injection.test.ts，
 * 那是**字符串断言**（`.toContain("branch_code")`）——只验 SQL 串里有没有过滤，**从不真跑 DuckDB、
 * 抓不到 Binder Error**。#1016 又只加了一道正则 governance 闸。二者都不是活体证明。
 *
 * 本文件是缺失的活体 oracle：内存建多省 PolicyFact + 带 branch_code 列的 SalesmanTeamMapping
 * （同名业务员跨 SC/SX 各一行），真跑 SQL，锁死两件事：
 *   1. 裸 JOIN 形态确实抛 Ambiguous（复现 #997，证明本 oracle 有牙）。
 *   2. marketing-report 已用的「剥列 CTE」范式：不抛错 **且团队保费无扇出**。
 *
 * ## 实测依据（DuckDB CLI v1.5.2，2026-07-09）
 *   - 裸 `WHERE branch_code='SX'` + JOIN 实体表 → `Binder Error: Ambiguous reference to column
 *     name "branch_code" (use: "p.branch_code" or "tm.branch_code")`。
 *   - qualify 方案（`WHERE p.branch_code='SX'`，即 #997 现网修复）→ **不抛错，但 SX 保费 200
 *     被 teamA/teamB 各记一次 = 凭空多算 200（扇出）**。qualify 修了报错、没修扇出。
 *   - 剥列 CTE（按省过滤 + 不投影 branch_code）→ 不抛错，SX 200 只归 teamB，正确。
 *
 * 诚实边界：本 oracle 用合成数据证明「机制上」的报错与扇出。生产是否真触发扇出，取决于真实
 * SalesmanTeamMapping 是否有同名业务员跨省多行 —— 由 Phase 3 用真实 parquet 核实后写进 PR 描述。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { duckdbService } from '../duckdb.js';

// 事实表别名（隔离键作用在保单行）；剥列 CTE 别名（不投影 branch_code）
const FROM_JOIN_NAIVE = `
  FROM PolicyFact p
  LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
`;

describe('分省 RLS × 团队 JOIN 活体 oracle（PR #997/#1016 根治验证）', () => {
  beforeAll(async () => {
    await duckdbService.init();
    // 多省保单：同一业务员 zhangsan 在 SC/SX 各有保单
    await duckdbService.query(`
      CREATE OR REPLACE TABLE PolicyFact AS
      SELECT * FROM (VALUES
        ('SC', 'zhangsan', 100),
        ('SX', 'zhangsan', 200)
      ) AS t(branch_code, salesman_name, premium)
    `);
    // 多省映射：SalesmanTeamMapping 带 branch_code 列，zhangsan 跨省各一行、归属不同团队
    await duckdbService.query(`
      CREATE OR REPLACE TABLE SalesmanTeamMapping AS
      SELECT * FROM (VALUES
        ('SC', 'zhangsan', 'teamA'),
        ('SX', 'zhangsan', 'teamB')
      ) AS t(branch_code, full_name, team_name)
    `);
  });

  afterAll(async () => {
    try { await duckdbService.close(); } catch { /* ignore */ }
  });

  // ---- 红：复现 #997（证明 oracle 有牙）----
  it('🔴 裸 branch_code + JOIN 实体表 → DuckDB Binder Error: Ambiguous（复现 #997）', async () => {
    const naive = `
      SELECT tm.team_name AS team, SUM(p.premium) AS prem
      ${FROM_JOIN_NAIVE}
      WHERE branch_code = 'SX'
      GROUP BY tm.team_name
    `;
    await expect(duckdbService.query(naive)).rejects.toThrow(/Ambiguous/i);
  });

  // ---- 对照：qualify 修了报错却留下扇出（本 oracle 记录 workaround 的不足；Phase 2 删 workaround 后本例仍有效，因用内联 SQL）----
  it('⚠️ qualify（p.branch_code）不抛错但保费扇出：SX 200 被两个团队各记一次 = 合计 400', async () => {
    const qualified = `
      SELECT tm.team_name AS team, SUM(p.premium) AS prem
      ${FROM_JOIN_NAIVE}
      WHERE p.branch_code = 'SX'
      GROUP BY tm.team_name ORDER BY team
    `;
    const rows = await duckdbService.query<{ team: string; prem: number }>(qualified);
    const total = rows.reduce((s, r) => s + Number(r.prem), 0);
    expect(rows.length).toBe(2);        // teamA + teamB —— 扇出
    expect(total).toBe(400);            // 真实 SX 保费只有 200，多算 200
  });

  // ---- 绿：剥列 CTE 目标契约（Phase 1 让 5 个生成器产出此形态）----
  it('✅ 剥列 CTE（按省过滤 + 不投影 branch_code）：不抛错 且 SX 200 只归 teamB（无扇出）', async () => {
    const stripped = `
      WITH team_mapping AS (
        SELECT DISTINCT full_name AS salesman_name, team_name
        FROM SalesmanTeamMapping tm
        WHERE 1=1 AND tm.branch_code = 'SX'
      )
      SELECT tm.team_name AS team, SUM(p.premium) AS prem
      FROM PolicyFact p
      LEFT JOIN team_mapping tm ON p.salesman_name = tm.salesman_name
      WHERE branch_code = 'SX'
      GROUP BY tm.team_name ORDER BY team
    `;
    const rows = await duckdbService.query<{ team: string; prem: number }>(stripped);
    const total = rows.reduce((s, r) => s + Number(r.prem), 0);
    expect(rows.length).toBe(1);        // 只有 teamB
    expect(rows[0].team).toBe('teamB');
    expect(total).toBe(200);            // 无扇出，等于真实 SX 保费
  });

  // ---- Phase 1 逐个转绿：真实生成器产出的团队维度 SQL 在多省 fixture 上「不抛错 + 无扇出」----
  // 迁移每个生成器时，取消对应 todo、import 其 generate* 函数、以团队维度 + rlsBranchCode='SX'
  // 生成 SQL、跑 duckdbService.query 断言不抛 Ambiguous 且团队保费合计 = 单省事实保费。
  it.todo('cross-sell-heatmap.ts generateCrossSellHeatmapQuery(team, rls=SX) → 无报错+无扇出');
  it.todo('performance-heatmap.ts generatePerformanceOrgHeatmapQuery(team, rls=SX) → 无报错+无扇出');
  it.todo('cross-sell.ts generateCrossSellQuery(team, rls=SX) → 无报错+无扇出');
  it.todo('performance-analysis/drilldown.ts generatePerformanceDrilldownQuery(team, rls=SX) → 无报错+无扇出');
  it.todo('claims-heatmap.ts generateClaimsHeatmapQuery(team, rls=SX) → 无报错+无扇出（已 eligible_policies CTE）');
});
