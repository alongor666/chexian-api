/**
 * preset-users helper 函数单测。
 * 0B：getAllBranchCodes — cache-warmer 按 branch 预热的循环源头。
 */
import { describe, it, expect } from 'vitest';
import { PRESET_USERS, getAllBranchCodes, getAllPermissionScopes } from '../preset-users.js';

describe('getAllBranchCodes', () => {
  it('返回 PRESET_USERS 中所有唯一 branchCode（已排序）', () => {
    const codes = getAllBranchCodes();
    expect(Array.isArray(codes)).toBe(true);
    // PR #492 把所有 20 个 preset 用户标 'SC'，PR-3 时点应只返回 ['SC']
    expect(codes).toEqual(['SC']);
  });

  it('结果为 PRESET_USERS 中所有 branchCode 字段的去重 + 字典序排序', () => {
    const codes = getAllBranchCodes();
    const setFromPresets = new Set<string>();
    for (const u of Object.values(PRESET_USERS)) {
      if (u.branchCode) setFromPresets.add(u.branchCode);
    }
    const sortedFromPresets = Array.from(setFromPresets).sort();
    expect(codes).toEqual(sortedFromPresets);
  });

  it('排序确定性：多次调用返回相同顺序', () => {
    expect(getAllBranchCodes()).toEqual(getAllBranchCodes());
  });

  it('与 getAllPermissionScopes 是正交维度（branch ≠ org scope）', () => {
    const branches = getAllBranchCodes();
    const scopes = getAllPermissionScopes();
    // 两者不应该有交集（branch 是 SC/SX；scope 是 all/乐山/...）
    const overlap = branches.filter((b) => scopes.includes(b));
    expect(overlap).toEqual([]);
  });
});
