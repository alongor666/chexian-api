/**
 * B311：loadMultipleParquet 不再内部 setDataVersion（延迟提交）。
 *
 * 用假 DuckDBTransactionalQueryable + 真实临时文件（指纹需要 statSync）驱动三条路径：
 * 全量重建 / 增量 INSERT / 缓存命中——全部只返回 versionToken、不改变当前版本。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DuckDBTransactionalQueryable } from '../duckdb-types.js';
import { loadMultipleParquet, computeParquetFingerprint } from '../duckdb-parquet-loader.js';
import { getDataVersion, _resetDataVersionForTesting } from '../data-version.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b311-loader-'));
const fileA = path.join(tmpDir, 'a.parquet');
const fileB = path.join(tmpDir, 'b.parquet');
fs.writeFileSync(fileA, 'stub-a');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createFakeDb(options: { hasRelation: boolean }) {
  const queries: string[] = [];
  const db: DuckDBTransactionalQueryable = {
    async query<T = any>(sql: string): Promise<T[]> {
      queries.push(sql);
      if (/COUNT\(\*\) AS cnt/i.test(sql)) return [{ cnt: 7 }] as T[];
      return [] as T[];
    },
    async transaction(statements: string[]) {
      queries.push(...statements);
    },
    async getTableSchema() {
      return [];
    },
    async hasRelation() {
      return options.hasRelation;
    },
    async dropRelationIfExists() {},
    invalidateCache() {},
  };
  return { db, queries };
}

describe('loadMultipleParquet 延迟版本提交（B311）', () => {
  beforeEach(() => {
    _resetDataVersionForTesting();
  });

  it('全量重建：返回指纹 token，且不改变当前 dataVersion', async () => {
    const { db, queries } = createFakeDb({ hasRelation: false });
    const result = await loadMultipleParquet(db, [fileA]);

    const fp = computeParquetFingerprint([fileA]);
    expect(result.versionToken).toBe(fp!.fingerprint);
    // 关键断言：加载器内部不再 setDataVersion —— 版本仍是初始值
    expect(getDataVersion()).toBe('init0000');
    expect(queries.some((q) => /CREATE TABLE raw_parquet__staging_/i.test(q))).toBe(true);
    expect(queries.some((q) => /ALTER TABLE raw_parquet__staging_.* RENAME TO raw_parquet/i.test(q))).toBe(true);
  });

  it('增量 INSERT：返回新指纹 token，同样不 bump 版本', async () => {
    // 上一个用例已写入指纹缓存（模块级），新增文件 → 走增量路径
    fs.writeFileSync(fileB, 'stub-b');
    const { db, queries } = createFakeDb({ hasRelation: true });
    const result = await loadMultipleParquet(db, [fileA, fileB]);

    const fp = computeParquetFingerprint([fileA, fileB]);
    expect(result.versionToken).toBe(fp!.fingerprint);
    expect(getDataVersion()).toBe('init0000');
    expect(queries.some((q) => /INSERT INTO raw_parquet/i.test(q))).toBe(true);
  });

  it('缓存命中：返回当前指纹 token（编排方提交为 no-op），不 bump 版本', async () => {
    const { db, queries } = createFakeDb({ hasRelation: true });
    const result = await loadMultipleParquet(db, [fileA, fileB]);

    const fp = computeParquetFingerprint([fileA, fileB]);
    expect(result.versionToken).toBe(fp!.fingerprint);
    expect(getDataVersion()).toBe('init0000');
    // 命中缓存：只有 COUNT 查询，无 CREATE/INSERT
    expect(queries.every((q) => /COUNT\(\*\) AS cnt/i.test(q))).toBe(true);
  });

  it('stat 失败（指纹不可得）：返回时间戳兜底 token，同样不 bump 版本', async () => {
    const missing = path.join(tmpDir, 'not-exist.parquet');
    expect(computeParquetFingerprint([missing])).toBeNull();

    const { db, queries } = createFakeDb({ hasRelation: true });
    const result = await loadMultipleParquet(db, [missing]);

    // 兜底 token：非任何文件指纹（指纹是 64 位 hex），而是 8+ 位时间戳 token
    expect(result.versionToken.length).toBeGreaterThanOrEqual(8);
    expect(result.versionToken).not.toMatch(/^[0-9a-f]{64}$/);
    // 关键断言：即使走兜底分支，加载器内部也不 bump —— 提交权在编排方
    expect(getDataVersion()).toBe('init0000');
    expect(queries.some((q) => /CREATE TABLE raw_parquet__staging_/i.test(q))).toBe(true);
  });
});
