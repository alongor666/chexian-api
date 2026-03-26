/**
 * materializeInBatches 物化批处理测试
 *
 * 通过 vi.spyOn(service, 'query') 拦截 SQL 执行，
 * 验证批处理逻辑的调用序列、异常回退和线程恢复。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { duckdbService } from '../duckdb.js';
import { DUCKDB_INIT_OPTIONS } from '../../config/database.js';

const service = duckdbService as any;

describe('materializeInBatches — 批次物化逻辑', () => {
  let querySpy: ReturnType<typeof vi.spyOn>;
  const sqlCalls: string[] = [];

  beforeEach(async () => {
    await service.init();
    sqlCalls.length = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try { await service.close(); } catch { /* ignore */ }
  });

  function mockQuery(monthList: string[], failAtSql?: string) {
    querySpy = vi.spyOn(service, 'query').mockImplementation(async (...args: unknown[]) => {
      const sql = args[0] as string;
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
    const result = await service.materializeInBatches(
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
    const result = await service.materializeInBatches(
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
    const result = await service.materializeInBatches(
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(result).toBe('table');
    const creates = sqlCalls.filter(s => s.includes('CREATE TABLE TestTable'));
    const inserts = sqlCalls.filter(s => s.includes('INSERT INTO TestTable'));
    expect(creates.length).toBe(1);
    expect(inserts.length).toBe(2);
  });

  // MB-04: SET threads=1 在首批前执行
  it('MB-04: 物化开始时降线程到1', async () => {
    mockQuery(['2024-01']);
    await service.materializeInBatches(
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    const threadIdx = sqlCalls.findIndex(s => s === 'SET threads=1');
    const createIdx = sqlCalls.findIndex(s => s.includes('CREATE TABLE TestTable'));
    expect(threadIdx).toBeGreaterThanOrEqual(0);
    expect(threadIdx).toBeLessThan(createIdx);
  });

  // MB-05: 线程恢复在成功路径
  it('MB-05: 正常完成后恢复线程数', async () => {
    mockQuery(['2024-01']);
    await service.materializeInBatches(
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(sqlCalls.some(s => s === `SET threads=${DUCKDB_INIT_OPTIONS.threads}`)).toBe(true);
    expect(sqlCalls.some(s => s === 'SET preserve_insertion_order=true')).toBe(true);
  });

  // MB-06: 索引创建
  it('MB-06: 提供 indexes 参数时创建索引', async () => {
    mockQuery(['2024-01']);
    await service.materializeInBatches(
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1',
      [{ name: 'idx_date', column: 'policy_date' }],
    );
    expect(sqlCalls.some(s => s.includes('CREATE INDEX IF NOT EXISTS idx_date ON TestTable(policy_date)'))).toBe(true);
  });

  // MB-07: 首批 CREATE 异常 → VIEW 回退
  it('MB-07: 首批 CREATE 失败后回退到 VIEW', async () => {
    mockQuery(['2024-01'], 'CREATE TABLE TestTable');
    const result = await service.materializeInBatches(
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
    const result = await service.materializeInBatches(
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    expect(result).toBe('view');
  });

  // MB-09: 异常路径仍恢复线程数
  it('MB-09: 异常后 catch 块恢复线程数', async () => {
    mockQuery(['2024-01'], 'CREATE TABLE TestTable');
    await service.materializeInBatches(
      'TestTable', 'SELECT 1 FROM PolicyFact WHERE 1=1', 'SELECT * FROM normalized',
      'CREATE OR REPLACE VIEW TestTable AS SELECT 1', [],
    );
    // 在异常后的调用中应有线程恢复
    const afterFail = sqlCalls.slice(sqlCalls.findIndex(s => s.includes('CREATE TABLE TestTable')) + 1);
    expect(afterFail.some(s => s.includes(`SET threads=${DUCKDB_INIT_OPTIONS.threads}`))).toBe(true);
  });
});
