/**
 * YoY/YTD 双日期窗回归集成测试（需 DuckDB 原生二进制，仅本地：bun run test:integration）
 *
 * 背景：PR #640 owner review 复现 — yoy/ytd 的 whereClause 一旦含
 * startDate/endDate（生产路径），previous_period/previous_ytd 也被限到当年，
 * 导致 previous_value=0、growth=null。
 *
 * 本测试用 owner 给出的最小数据集：
 *   - 2025-01-06 Monday premium=100
 *   - 2026-01-05 Monday premium=200
 * 验证当路由传 currentPeriod=2026-01 / previousPeriod=2025-01 时：
 *   - YoY weekly: previous_value=100, current_value=200, growth_rate=1.0
 *   - YTD monthly: 同 previous_value=100, current_value=200, growth_rate=1.0
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import { generateYoYGrowthQuery, generateYTDGrowthQuery, type GrowthConfig } from '../../sql/growth.js';

let db: DuckDBService;

beforeAll(async () => {
  db = createDuckDBService({ path: ':memory:' });
  await db.init();
  // 显式 DOUBLE 避免 DuckDB 返回 DECIMAL 结构体（{width, scale, value}）影响断言可读性
  await db.query(`
    CREATE TABLE PolicyFact (policy_date DATE, premium DOUBLE);
    INSERT INTO PolicyFact VALUES (DATE '2025-01-06', 100.0), (DATE '2026-01-05', 200.0);
  `);
}, 30_000);

afterAll(async () => {
  try { await db.close(); } catch { /* ignore */ }
});

describe('7a2849 二轮：YoY 双日期窗（owner review 复现）', () => {
  it('whereClause 含 2026-01 + currentPeriod/previousPeriod 显式传 → previous=100 而非 0', async () => {
    const config: GrowthConfig = {
      growthType: 'yoy',
      timeView: 'weekly',
      // 模拟路由层"剥离日期"后的 baseWhereClause —— 注意 1=1 而非含日期
      whereClause: '1=1',
      currentPeriod: { startDate: '2026-01-01', endDate: '2026-01-31' },
      previousPeriod: { startDate: '2025-01-01', endDate: '2025-01-31' },
    };
    const sql = generateYoYGrowthQuery(config);
    const rows = await db.query<{ time_period: unknown; current_value: number; previous_value: number; growth_rate: number | null }>(sql);
    expect(rows.length).toBe(1);
    expect(rows[0].current_value).toBe(200);
    expect(rows[0].previous_value).toBe(100);
    expect(rows[0].growth_rate).toBeCloseTo(1.0, 5);
  });

  it('退化路径（不传 currentPeriod/previousPeriod，whereClause 不含日期）→ 仍能算出', async () => {
    const config: GrowthConfig = {
      growthType: 'yoy',
      timeView: 'weekly',
      whereClause: '1=1',
    };
    const sql = generateYoYGrowthQuery(config);
    const rows = await db.query<{ time_period: unknown; current_value: number; previous_value: number }>(sql);
    // 2025 + 2026 两行均存在，2025 当 current 无对应 previous=2024 → previous=0
    // 2026 当 current 对应 previous=2025 → previous=100
    const r2026 = rows.find(r => Number(r.current_value) === 200);
    expect(r2026).toBeDefined();
    expect(r2026!.previous_value).toBe(100);
  });

  it('幽灵 -100% 不复现：previous_period 在 LEFT JOIN 下不溢出当年外', async () => {
    const config: GrowthConfig = {
      growthType: 'yoy',
      timeView: 'weekly',
      whereClause: '1=1',
      currentPeriod: { startDate: '2026-01-01', endDate: '2026-01-31' },
      previousPeriod: { startDate: '2025-01-01', endDate: '2025-01-31' },
    };
    const sql = generateYoYGrowthQuery(config);
    const rows = await db.query<{ time_period: unknown; current_value: number; previous_value: number; growth_rate: number | null }>(sql);
    // 不应出现 current_value=0 的幽灵行
    const phantoms = rows.filter(r => Number(r.current_value) === 0);
    expect(phantoms.length).toBe(0);
  });
});

describe('7a2849 二轮：YTD 双日期窗（owner review 复现）', () => {
  it('whereClause 含 2026-01 + 双窗口 → previous=100 而非 0', async () => {
    const config: GrowthConfig = {
      growthType: 'ytd',
      timeView: 'monthly',
      whereClause: '1=1',
      currentPeriod: { startDate: '2026-01-01', endDate: '2026-01-31' },
      previousPeriod: { startDate: '2025-01-01', endDate: '2025-01-31' },
    };
    const sql = generateYTDGrowthQuery(config);
    const rows = await db.query<{ time_period: unknown; current_value: number; previous_value: number; growth_rate: number | null }>(sql);
    // YTD 累计行：2026-01 累计为 200，对比 2025-01 累计为 100
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const r = rows.find(x => Number(x.current_value) === 200);
    expect(r).toBeDefined();
    expect(r!.previous_value).toBe(100);
    expect(r!.growth_rate).toBeCloseTo(1.0, 5);
  });
});
