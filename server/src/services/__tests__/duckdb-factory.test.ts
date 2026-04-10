/**
 * DuckDBService 工厂函数集成测试
 *
 * 验证 createDuckDBService({ path: ':memory:' }) 能创建隔离实例，
 * 各实例间数据互不可见、生命周期独立。
 *
 * 运行方式：bun run test:integration（需本地 DuckDB 原生二进制）
 */
import { describe, expect, it, afterEach } from 'vitest';
import { createDuckDBService, type DuckDBServiceConfig } from '../duckdb.js';
import type { DuckDBService } from '../duckdb.js';

const MEMORY_CONFIG: DuckDBServiceConfig = { path: ':memory:' };

/** 跟踪所有创建的实例，确保 afterEach 清理 */
const instances: DuckDBService[] = [];

function createTestService(config: DuckDBServiceConfig = MEMORY_CONFIG): DuckDBService {
  const svc = createDuckDBService(config);
  instances.push(svc);
  return svc;
}

afterEach(async () => {
  await Promise.all(instances.map((svc) => svc.close().catch(() => {})));
  instances.length = 0;
});

describe('DuckDBService 工厂函数', () => {
  // DF-01: 基础创建+查询
  it('DF-01: 内存实例可初始化并执行查询', async () => {
    const db = createTestService();
    await db.init();

    const result = await db.query<{ answer: number }>('SELECT 42 AS answer');
    expect(result).toHaveLength(1);
    expect(result[0].answer).toBe(42);
  });

  // DF-02: 实例隔离
  it('DF-02: 两个实例的数据互不可见', async () => {
    const db1 = createTestService();
    const db2 = createTestService();
    await db1.init();
    await db2.init();

    // db1 创建表并插入数据
    await db1.query('CREATE TABLE test_isolation (id INTEGER)');
    await db1.query('INSERT INTO test_isolation VALUES (1), (2), (3)');

    // db1 能查到
    const rows1 = await db1.query<{ id: number }>('SELECT * FROM test_isolation');
    expect(rows1).toHaveLength(3);

    // db2 看不到 db1 的表
    const exists = await db2.hasRelation('test_isolation');
    expect(exists).toBe(false);
  });

  // DF-03: 缓存隔离
  it('DF-03: 各实例的查询缓存互相独立', async () => {
    const db1 = createTestService();
    const db2 = createTestService();
    await db1.init();
    await db2.init();

    // db1 缓存一个查询
    await db1.query('SELECT 1 AS v', 5000);
    expect(db1.cacheSize).toBe(1);

    // db2 缓存不受影响
    expect(db2.cacheSize).toBe(0);

    // db1 清缓存不影响 db2
    db1.invalidateCache({ silent: true });
    expect(db1.cacheSize).toBe(0);
  });

  // DF-04: 生命周期独立
  it('DF-04: 关闭一个实例不影响另一个', async () => {
    const db1 = createTestService();
    const db2 = createTestService();
    await db1.init();
    await db2.init();

    // 关闭 db1
    await db1.close();

    // db2 仍可查询
    const result = await db2.query<{ v: number }>('SELECT 99 AS v');
    expect(result[0].v).toBe(99);
  });

  // DF-05: dropRelationIfExists + hasRelation
  it('DF-05: 工具方法在内存实例上正常工作', async () => {
    const db = createTestService();
    await db.init();

    await db.query('CREATE TABLE temp_t (x INTEGER)');
    expect(await db.hasRelation('temp_t')).toBe(true);

    await db.dropRelationIfExists('temp_t');
    expect(await db.hasRelation('temp_t')).toBe(false);
  });

  // DF-06: VIEW 创建和删除
  it('DF-06: VIEW 的创建和清理', async () => {
    const db = createTestService();
    await db.init();

    await db.query('CREATE TABLE base_t (id INTEGER)');
    await db.query('CREATE VIEW v_base AS SELECT * FROM base_t');
    expect(await db.hasRelation('v_base')).toBe(true);

    await db.dropRelationIfExists('v_base');
    expect(await db.hasRelation('v_base')).toBe(false);
  });
});
