import { describe, it, expect } from 'vitest';
import { ensureArray, buildFlowParams } from './customerFlow';

describe('ensureArray · 防御性数组归一', () => {
  it('已是数组 → 原样返回（同一引用，不复制）', () => {
    const arr = [1, 2, 3];
    expect(ensureArray<number>(arr)).toBe(arr); // 锁 `return value as T[]` 不 clone
    expect(ensureArray<number>([])).toEqual([]);
  });

  it('null / undefined → []', () => {
    expect(ensureArray(null)).toEqual([]);
    expect(ensureArray(undefined)).toEqual([]);
  });

  it('原始值（数字 / 字符串 / 布尔）→ []', () => {
    expect(ensureArray(42)).toEqual([]);
    expect(ensureArray('abc')).toEqual([]);
    expect(ensureArray(true)).toEqual([]);
  });

  it('DuckDB LIST 序列化为 { items: [...] } → 取 items', () => {
    expect(ensureArray<number>({ items: [1, 2] })).toEqual([1, 2]);
  });

  it('数字键对象（无 items）→ Object.values', () => {
    expect(ensureArray<number>({ 0: 10, 1: 20 })).toEqual([10, 20]);
    expect(ensureArray({})).toEqual([]);
  });

  it('items 非数组 → 回退 Object.values（含该非数组值）', () => {
    expect(ensureArray<string>({ items: 'x' })).toEqual(['x']);
  });
});

describe('buildFlowParams · 年份 → 查询参数', () => {
  it('空年份 → undefined（不带筛选）', () => {
    expect(buildFlowParams('')).toBeUndefined();
  });

  it('有年份 → { year }', () => {
    expect(buildFlowParams('2026')).toEqual({ year: '2026' });
  });
});
