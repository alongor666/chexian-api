/**
 * 维度表去重/连接逻辑集成测试（PR #579 回归背书，评审建议 N1）
 *
 * 覆盖 loadDimParquet 的两层免疫机制：
 *   1. SalesmanDim 左表按人员唯一键 full_name 去重（ROW_NUMBER 保 tenure_months 最大行）
 *   2. 计划侧 SUM GROUP BY full_name 先聚合再 JOIN
 *
 * 业务背景：business_no 不是人员唯一键 —— 占位工号 000000000 由多个
 * 「admin×机构直接个代」虚拟业务员共用、200048259 两人共号（刘亚楼/刘婷）。
 * 修复前按 business_no 连接会笛卡尔放大实际保费（曾致乐山达成率 272.94%）。
 *
 * 需 DuckDB 原生二进制，归入 bun run test:integration（文件名 duckdb-* 自动
 * 命中 vitest.integration.config.ts include，并被 vite.config.ts 同名 exclude 排除出 CI）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { duckdbService } from '../duckdb.js';
import { loadDimParquet } from '../duckdb-domain-loaders.js';

let tmpDir: string;
let salesmanPath: string;
let planPath: string;

describe('loadDimParquet 维度表去重/连接（PR #579 回归）', () => {
  beforeAll(async () => {
    await duckdbService.init();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chexian-dim-dedup-'));
    salesmanPath = path.join(tmpDir, 'salesman.parquet').replace(/\\/g, '/');
    planPath = path.join(tmpDir, 'plan.parquet').replace(/\\/g, '/');

    // SalesmanDim fixture：
    //   - 共用 business_no 000000000 的两个不同实体（张三/李四）
    //   - 共号 200048259 两人（刘亚楼/刘婷）
    //   - 徐小满同 full_name 三行：tenure 12（资深组，期望保留）/ 5（新晋组）/ NULL（空值组，NULLS LAST）
    await duckdbService.query(`
      COPY (
        SELECT * FROM (VALUES
          ('000000000', '张三',   '000000000张三',   '直个一部', '乐山', 24),
          ('000000000', '李四',   '000000000李四',   '直个二部', '天府', 36),
          ('200048259', '刘亚楼', '200048259刘亚楼', '甲团队',   '乐山', 18),
          ('200048259', '刘婷',   '200048259刘婷',   '乙团队',   '乐山', 6),
          ('100000001', '徐小满', '100000001徐小满', '资深组',   '高新', 12),
          ('100000001', '徐小满', '100000001徐小满', '新晋组',   '高新', 5),
          ('100000001', '徐小满', '100000001徐小满', '空值组',   '高新', CAST(NULL AS INTEGER))
        ) AS t(business_no, salesman_name, full_name, team, organization, tenure_months)
      ) TO '${salesmanPath}' (FORMAT PARQUET)
    `);

    // PlanFact fixture：每实体计划值互不相同（验证不串档）+ 跨年度行 + 非 salesman 层级行（验证过滤）
    // 数值列显式 CAST DOUBLE 对齐生产 parquet schema（VALUES 字面量默认推断为 DECIMAL，
    // Neo 驱动返回 Decimal 对象，Number() 会得 NaN）
    await duckdbService.query(`
      COPY (
        SELECT full_name, plan_year, level,
               CAST(plan_vehicle AS DOUBLE) AS plan_vehicle,
               CAST(plan_total AS DOUBLE) AS plan_total
        FROM (VALUES
          ('000000000张三',   2026, 'salesman', 100.0, 120.0),
          ('000000000李四',   2026, 'salesman', 200.0, 220.0),
          ('200048259刘亚楼', 2026, 'salesman', 300.0, 320.0),
          ('200048259刘婷',   2026, 'salesman', 400.0, 420.0),
          ('100000001徐小满', 2026, 'salesman', 500.0, 520.0),
          ('100000001徐小满', 2025, 'salesman', 450.0, 470.0),
          ('乐山团队A',       2026, 'team',     9999.0, 9999.0)
        ) AS t(full_name, plan_year, level, plan_vehicle, plan_total)
      ) TO '${planPath}' (FORMAT PARQUET)
    `);

    // PolicyFact：buildAchievementView（loadDimParquet 第 5 步）的依赖。
    // PolicyFact.salesman_name 对 SalesmanTeamMapping.full_name 连接。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE PolicyFact AS
      SELECT policy_date, salesman_name, CAST(premium AS DOUBLE) AS premium, org_level_3
      FROM (VALUES
        (DATE '2026-03-01', '100000001徐小满', 80000.0, '高新'),
        (DATE '2026-03-02', '200048259刘亚楼', 30000.0, '乐山'),
        (DATE '2026-03-03', '200048259刘婷',   50000.0, '乐山'),
        (DATE '2025-02-01', '100000001徐小满', 40000.0, '高新'),
        (DATE '2026-03-04', '999999999无名氏', 10000.0, '成都')
      ) AS t(policy_date, salesman_name, premium, org_level_3)
    `);

    await loadDimParquet(duckdbService, salesmanPath, planPath);
  });

  afterAll(async () => {
    try { await duckdbService.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // DIM-01: 左表去重 —— SalesmanTeamMapping 按 full_name 无重复
  it('DIM-01: SalesmanTeamMapping 按 full_name 计数无重复', async () => {
    const dups = await duckdbService.query<{ full_name: string; cnt: number }>(`
      SELECT full_name, CAST(COUNT(*) AS INTEGER) AS cnt
      FROM SalesmanTeamMapping
      GROUP BY full_name
      HAVING COUNT(*) > 1
    `);
    expect(dups).toEqual([]);

    const total = await duckdbService.query<{ cnt: number }>(
      'SELECT CAST(COUNT(*) AS INTEGER) AS cnt FROM SalesmanTeamMapping'
    );
    // 5 个唯一 full_name：张三/李四/刘亚楼/刘婷/徐小满
    expect(Number(total[0].cnt)).toBe(5);
  });

  // DIM-02: 共用占位工号 000000000 的两个实体各自保留一行且计划不串档
  it('DIM-02: 占位工号 000000000 两实体各保留一行，计划互不串档', async () => {
    const rows = await duckdbService.query<{ full_name: string; plan: number }>(`
      SELECT full_name, car_insurance_plan_2026 AS plan
      FROM SalesmanTeamMapping
      WHERE business_no = '000000000'
      ORDER BY full_name
    `);
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.full_name)).toEqual(['000000000张三', '000000000李四']);
    expect(Number(rows[0].plan)).toBeCloseTo(100.0);
    expect(Number(rows[1].plan)).toBeCloseTo(200.0);
  });

  // DIM-03: 共号 200048259（刘亚楼/刘婷）计划不串档
  it('DIM-03: 共号 200048259 两人计划互不串档', async () => {
    const rows = await duckdbService.query<{ full_name: string; plan: number }>(`
      SELECT full_name, car_insurance_plan_2026 AS plan
      FROM SalesmanTeamMapping
      WHERE business_no = '200048259'
      ORDER BY full_name
    `);
    expect(rows.length).toBe(2);
    const byName = Object.fromEntries(rows.map(r => [r.full_name, Number(r.plan)]));
    expect(byName['200048259刘亚楼']).toBeCloseTo(300.0);
    expect(byName['200048259刘婷']).toBeCloseTo(400.0);
  });

  // DIM-04: 同 full_name 整行重复只留 tenure_months 最大行（NULL 排最后）
  it('DIM-04: 整行重复只保留 tenure_months 最大行', async () => {
    const rows = await duckdbService.query<{ team_name: string; plan: number }>(`
      SELECT team_name, car_insurance_plan_2026 AS plan
      FROM SalesmanTeamMapping
      WHERE full_name = '100000001徐小满'
    `);
    expect(rows.length).toBe(1);
    // tenure 12 的「资深组」行胜出；tenure 5 与 NULL 行被去掉
    expect(rows[0].team_name).toBe('资深组');
    // 计划仅取 plan_year=2026 AND level='salesman'：500（2025 的 450 与 team 层级行不计入）
    expect(Number(rows[0].plan)).toBeCloseTo(500.0);
  });

  // DIM-05: SalesmanPlanFact 视图按 (salesman_name, plan_year) 唯一，且过滤非 salesman 层级
  it('DIM-05: SalesmanPlanFact 多年计划唯一且过滤 team 层级', async () => {
    const dups = await duckdbService.query<{ cnt: number }>(`
      SELECT CAST(COUNT(*) AS INTEGER) AS cnt
      FROM SalesmanPlanFact
      GROUP BY salesman_name, plan_year
      HAVING COUNT(*) > 1
    `);
    expect(dups).toEqual([]);

    const xu = await duckdbService.query<{ plan_year: number; plan_vehicle: number }>(`
      SELECT plan_year, plan_vehicle
      FROM SalesmanPlanFact
      WHERE salesman_name = '100000001徐小满'
      ORDER BY plan_year
    `);
    expect(xu.length).toBe(2);
    expect(Number(xu[0].plan_vehicle)).toBeCloseTo(450.0); // 2025
    expect(Number(xu[1].plan_vehicle)).toBeCloseTo(500.0); // 2026

    const teamLevel = await duckdbService.query<{ cnt: number }>(`
      SELECT CAST(COUNT(*) AS INTEGER) AS cnt FROM SalesmanPlanFact WHERE salesman_name = '乐山团队A'
    `);
    expect(Number(teamLevel[0].cnt)).toBe(0);
  });

  // DIM-06: buildAchievementView 后 actual 不被放大（×1 而非 ×N）
  it('DIM-06: achievement_cache 实际保费 ×1 不放大', async () => {
    const xu = await duckdbService.query<{ cnt: number; total_actual: number; prev: number }>(`
      SELECT CAST(COUNT(*) AS INTEGER) AS cnt,
             SUM(actual_vehicle) AS total_actual,
             SUM(prev_year_actual) AS prev
      FROM achievement_cache
      WHERE full_name = '100000001徐小满'
    `);
    // 修复前：3 行重复 mapping → 3 行 ×8 万 = 24 万；修复后恰 1 行 8 万
    expect(Number(xu[0].cnt)).toBe(1);
    expect(Number(xu[0].total_actual)).toBeCloseTo(8.0); // 80000 / 10000 万元
    expect(Number(xu[0].prev)).toBeCloseTo(4.0); // 上年同期 40000 / 10000

    // 共号两人的实际保费各归各，不串档
    const liu = await duckdbService.query<{ full_name: string; actual: number; plan: number }>(`
      SELECT full_name, actual_vehicle AS actual, plan_vehicle AS plan
      FROM achievement_cache
      WHERE full_name IN ('200048259刘亚楼', '200048259刘婷')
      ORDER BY full_name
    `);
    expect(liu.length).toBe(2);
    expect(Number(liu[0].actual)).toBeCloseTo(3.0); // 刘亚楼 30000
    expect(Number(liu[0].plan)).toBeCloseTo(300.0);
    expect(Number(liu[1].actual)).toBeCloseTo(5.0); // 刘婷 50000
    expect(Number(liu[1].plan)).toBeCloseTo(400.0);
  });

  // DIM-07: mapping 外有保单的业务员走 Part B 未归属，且只出现一次
  it('DIM-07: mapping 外业务员归入未归属机构且唯一', async () => {
    const rows = await duckdbService.query<{ org_name: string; actual: number }>(`
      SELECT org_name, actual_vehicle AS actual
      FROM achievement_cache
      WHERE full_name = '999999999无名氏'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].org_name).toBe('未归属机构');
    expect(Number(rows[0].actual)).toBeCloseTo(1.0);
  });
});
