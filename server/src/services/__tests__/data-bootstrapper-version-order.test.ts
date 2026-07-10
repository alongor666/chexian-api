/**
 * B311 时序锁定测试：dataVersion 提交必须晚于 PolicyFact 物化。
 *
 * 竞态背景：setDataVersion 会同步唤醒 onDataVersionChange 监听者（cache-warmer 预热）。
 * 若版本 bump 发生在 loadParquet/loadMultipleParquet 内部（即 createPolicyFactView 之前），
 * 监听者会预热查询「raw_parquet 已重建、PolicyFact 尚未重建」的中间态视图。
 *
 * 本测试用 mock 物化模块记录「物化时刻的当前版本」，锁死顺序：
 *   加载 → 物化（此刻版本仍是旧值）→ setDataVersion(versionToken)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  order: [] as string[],
  versionAtMaterialize: '',
}));

vi.mock('../duckdb-materialization.js', () => ({
  createPolicyFactView: async () => {
    const { getDataVersion } = await import('../data-version.js');
    state.versionAtMaterialize = getDataVersion();
    state.order.push('materialize');
  },
  createCrossSellRealtimeView: async () => {},
}));

import { DataBootstrapper, type BootstrapDuckDB } from '../data-bootstrapper.js';
import { getDataVersion, _resetDataVersionForTesting } from '../data-version.js';

function createFakeDb(): BootstrapDuckDB {
  return {
    async loadParquet() {
      state.order.push('load');
      return { versionToken: 'deadbeef00000000' };
    },
    async loadMultipleParquet() {
      state.order.push('load');
      return { totalRows: 3, versionToken: 'cafebabe12345678' };
    },
    async query<T = any>(sql: string): Promise<T[]> {
      if (/COUNT\(\*\) as count FROM PolicyFact/i.test(sql)) {
        return [{ count: 3 }] as T[];
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
    invalidateCache() {},
  };
}

const FILE_A = { name: 'a.parquet', path: '/tmp/a.parquet', size: 1, mtimeMs: 1 };
const FILE_B = { name: 'b.parquet', path: '/tmp/b.parquet', size: 1, mtimeMs: 1 };

describe('DataBootstrapper.loadCoreData 版本提交时序（B311）', () => {
  beforeEach(() => {
    _resetDataVersionForTesting();
    state.order.length = 0;
    state.versionAtMaterialize = '';
  });

  it('多文件路径：加载 → 物化（版本仍为旧值）→ 提交新版本', async () => {
    const bootstrapper = new DataBootstrapper(createFakeDb());

    const rowCount = await (bootstrapper as any).loadCoreData([FILE_A, FILE_B]);

    expect(rowCount).toBe(3);
    expect(state.order).toEqual(['load', 'materialize']);
    // 物化执行时版本尚未 bump —— 监听者此刻即使被唤醒也不可能查到中间态
    expect(state.versionAtMaterialize).toBe('init0000');
    // 物化完成后版本才提交为加载器返回的 token（取前 8 字符）
    expect(getDataVersion()).toBe('cafebabe');
  });

  it('单文件路径：同样先物化后提交版本', async () => {
    const bootstrapper = new DataBootstrapper(createFakeDb());

    await (bootstrapper as any).loadCoreData([FILE_A]);

    expect(state.order).toEqual(['load', 'materialize']);
    expect(state.versionAtMaterialize).toBe('init0000');
    expect(getDataVersion()).toBe('deadbeef');
  });
});
