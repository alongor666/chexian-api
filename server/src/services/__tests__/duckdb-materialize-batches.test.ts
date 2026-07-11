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

  // MB-10（beb706 复现）：热重载后源数据变更，重跑 materializeInBatches 必须让物化表
  // 反映新数据，而非冻结在 ETL 前快照。真实 DuckDB（非 mock）端到端跑一遍物化→改源→重物化。
  // 这正是热重载后 CrossSellDailyAgg 不刷新的根因验证：只要 reload 路径无条件重跑物化
  // （loader 幂等：materializeInBatches 先 DROP 再建），物化表就会带上新数据。
  it('MB-10（beb706）: 源数据变更后重跑物化，物化表反映新数据（非旧快照）', async () => {
    // 1. 建真实 PolicyFact 源（2 个月，合计 300）
    await duckdbService.query(`CREATE OR REPLACE TABLE PolicyFact AS
      SELECT * FROM (VALUES
        (DATE '2024-01-15', 100.0),
        (DATE '2024-02-15', 200.0)
      ) AS t(policy_date, premium)`);

    const cteSql = `SELECT CAST(policy_date AS DATE) AS policy_date, premium
                    FROM PolicyFact WHERE policy_date IS NOT NULL`;
    const aggSql = `SELECT policy_date, SUM(premium) AS total_premium
                    FROM normalized GROUP BY policy_date`;
    const viewFallback = `CREATE OR REPLACE VIEW BebAggTest AS WITH normalized AS (${cteSql}) ${aggSql}`;

    // 2. 首次物化（模拟启动首载 CrossSellDailyAgg）
    const r1 = await materializeInBatches(
      duckdbService, 'BebAggTest', cteSql, aggSql, viewFallback, [],
    );
    expect(r1).toBe('table');
    const before = await duckdbService.query<{ total: number; months: number }>(
      'SELECT SUM(total_premium) AS total, COUNT(*) AS months FROM BebAggTest');
    expect(Number(before[0].total)).toBe(300);
    expect(Number(before[0].months)).toBe(2);

    // 3. 模拟热重载：PolicyFact 换新数据（金额变化 + 新增一个月，合计 900）
    await duckdbService.query(`CREATE OR REPLACE TABLE PolicyFact AS
      SELECT * FROM (VALUES
        (DATE '2024-01-15', 150.0),
        (DATE '2024-02-15', 250.0),
        (DATE '2024-03-15', 500.0)
      ) AS t(policy_date, premium)`);

    // 4. reload 路径 = 无条件重跑物化（区别于 ensureDomainLoaded 的 no-op）
    const r2 = await materializeInBatches(
      duckdbService, 'BebAggTest', cteSql, aggSql, viewFallback, [],
    );
    expect(r2).toBe('table');

    // 5. 断言：物化表反映新数据（900/3 月），而非冻结在旧快照（300/2 月）——beb706 的核心保证
    const after = await duckdbService.query<{ total: number; months: number }>(
      'SELECT SUM(total_premium) AS total, COUNT(*) AS months FROM BebAggTest');
    expect(Number(after[0].total)).toBe(900);
    expect(Number(after[0].months)).toBe(3);

    await duckdbService.query('DROP TABLE IF EXISTS BebAggTest');
    await duckdbService.query('DROP TABLE IF EXISTS PolicyFact');
  });
});
