/**
 * where-matrix.test.mjs — buildWhereMatrix 单元测试
 *
 * 覆盖：
 *   - 三层 tier 各自的矩阵大小
 *   - filter 对象的字段形状
 *   - 边界值：undefined 布尔态不出现在 filter 中
 *   - 笛卡尔层级递推关系
 *   - 未知 tier 抛出异常
 */

import { describe, it, expect } from 'vitest';
import {
  buildWhereMatrix,
  TIER_BASIC,
  TIER_ORG,
  TIER_CROSS,
} from '../lib/where-matrix.mjs';

// ─── TIER_BASIC ───────────────────────────────────────────────────

describe('buildWhereMatrix(basic) — 基础三态矩阵', () => {
  it('返回恰好 99 个 filter 对象（11 类 × 3 is_nev × 3 is_renewal）', () => {
    const matrix = buildWhereMatrix(TIER_BASIC);
    expect(matrix).toHaveLength(99);
  });

  it('每个 filter 都含有 customerCategories 字段', () => {
    const matrix = buildWhereMatrix(TIER_BASIC);
    for (const f of matrix) {
      expect(f).toHaveProperty('customerCategories');
      expect(typeof f.customerCategories).toBe('string');
    }
  });

  it('每个 filter 都含有 cutoffDate（cost route 必传，YYYY-MM-DD 形式）', () => {
    const matrix = buildWhereMatrix(TIER_BASIC);
    for (const f of matrix) {
      expect(f).toHaveProperty('cutoffDate');
      expect(f.cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('buildWhereMatrix 接受 cutoffDate 参数，注入所有 filter', () => {
    const matrix = buildWhereMatrix(TIER_BASIC, '2026-06-10');
    for (const f of matrix) {
      expect(f.cutoffDate).toBe('2026-06-10');
    }
  });

  it('布尔字段 isNev / isRenewal 取值为 "true" | "false" 或不存在（不出现 "undefined"）', () => {
    const matrix = buildWhereMatrix(TIER_BASIC);
    for (const f of matrix) {
      if ('isNev' in f) {
        expect(['true', 'false']).toContain(f.isNev);
      }
      if ('isRenewal' in f) {
        expect(['true', 'false']).toContain(f.isRenewal);
      }
      // 字符串 "undefined" 不得出现
      expect(f.isNev).not.toBe('undefined');
      expect(f.isRenewal).not.toBe('undefined');
    }
  });

  it('basic 层不含 orgNames / fuelCategory / tonnageSegments', () => {
    const matrix = buildWhereMatrix(TIER_BASIC);
    for (const f of matrix) {
      expect(f).not.toHaveProperty('orgNames');
      expect(f).not.toHaveProperty('fuelCategory');
      expect(f).not.toHaveProperty('tonnageSegments');
    }
  });

  it('11 个 customerCategories 各出现恰好 9 次（3×3 布尔组合）', () => {
    const matrix = buildWhereMatrix(TIER_BASIC);
    const counts = {};
    for (const f of matrix) {
      counts[f.customerCategories] = (counts[f.customerCategories] || 0) + 1;
    }
    for (const count of Object.values(counts)) {
      expect(count).toBe(9);
    }
    expect(Object.keys(counts)).toHaveLength(11);
  });
});

// ─── TIER_ORG ─────────────────────────────────────────────────────

describe('buildWhereMatrix(org) — 加机构层', () => {
  it('返回恰好 297 个 filter 对象（99 basic × 3 机构）', () => {
    const matrix = buildWhereMatrix(TIER_ORG);
    expect(matrix).toHaveLength(297);
  });

  it('每个 filter 都含有 orgNames 字段，值为代表性机构之一', () => {
    const matrix = buildWhereMatrix(TIER_ORG);
    const orgs = new Set(['成都市分公司', '天府分公司', '高新分公司']);
    for (const f of matrix) {
      expect(f).toHaveProperty('orgNames');
      expect(orgs.has(f.orgNames)).toBe(true);
    }
  });

  it('org 层包含 customerCategories + orgNames，不含 fuelCategory', () => {
    const matrix = buildWhereMatrix(TIER_ORG);
    for (const f of matrix) {
      expect(f).toHaveProperty('customerCategories');
      expect(f).toHaveProperty('orgNames');
      expect(f).not.toHaveProperty('fuelCategory');
    }
  });
});

// ─── TIER_CROSS ───────────────────────────────────────────────────

describe('buildWhereMatrix(cross) — 加燃料×吨位层', () => {
  it('返回恰好 3564 个 filter 对象（297 org × 3 fuel × 4 tonnage）', () => {
    const matrix = buildWhereMatrix(TIER_CROSS);
    expect(matrix).toHaveLength(3564);
  });

  it('每个 filter 都含有 fuelCategory 和 tonnageSegments', () => {
    const matrix = buildWhereMatrix(TIER_CROSS);
    const validFuels = new Set(['oil', 'gas', 'electric']);
    const validTons  = new Set(['1吨以下', '1-2吨', '2-9吨', '10吨以上']);
    for (const f of matrix) {
      expect(validFuels.has(f.fuelCategory)).toBe(true);
      expect(validTons.has(f.tonnageSegments)).toBe(true);
    }
  });

  it('cross 层数量是 org 层的 12 倍（3 fuel × 4 tonnage）', () => {
    const org   = buildWhereMatrix(TIER_ORG);
    const cross = buildWhereMatrix(TIER_CROSS);
    expect(cross.length).toBe(org.length * 12);
  });
});

// ─── 异常路径 ─────────────────────────────────────────────────────

describe('buildWhereMatrix — 异常输入', () => {
  it('未知 tier 抛出含提示信息的 Error', () => {
    expect(() => buildWhereMatrix('ultra')).toThrow(/未知 tier/);
  });

  it('空字符串 tier 抛出 Error', () => {
    expect(() => buildWhereMatrix('')).toThrow();
  });
});
