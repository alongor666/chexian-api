/**
 * PR #82 回溯回归：Parquet 读取失败不得先删除仍可服务的旧 relation。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';

const instances: DuckDBService[] = [];
const tempDir = mkdtempSync(join(tmpdir(), 'duckdb-parquet-swap-'));

async function createDb(): Promise<DuckDBService> {
  const db = createDuckDBService({ path: ':memory:' });
  instances.push(db);
  await db.init();
  await db.query('CREATE TABLE raw_parquet AS SELECT 7::INTEGER AS id');
  return db;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((db) => db.close().catch(() => {})));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function expectOldRelationIntact(db: DuckDBService): Promise<void> {
  const rows = await db.query<{ id: number }>('SELECT id FROM raw_parquet');
  expect(rows).toEqual([{ id: 7 }]);

  const staging = await db.query<{ cnt: number }>(`
    SELECT COUNT(*) AS cnt
    FROM information_schema.tables
    WHERE table_name LIKE 'raw_parquet__staging_%'
  `);
  expect(staging[0].cnt).toBe(0);
}

describe('Parquet relation 原子换表', () => {
  it('单文件读取失败时保留旧 raw_parquet', async () => {
    const db = await createDb();

    await expect(db.loadParquet('/definitely/missing/single.parquet')).rejects.toThrow();

    await expectOldRelationIntact(db);
  });

  it('多文件全量重建失败时保留旧 raw_parquet', async () => {
    const db = await createDb();

    await expect(db.loadMultipleParquet(['/definitely/missing/multiple.parquet']))
      .rejects.toThrow(/Parquet loading failed/);

    await expectOldRelationIntact(db);
  });

  it('新 Parquet 读取成功后可在同一事务内完成 VIEW 到 TABLE 换型', async () => {
    const db = await createDb();
    const parquetPath = join(tempDir, 'replacement.parquet').replace(/'/g, "''");
    await db.query(`COPY (SELECT 9::INTEGER AS id) TO '${parquetPath}' (FORMAT PARQUET)`);
    await db.query('DROP TABLE raw_parquet');
    await db.query('CREATE VIEW raw_parquet AS SELECT 7::INTEGER AS id');

    await db.loadParquet(parquetPath);

    expect(await db.query<{ id: number }>('SELECT id FROM raw_parquet')).toEqual([{ id: 9 }]);
    const relation = await db.query<{ table_type: string }>(`
      SELECT table_type FROM information_schema.tables WHERE table_name = 'raw_parquet'
    `);
    expect(relation[0].table_type).toBe('BASE TABLE');
  });

  it('64 字符合法目标表名仍能生成合规 staging 名并完成换表', async () => {
    const db = await createDb();
    const tableName = `t${'x'.repeat(63)}`;
    const parquetPath = join(tempDir, 'long-name.parquet').replace(/'/g, "''");
    await db.query(`COPY (SELECT 11::INTEGER AS id) TO '${parquetPath}' (FORMAT PARQUET)`);
    await db.query(`CREATE TABLE ${tableName} AS SELECT 7::INTEGER AS id`);

    await db.loadParquet(parquetPath, tableName);

    expect(await db.query<{ id: number }>(`SELECT id FROM ${tableName}`)).toEqual([{ id: 11 }]);
  });
});
