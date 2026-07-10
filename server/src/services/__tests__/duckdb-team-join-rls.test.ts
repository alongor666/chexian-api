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
import { generatePerformanceOrgHeatmapQuery } from '../../sql/performance-heatmap.js';
import { generatePerformanceDrilldownQuery } from '../../sql/performance-analysis/drilldown.js';
import { generateCrossSellHeatmapQuery } from '../../sql/cross-sell-heatmap.js';
import { generateCrossSellQuery } from '../../sql/cross-sell.js';
import { generateClaimsHeatmapQuery } from '../../sql/claims-heatmap.js';
import { generateHolidayFreeDrilldownQuery } from '../../sql/marketing-report.js';
import { generatePerformanceTopSalesmanQuery } from '../../sql/performance-analysis/top-salesman.js';

const BRANCH_SX = "branch_code = 'SX'";
/**
 * 团队维度活体断言：跑真实生成器 SQL，锁死「不抛 Ambiguous + 无扇出」。
 * 无扇出的判据：结果里**不出现错省团队 teamA**（zhangsan 的 SC 归属）——有扇出才会因
 * SX 保单 JOIN 到 SC 映射行而冒出 teamA。同时验「牙」：不传 rlsBranchCode（无省过滤）时
 * teamA 必出现，证明省过滤正是消除扇出的开关。
 */
async function expectNoFanout(filteredSql: string, unfilteredSql: string): Promise<void> {
  const filtered = await duckdbService.query(filteredSql);   // 不抛错即通过第一关
  const unfiltered = await duckdbService.query(unfilteredSql);
  const has = (rows: unknown, team: string) => JSON.stringify(rows).includes(team);
  expect(has(filtered, 'teamA')).toBe(false);   // 按省过滤 → 无错省团队（无扇出）
  expect(has(filtered, 'teamB')).toBe(true);    // SX 本省团队仍在
  expect(has(unfiltered, 'teamA')).toBe(true);  // 牙：无省过滤 → teamA 扇出冒头
}

/**
 * salesman 维度（SalesmanDim 归属机构富化）活体断言：判据换成错省机构 orgA。
 * zhangsan 归属 SC=orgA / SX=orgB，SX 域下裸 JOIN 会让其行按机构翻倍（orgA 冒头）。
 */
async function expectNoOrgFanout(filteredSql: string, unfilteredSql: string): Promise<void> {
  const filtered = await duckdbService.query(filteredSql);
  const unfiltered = await duckdbService.query(unfilteredSql);
  const has = (rows: unknown, org: string) => JSON.stringify(rows).includes(org);
  expect(has(filtered, 'orgA')).toBe(false);    // 按省过滤 → 无错省机构（无扇出）
  expect(has(unfiltered, 'orgA')).toBe(true);   // 牙：无省过滤 → orgA 扇出冒头
}

// 事实表别名（隔离键作用在保单行）；剥列 CTE 别名（不投影 branch_code）
const FROM_JOIN_NAIVE = `
  FROM PolicyFact p
  LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
`;

describe('分省 RLS × 团队 JOIN 活体 oracle（PR #997/#1016 根治验证）', () => {
  beforeAll(async () => {
    await duckdbService.init();
    // 多省保单：同一业务员 zhangsan 在 SC/SX 各有保单（PolicyFact 带 5 个生成器实际引用的全部列，
    // 使真实生成器 SQL 可端到端跑通；SC=100 / SX=200，RLS=SX 时单省事实保费恒为 200）。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE PolicyFact AS
      SELECT * FROM (VALUES
        ('P1','','zhangsan','orgA',DATE '2026-07-01',DATE '2026-07-01','商业保险','主全',100.0,'否','否','否','否','否','否','','家用车','','',0.0,'','','E0',1.0,'是','V1',0.0,'','A','否',0.0,'',5,'',DATE '2020-01-01','汽油',DATE '2027-06-30','','',0.0,0.0,0.0,0.0,'','','',1.0,'SC',90.0),
        ('P2','','zhangsan','orgB',DATE '2026-07-01',DATE '2026-07-01','商业保险','主全',200.0,'否','否','否','否','否','否','','家用车','','',0.0,'','','E0',1.0,'是','V2',0.0,'','A','否',0.0,'',5,'',DATE '2020-01-01','汽油',DATE '2027-06-30','','',0.0,0.0,0.0,0.0,'','','',1.0,'SX',180.0)
      ) AS t(policy_no,renewal_policy_no,salesman_name,org_level_3,policy_date,insurance_start_date,insurance_type,coverage_combination,premium,is_renewal,is_renewable,is_new_car,is_nev,is_transfer,is_telemarketing,terminal_source,customer_category,vehicle_model,tonnage_segment,new_vehicle_price,agent_name,customer_source,endorsement_no,commercial_pricing_factor,is_commercial_insure,vehicle_frame_no,fee_amount,renewal_mode,insurance_grade,is_cross_sell,cross_sell_premium_driver,plate_no,seat_count,driver_age_group,first_registration_date,fuel_type,insurance_end_date,insured_gender,truck_type,tonnage_value,no_claim_bonus,compulsory_ncd,commercial_ncd,highway_risk_level,previous_insurer,next_insurer,compulsory_ncd_factor,branch_code,prev_premium)
    `);
    // CrossSellDailyAgg（cross-sell 团队维度事实表）：同名 zhangsan 跨省各一行
    await duckdbService.query(`
      CREATE OR REPLACE TABLE CrossSellDailyAgg AS
      SELECT * FROM (VALUES
        ('SC','zhangsan',100.0,10,'主全',3,0,0,0,0,0,DATE '2026-07-01'),
        ('SX','zhangsan',200.0,20,'主全',6,0,0,0,0,0,DATE '2026-07-01')
      ) AS t(branch_code,salesman_name,premium,auto_count,coverage_combination,driver_count,nev_count,new_car_count,renewal_count,transfer_business_count,transfer_count,policy_date)
    `);
    // ClaimsDetail（claims-heatmap 事实表）：仅 SX 保单 P2 有赔案
    await duckdbService.query(`
      CREATE OR REPLACE TABLE ClaimsDetail AS
      SELECT * FROM (VALUES
        ('P2','C2','车损',1.0,120.0,30.0,TIMESTAMP '2026-04-01 00:00:00',TIMESTAMP '2026-04-10 00:00:00')
      ) AS t(policy_no,claim_no,case_type,liability_ratio,settled_amount,reserve_amount,report_time,settlement_time)
    `);
    // 多省映射：SalesmanTeamMapping 带 branch_code + plan_by_dim 消费列，zhangsan 跨省各一行、归属不同团队
    await duckdbService.query(`
      CREATE OR REPLACE TABLE SalesmanTeamMapping AS
      SELECT * FROM (VALUES
        ('B1','zhangsan','zhangsan','teamA','orgA',1000.0,'SC',0.0,0.0,0.0),
        ('B1','zhangsan','zhangsan','teamB','orgB',2000.0,'SX',0.0,0.0,0.0)
      ) AS t(business_no,salesman_name,full_name,team_name,organization,car_insurance_plan_2026,branch_code,achievement_rate,growth_rate,premium)
    `);
    // SalesmanDim（cross-sell salesman 维度）：多省同带 branch_code
    await duckdbService.query(`
      CREATE OR REPLACE TABLE SalesmanDim AS
      SELECT * FROM (VALUES ('zhangsan','teamA','orgA','SC'),('zhangsan','teamB','orgB','SX')) AS t(full_name,team,organization,branch_code)
    `);
    // 计划侧兜底表：achievement_cache 生产同带 team_name（perf-heatmap 口径）+ full_name（top-salesman 口径）
    await duckdbService.query(`CREATE OR REPLACE TABLE achievement_cache AS SELECT * FROM (VALUES ('teamB','zhangsan',2000.0)) AS t(team_name,full_name,plan_vehicle)`);
    await duckdbService.query(`CREATE OR REPLACE TABLE KpiPlanConfig AS SELECT * FROM (VALUES ('orgB',500.0,'driver','org',2026)) AS t(level_key,plan_premium,business_line,level,plan_year)`);
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

  // ---- 绿：真实生成器产出的团队维度 SQL 在多省 fixture 上「不抛错 + 无扇出」----
  // 5 个团队维度 JOIN SalesmanTeamMapping/SalesmanDim 的生成器，剥列 CTE + 按省过滤后逐个转绿。
  it('cross-sell-heatmap generateCrossSellHeatmapQuery(team, rls=SX) → 无报错+无扇出', async () => {
    await expectNoFanout(
      generateCrossSellHeatmapQuery(BRANCH_SX, 'all', undefined, 'day', 'team', [], 'policy_date', 'SX'),
      generateCrossSellHeatmapQuery(BRANCH_SX, 'all', undefined, 'day', 'team', [], 'policy_date'),
    );
  });

  it('performance-heatmap generatePerformanceOrgHeatmapQuery(team, rls=SX) → 无报错+无扇出', async () => {
    await expectNoFanout(
      generatePerformanceOrgHeatmapQuery(BRANCH_SX, 'all', 'day', 15, 'team', [], 'policy_date', 'SX'),
      generatePerformanceOrgHeatmapQuery(BRANCH_SX, 'all', 'day', 15, 'team', [], 'policy_date'),
    );
  });

  it('cross-sell generateCrossSellQuery(team, rls=SX) → 无报错+无扇出', async () => {
    await expectNoFanout(
      generateCrossSellQuery(BRANCH_SX, [], 'team', undefined, 'SX'),
      generateCrossSellQuery(BRANCH_SX, [], 'team'),
    );
  });

  it('performance-analysis/drilldown generatePerformanceDrilldownQuery(team, rls=SX) → 无报错+无扇出', async () => {
    await expectNoFanout(
      generatePerformanceDrilldownQuery('1=1', BRANCH_SX, 'all', 'day', 'mom', [], 'team', undefined, 'policy_date', undefined, 'SX'),
      generatePerformanceDrilldownQuery('1=1', BRANCH_SX, 'all', 'day', 'mom', [], 'team'),
    );
  });

  // claims-heatmap：eligible_policies CTE 只消除了 branch_code 二义，对**扇出不免疫**
  // （原 it.todo 注释误判为「已免疫」）。裸 JOIN SalesmanTeamMapping 时同名跨省业务员的赔案
  // 被两省团队各记一次——实测 rls=SX 原产出 teamA+teamB 并存。本 PR 改走剥列 CTE 后根治。
  it('claims-heatmap generateClaimsHeatmapQuery(team, rls=SX) → 无报错+无扇出（剥列 CTE 根治，非 eligible_policies 免疫）', async () => {
    // 第 8 参 cutoffBranchCode（数据截止日）+ 第 9 参 teamMappingBranchCode（团队 CTE 省过滤，独立解析）
    await expectNoFanout(
      generateClaimsHeatmapQuery({}, 'team', 'insurance_start_date', 'report_time', undefined, undefined, BRANCH_SX, 'SX', 'SX'),
      generateClaimsHeatmapQuery({}, 'team', 'insurance_start_date', 'report_time', undefined, undefined, BRANCH_SX),
    );
  });

  // ---- 降级态回归（审查 P1）：PolicyFact 已多省、SalesmanTeamMapping 无 branch_code 列 ----
  // 复现加载器降级形态（duckdb-domain-loaders.ts：SX 业务员维表未加载）。此前 claims-heatmap
  // 复用 PolicyFact 解析的 cutoffBranchCode 过滤团队 CTE → `WHERE branch_code='SX'` 打在无该列的
  // SalesmanTeamMapping 上 → Binder Error 500。修复后团队 CTE 只认独立的 teamMappingBranchCode
  // （降级态路由层 resolveBranchRlsCode(req,'SalesmanTeamMapping') 返回 undefined）→ 不注入省过滤。
  it('🛡 降级态：PolicyFact 多省 + SalesmanTeamMapping 无 branch_code + dimension=team → 不抛 Binder Error', async () => {
    // 降级：SalesmanTeamMapping 无 branch_code 列（业务员维表未按多省加载）
    await duckdbService.query(`
      CREATE OR REPLACE TABLE SalesmanTeamMapping AS
      SELECT * FROM (VALUES ('zhangsan','teamB')) AS t(full_name, team_name)
    `);
    try {
      // 修复后：teamMappingBranchCode=undefined（映射表 gate 未通过）→ 团队 CTE 不注入省过滤 → 不抛错
      const safe = generateClaimsHeatmapQuery({}, 'team', 'insurance_start_date', 'report_time', undefined, undefined, BRANCH_SX, 'SX', undefined);
      await expect(duckdbService.query(safe)).resolves.toBeDefined();
      // 牙：若误把 cutoffBranchCode 复用为团队省过滤（旧 bug），CTE 打在无 branch_code 列的表上 → Binder Error
      const buggy = generateClaimsHeatmapQuery({}, 'team', 'insurance_start_date', 'report_time', undefined, undefined, BRANCH_SX, 'SX', 'SX');
      await expect(duckdbService.query(buggy)).rejects.toThrow(/branch_code/i);
    } finally {
      // 还原共享 fixture 的多省 SalesmanTeamMapping，避免污染后续/重跑
      await duckdbService.query(`
        CREATE OR REPLACE TABLE SalesmanTeamMapping AS
        SELECT * FROM (VALUES
          ('B1','zhangsan','zhangsan','teamA','orgA',1000.0,'SC',0.0,0.0,0.0),
          ('B1','zhangsan','zhangsan','teamB','orgB',2000.0,'SX',0.0,0.0,0.0)
        ) AS t(business_no,salesman_name,full_name,team_name,organization,car_insurance_plan_2026,branch_code,achievement_rate,growth_rate,premium)
      `);
    }
  });

  // ---- salesman 维度：SalesmanDim 归属机构富化的裸 JOIN 同属本根因（#1017 未覆盖）----
  it('marketing-report generateHolidayFreeDrilldownQuery(salesman, rls=SX) → 无报错+无扇出', async () => {
    await expectNoOrgFanout(
      generateHolidayFreeDrilldownQuery(BRANCH_SX, ['2026-07-01'], 'salesman', [], 'policy_date', 'SX'),
      generateHolidayFreeDrilldownQuery(BRANCH_SX, ['2026-07-01'], 'salesman', [], 'policy_date'),
    );
  });

  it('top-salesman generatePerformanceTopSalesmanQuery(rls=SX) → 无报错+无扇出（同名业务员不跨省重复排名）', async () => {
    await expectNoOrgFanout(
      generatePerformanceTopSalesmanQuery(BRANCH_SX, BRANCH_SX, 'all', 'day', 'mom', 20, undefined, 'policy_date', undefined, 'SX'),
      generatePerformanceTopSalesmanQuery(BRANCH_SX, BRANCH_SX, 'all', 'day', 'mom', 20, undefined, 'policy_date', undefined),
    );
  });
});
