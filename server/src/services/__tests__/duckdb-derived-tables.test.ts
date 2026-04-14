/**
 * 派生表管理测试
 *
 * 测试 DERIVED_RELATIONS 常量完整性和 dropAllDerivedTables 行为。
 * 使用内存 DuckDB 做轻量集成测试。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { duckdbService, DERIVED_RELATIONS } from '../duckdb.js';
import { dropAllDerivedTables } from '../duckdb-materialization.js';

describe('DuckDB 派生表管理', () => {
  beforeEach(async () => {
    await duckdbService.init();
  });

  afterEach(async () => {
    try { await duckdbService.close(); } catch { /* ignore */ }
  });

  // DD-01: DERIVED_RELATIONS 包含正确的 4 个成员
  it('DD-01: DERIVED_RELATIONS 包含 4 个已知派生关系', () => {
    const expected = ['CrossSellDailyAgg', 'PolicyFactRenewal', 'PolicyFact', 'PolicyFactRealtime'];
    const actual = [...DERIVED_RELATIONS];
    expect(actual.sort()).toEqual(expected.sort());
  });

  // DD-02: dropAllDerivedTables 在干净状态不抛异常
  it('DD-02: 无派生表时 dropAllDerivedTables 安全返回', async () => {
    await expect(dropAllDerivedTables(duckdbService)).resolves.not.toThrow();
  });

  // DD-03: dropAllDerivedTables 清理 VIEW
  it('DD-03: 创建 VIEW 后 dropAllDerivedTables 成功清理', async () => {
    await duckdbService.query('CREATE VIEW PolicyFact AS SELECT 1 AS x');
    await dropAllDerivedTables(duckdbService);

    const remaining: { table_name: string }[] = await duckdbService.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'PolicyFact' AND table_schema = 'main'
    `);
    expect(remaining.length).toBe(0);
  });

  // DD-04: dropAllDerivedTables 清理 TABLE
  it('DD-04: 创建 TABLE 后 dropAllDerivedTables 成功清理', async () => {
    await duckdbService.query('CREATE TABLE PolicyFactRealtime AS SELECT 1 AS x');
    await dropAllDerivedTables(duckdbService);

    const remaining: { table_name: string }[] = await duckdbService.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'PolicyFactRealtime' AND table_schema = 'main'
    `);
    expect(remaining.length).toBe(0);
  });

  // DD-05: dropAllDerivedTables 清理 raw_parquet 系列
  it('DD-05: raw_parquet 系列表被一并清理', async () => {
    await duckdbService.query('CREATE TABLE raw_parquet AS SELECT 1 AS x');
    await duckdbService.query('CREATE TABLE raw_parquet_0 AS SELECT 2 AS x');
    await dropAllDerivedTables(duckdbService);

    const remaining: { table_name: string }[] = await duckdbService.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name LIKE 'raw_parquet%' AND table_schema = 'main'
    `);
    expect(remaining.length).toBe(0);
  });

  // DD-06: 混合状态（VIEW + TABLE）均正确清理
  it('DD-06: 混合 VIEW 和 TABLE 均被清理', async () => {
    await duckdbService.query('CREATE VIEW PolicyFact AS SELECT 1 AS x');
    await duckdbService.query('CREATE TABLE PolicyFactRealtime AS SELECT 1 AS x');
    await duckdbService.query('CREATE VIEW CrossSellDailyAgg AS SELECT 1 AS x');
    await dropAllDerivedTables(duckdbService);

    const remaining: { table_name: string }[] = await duckdbService.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('PolicyFact', 'PolicyFactRealtime', 'CrossSellDailyAgg')
        AND table_schema = 'main'
    `);
    expect(remaining.length).toBe(0);
  });
});
