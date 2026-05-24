/**
 * materializeInBatches 物化批处理测试
 *
 * 通过 vi.spyOn(service, 'query') 拦截 SQL 执行，
 * 验证批处理逻辑的调用序列、异常回退和线程恢复。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { duckdbService } from '../duckdb.js';
import { materializeInBatches } from '../duckdb-materialization.js';
import { DUCKDB_INIT_OPTIONS } from '../../config/database.js';

describe('materializeInBatches — 批次物化逻辑', () => {
  const sqlCalls: string[] = [];
  const originalThreads = DUCKDB_INIT_OPTIONS.threads;

  beforeEach(async () => {
    DUCKDB_INIT_OPTIONS.threads = 2;
    await duckdbService.init();
    sqlCalls.length = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    DUCKDB_INIT_OPTIONS.threads = originalThreads;
    try { await duckdbService.close(); } catch { /* ignore */ }
  });

  function mockQuery(monthList: string[], failAtSql?: string) {
    vi.spyOn(duckdbService, 'query').mockImplementation(async (sql: string) => {
      sqlCalls.push(sql);

      if (failAtSql && sql.includes(failAtSql)) {
        throw new Error('Injected failure');
      }

      // 返回月份列表
      if (sql.includes('DISTINCT strftime')) {
        return monthList.map(ym => ({ ym }));
      }
      // information_schema 查询（dropRelationIfExists）
      if (sql.includes('information_schema.tables')) {
        return [];
      }
      return [];
    });
  }

  // MB-01: 无数据（月份为空）
  it('MB-01: 月份列表为空时直接 CREATE TABLE（无 INSERT）', async () => {
    mockQuery([]);
    const result = await materializeInBatches(
      duckdbService,
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(result).toBe('table');
    expect(sqlCalls.some(s => s.includes('CREATE TABLE TestTable'))).toBe(true);
    expect(sqlCalls.filter(s => s.includes('INSERT INTO')).length).toBe(0);
  });

  // MB-02: 单月数据
  it('MB-02: 单月数据生成1次 CREATE，0次 INSERT', async () => {
    mockQuery(['2024-01']);
    const result = await materializeInBatches(
      duckdbService,
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(result).toBe('table');
    const creates = sqlCalls.filter(s => s.includes('CREATE TABLE TestTable'));
    const inserts = sqlCalls.filter(s => s.includes('INSERT INTO TestTable'));
    expect(creates.length).toBe(1);
    expect(inserts.length).toBe(0);
  });

  // MB-03: 三个月数据
  it('MB-03: 三月数据生成1次 CREATE + 2次 INSERT', async () => {
    mockQuery(['2024-01', '2024-02', '2024-03']);
    const result = await materializeInBatches(
      duckdbService,
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(result).toBe('table');
    const creates = sqlCalls.filter(s => s.includes('CREATE TABLE TestTable'));
    const inserts = sqlCalls.filter(s => s.includes('INSERT INTO TestTable'));
    expect(creates.length).toBe(1);
    expect(inserts.length).toBe(2);
  });

  // MB-04: 物化不修改全局 threads（避免影响并发查询）
  it('MB-04: 物化过程不修改全局 threads 设置', async () => {
    mockQuery(['2024-01']);
    await materializeInBatches(
      duckdbService,
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(sqlCalls.some(s => s === 'SET threads=1')).toBe(false);
    expect(sqlCalls.some(s => s.includes('SET preserve_insertion_order'))).toBe(false);
  });

  // MB-05: joined CTE 可指定批处理日期列，避免 p/cs 双表都有 policy_date 时歧义
  it('MB-05: joined CTE 批处理条件使用指定日期表达式', async () => {
    mockQuery(['2024-01', '2024-02']);
    await materializeInBatches(
      duckdbService,
      'CrossSellDailyAgg',
      `SELECT p.policy_date, cs.policy_date AS cs_policy_date
       FROM PolicyFact p
       LEFT JOIN CrossSellFact cs ON p.policy_no = cs.policy_no
       WHERE p.policy_date IS NOT NULL`,
      'SELECT policy_date FROM normalized',
      'CREATE OR REPLACE VIEW CrossSellDailyAgg AS SELECT 1',
      [],
      { batchDateExpression: 'p.policy_date' },
    );

    const batchedSql = sqlCalls.filter(s => s.includes('CrossSellDailyAgg') && s.includes('strftime'));
    expect(batchedSql.length).toBe(2);
    expect(batchedSql.every(s => s.includes("strftime(CAST(p.policy_date AS DATE), '%Y-%m')"))).toBe(true);
    expect(batchedSql.some(s => s.includes("strftime(CAST(policy_date AS DATE), '%Y-%m')"))).toBe(false);
  });

  // MB-06: 索引创建
  it('MB-06: 提供 indexes 参数时创建索引', async () => {
    mockQuery(['2024-01']);
    await materializeInBatches(
      duckdbService,
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1',
      [{ name: 'idx_date', column: 'policy_date' }],
    );
    expect(sqlCalls.some(s => s.includes('CREATE INDEX IF NOT EXISTS idx_date ON TestTable(policy_date)'))).toBe(true);
  });

  // MB-07: 首批 CREATE 异常 → VIEW 回退
  it('MB-07: 首批 CREATE 失败后回退到 VIEW', async () => {
    mockQuery(['2024-01'], 'CREATE TABLE TestTable');
    const result = await materializeInBatches(
      duckdbService,
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(result).toBe('view');
    // VIEW fallback 被执行
    expect(sqlCalls.some(s => s.includes('CREATE OR REPLACE VIEW TestTable'))).toBe(true);
  });

  // MB-08: 中间批次 INSERT 异常 → VIEW 回退
  it('MB-08: 第二月 INSERT 失败后回退到 VIEW', async () => {
    mockQuery(['2024-01', '2024-02'], 'INSERT INTO TestTable');
    const result = await materializeInBatches(
      duckdbService,
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(result).toBe('view');
  });

  // MB-09: 异常路径不操作全局 threads
  it('MB-09: 异常后 catch 块不操作全局 threads', async () => {
    mockQuery(['2024-01'], 'CREATE TABLE TestTable');
    await materializeInBatches(
      duckdbService,
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(sqlCalls.some(s => s.includes('SET threads'))).toBe(false);
    expect(sqlCalls.some(s => s.includes('SET preserve_insertion_order'))).toBe(false);
  });
});
