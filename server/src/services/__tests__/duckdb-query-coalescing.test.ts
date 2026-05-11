import { describe, expect, it } from 'vitest';
import type { DuckDBConnection } from '@duckdb/node-api';
import { DuckDBService } from '../duckdb.js';
import { QueryCache } from '../duckdb-infra.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeReader(rows: unknown[]) {
  return {
    getRowObjects: () => rows,
  };
}

function makeService(conn: Pick<DuckDBConnection, 'runAndReadAll'>) {
  const service = new DuckDBService({ path: ':memory:' });
  const pool = {
    acquire: async () => conn,
    release: () => undefined,
  };

  (service as unknown as { connectionPool: typeof pool }).connectionPool = pool;
  (service as unknown as { queryCache: QueryCache }).queryCache = new QueryCache();
  return service;
}

describe('DuckDBService query in-flight coalescing', () => {
  it('coalesces concurrent cacheable queries with the same SQL into one DuckDB execution', async () => {
    const gate = deferred<void>();
    let runCount = 0;
    const conn = {
      runAndReadAll: async () => {
        runCount += 1;
        await gate.promise;
        return makeReader([{ answer: 42 }]);
      },
    } as unknown as DuckDBConnection;
    const service = makeService(conn);

    const pending = Array.from({ length: 20 }, () =>
      service.query<{ answer: number }>('SELECT 42 AS answer', 60_000)
    );
    await Promise.resolve();
    gate.resolve();

    const results = await Promise.all(pending);

    expect(runCount).toBe(1);
    expect(results).toHaveLength(20);
    expect(results.every((result) => result[0]?.answer === 42)).toBe(true);
  });

  it('does not cache failed in-flight queries and retries the next same SQL request', async () => {
    let runCount = 0;
    const conn = {
      runAndReadAll: async () => {
        runCount += 1;
        if (runCount === 1) throw new Error('transient duckdb failure');
        return makeReader([{ ok: true }]);
      },
    } as unknown as DuckDBConnection;
    const service = makeService(conn);

    await expect(service.query('SELECT fail_once()', 60_000)).rejects.toThrow('查询执行失败');
    const result = await service.query<{ ok: boolean }>('SELECT fail_once()', 60_000);

    expect(runCount).toBe(2);
    expect(result).toEqual([{ ok: true }]);
  });

  it('does not write an in-flight result into cache after cache invalidation', async () => {
    const gate = deferred<void>();
    let runCount = 0;
    const conn = {
      runAndReadAll: async () => {
        runCount += 1;
        if (runCount === 1) {
          await gate.promise;
          return makeReader([{ version: 'old' }]);
        }
        return makeReader([{ version: 'new' }]);
      },
    } as unknown as DuckDBConnection;
    const service = makeService(conn);

    const pending = service.query<{ version: string }>('SELECT versioned_value', 60_000);
    await Promise.resolve();
    service.invalidateCache({ silent: true });
    gate.resolve();

    expect(await pending).toEqual([{ version: 'old' }]);
    expect(await service.query<{ version: string }>('SELECT versioned_value', 60_000)).toEqual([{ version: 'new' }]);
    expect(runCount).toBe(2);
  });

  it('does not coalesce non-cacheable queries', async () => {
    let runCount = 0;
    const conn = {
      runAndReadAll: async () => {
        runCount += 1;
        return makeReader([{ run: runCount }]);
      },
    } as unknown as DuckDBConnection;
    const service = makeService(conn);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.query<{ run: number }>('SELECT random()', 0))
    );

    expect(runCount).toBe(5);
    expect(results.map((result) => result[0]?.run).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
