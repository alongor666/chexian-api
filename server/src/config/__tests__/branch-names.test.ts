/**
 * branch-names helper 函数单测（plan v2 Phase 0E SQL 拔硬编码）
 */
import { describe, it, expect } from 'vitest';
import { BRANCH_NAMES, getBranchChineseName, getBranchCompanyName } from '../branch-names.js';

describe('BRANCH_NAMES 映射表', () => {
  it('当前条目：仅 SC=四川（SX 等待山西上线时启用）', () => {
    expect(BRANCH_NAMES.SC).toBe('四川');
  });
});

describe('getBranchChineseName', () => {
  it('已注册 code → 对应省份名', () => {
    expect(getBranchChineseName('SC')).toBe('四川');
  });

  it('null / undefined → 全国（系统级超管视角）', () => {
    expect(getBranchChineseName(null)).toBe('全国');
    expect(getBranchChineseName(undefined)).toBe('全国');
  });

  it('空字符串 → 全国（视同未指定）', () => {
    expect(getBranchChineseName('')).toBe('全国');
  });

  it('未注册 code → fallback 用 code 自身（避免直接抛错）', () => {
    expect(getBranchChineseName('XX')).toBe('XX');
  });
});

describe('getBranchCompanyName', () => {
  it('已注册 code → 省份+分公司', () => {
    expect(getBranchCompanyName('SC')).toBe('四川分公司');
  });

  it('null / undefined → 全国汇总', () => {
    expect(getBranchCompanyName(null)).toBe('全国汇总');
    expect(getBranchCompanyName(undefined)).toBe('全国汇总');
  });

  it('未注册 code → code+分公司（兜底）', () => {
    expect(getBranchCompanyName('XX')).toBe('XX分公司');
  });
});
