import { beforeEach, describe, expect, it } from 'vitest';
import { DataBootstrapper, type BootstrapDuckDB } from '../data-bootstrapper.js';
import {
  getDataVersion,
  onDataVersionChange,
  _resetDataVersionForTesting,
  type DataVersionScope,
} from '../data-version.js';

function createFakeDb(rowCount: number) {
  let invalidated = 0;
  const queries: string[] = [];
  const db: BootstrapDuckDB = {
    async loadParquet() {
      return { versionToken: 'fake0000token' };
    },
    async loadMultipleParquet() {
      return { totalRows: 0, versionToken: 'fake0000token' };
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
  beforeEach(() => {
    _resetDataVersionForTesting();
  });

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

  it('B311：辅助域 reload 仍 bump 版本（ETag/route-cache 正确性），但 scope=domains（监听者跳过全量预热）', async () => {
    const fake = createFakeDb(1);
    const bootstrapper = new DataBootstrapper(fake.db);
    (bootstrapper as any).lazyRegistry.register('CustomerFlow', async () => {});

    const scopes: DataVersionScope[] = [];
    onDataVersionChange((_next, _prev, scope) => {
      scopes.push(scope);
    });

    expect(getDataVersion()).toBe('init0000');
    await bootstrapper.reloadDomains(['customer_flow']);
    await new Promise((r) => setImmediate(r));

    // 版本必须前进（不 bump 会让持旧 ETag 的客户端对新辅助域数据永久 304）
    expect(getDataVersion()).not.toBe('init0000');
    // 但作用域降为 domains，app.ts 监听者据此跳过全量预热风暴
    expect(scopes).toEqual(['domains']);
  });
});
