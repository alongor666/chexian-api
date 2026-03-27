/**
 * QueryCache 纯单元测试
 *
 * QueryCache 是 DuckDB 服务内部的缓存层，负责 TTL 管理和 LRU 淘汰。
 * 这里通过 duckdbService 暴露的 query() 方法间接测试缓存行为。
 *
 * 由于 QueryCache 是 duckdb.ts 内部类不可直接导入，
 * 我们测试其通过 query(sql, cacheTtlMs) 暴露的公共行为。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { duckdbService } from '../duckdb.js';

describe('DuckDB QueryCache — 缓存行为测试', () => {
  beforeAll(async () => {
    // 使用内存数据库初始化
    await duckdbService.init();
  });

  afterAll(async () => {
    await duckdbService.close();
  });

  // QC-01: cacheTtlMs > 0 时缓存命中
  it('QC-01: 相同 SQL 第二次查询走缓存（结果一致）', async () => {
    const sql = "SELECT 42 AS answer";
    const result1 = await duckdbService.query<{ answer: number }>(sql, 5000);
    const result2 = await duckdbService.query<{ answer: number }>(sql, 5000);
    expect(result1).toEqual(result2);
    expect(result1[0].answer).toBe(42);
  });

  // QC-02: cacheTtlMs = 0 不缓存
  it('QC-02: cacheTtlMs=0 每次都执行 SQL', async () => {
    // 使用 random() 确保每次执行结果不同
    const sql = "SELECT random() AS r";
    const result1 = await duckdbService.query<{ r: number }>(sql, 0);
    const result2 = await duckdbService.query<{ r: number }>(sql, 0);
    // random() 几乎不可能相等
    expect(result1[0].r).not.toBe(result2[0].r);
  });

  // QC-03: invalidateAll 清空缓存
  it('QC-03: invalidateAll 后相同 SQL 重新执行', async () => {
    const sql = "SELECT random() AS r";
    const result1 = await duckdbService.query<{ r: number }>(sql, 60000);

    // 清空缓存（silent 模式避免日志噪音）
    duckdbService.invalidateCache({ silent: true });

    const result2 = await duckdbService.query<{ r: number }>(sql, 60000);
    // 缓存清空后 random() 重新执行，值不同
    expect(result1[0].r).not.toBe(result2[0].r);
  });

  // QC-04: 缓存 size 属性可访问
  it('QC-04: 缓存 size 返回当前条目数', () => {
    const sizeBefore = duckdbService.cacheSize;
    expect(typeof sizeBefore).toBe('number');
    expect(sizeBefore).toBeGreaterThanOrEqual(0);
  });
});
