import { describe, expect, it } from 'vitest';
import { DataBootstrapper, type BootstrapDuckDB } from '../data-bootstrapper.js';

function createFakeDb(rowCount: number) {
  let invalidated = 0;
  const queries: string[] = [];
  const db: BootstrapDuckDB = {
    async loadParquet() {},
    async loadMultipleParquet() {
      return { totalRows: 0 };
    },
    async query<T = any>(sql: string): Promise<T[]> {
      queries.push(sql);
      if (/COUNT\(\*\) AS cnt FROM CustomerFlow/i.test(sql)) {
        return [{ cnt: rowCount }] as T[];
      }
      return [] as T[];
    },
    async getTableSchema() {
      return [];
    },
    async hasRelation() {
      return false;
    },
    async dropRelationIfExists() {},
    invalidateCache() {
      invalidated++;
    },
  };

  return {
    db,
    get invalidated() {
      return invalidated;
    },
    queries,
  };
}

describe('DataBootstrapper.reloadDomains', () => {
  it('重载指定 full_snapshot lazy 域，并使查询缓存失效', async () => {
    const fake = createFakeDb(185476);
    const bootstrapper = new DataBootstrapper(fake.db);
    let loaderCalls = 0;

    (bootstrapper as any).lazyRegistry.register('CustomerFlow', async () => {
      loaderCalls++;
    });

    const results = await bootstrapper.reloadDomains(['customer_flow']);

    expect(loaderCalls).toBe(1);
    expect(results).toEqual([
      {
        domain: 'customer_flow',
        lazyName: 'CustomerFlow',
        relation: 'CustomerFlow',
        rowCount: 185476,
        state: 'loaded',
      },
    ]);
    expect(fake.invalidated).toBe(1);
    expect(fake.queries).toContain('SELECT COUNT(*) AS cnt FROM CustomerFlow');
  });

  it('拒绝未登记为可热重载的域', async () => {
    const fake = createFakeDb(0);
    const bootstrapper = new DataBootstrapper(fake.db);

    await expect(bootstrapper.reloadDomains(['policy'])).rejects.toThrow('Unsupported data reload domain');
  });
});
