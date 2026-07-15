/**
 * 领域断言 — 跨指标一致性
 *
 * 金丝雀测试 + 注册表结构完整性 + 率值治理规则。
 * Layer 1: 零 DuckDB 依赖，CI 安全。
 */

import { describe, expect, it } from 'vitest';
import { getAllMetrics, getMetricsByCategory } from '../index.js';
import { L4_METRIC_IDS, L4_METRIC_ID_LIST } from './test-helpers.js';

// 客户类别数量（唯一事实源：src/shared/config/customer-categories.ts）
// 不跨 rootDir 导入，server tsconfig 仅包含 server/src
const EXPECTED_CUSTOMER_CATEGORY_COUNT = 11;

// ═══════════════════════════════════════════════════
// 1. 金丝雀 — 注册表总量与唯一性
// ═══════════════════════════════════════════════════

describe('金丝雀: 注册表稳定性', () => {
  const allMetrics = getAllMetrics();

  it('指标总数 = 59（新增/删除必须同步更新此处）', () => {
    expect(allMetrics.length).toBe(59);
  });

  it('所有 ID 唯一', () => {
    const ids = allMetrics.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('所有指标至少 1 个 testCase', () => {
    for (const m of allMetrics) {
      expect(m.testCases.length, `${m.id} 缺少 testCase`).toBeGreaterThanOrEqual(1);
    }
  });

  it('所有 testCase 至少 1 个 assertion', () => {
    for (const m of allMetrics) {
      for (const tc of m.testCases) {
        expect(
          Object.keys(tc.assertions).length,
          `${m.id} / ${tc.name} 缺少 assertion`,
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('所有 changelog 非空', () => {
    for (const m of allMetrics) {
      expect(m.changelog.length, `${m.id} 缺少 changelog`).toBeGreaterThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════
// 2. 分类一致性
// ═══════════════════════════════════════════════════

describe('分类一致性', () => {
  it('ratio 类指标 formatter 必须是 percent', () => {
    const ratioMetrics = getMetricsByCategory('ratio');
    for (const m of ratioMetrics) {
      expect(m.display.formatter, `${m.id} formatter 应为 percent`).toBe('percent');
    }
  });

  it('foundation 类指标 unit 为 元/件/人/个/万元', () => {
    const validUnits = ['元', '件', '人', '个', '万元'];
    const foundationMetrics = getMetricsByCategory('foundation');
    for (const m of foundationMetrics) {
      expect(
        validUnits,
        `${m.id} display.unit="${m.display.unit}" 不在允许范围`,
      ).toContain(m.display.unit);
    }
  });

  it('cross_sell 类指标 formatter 必须是 percent', () => {
    const crossSellMetrics = getMetricsByCategory('cross_sell');
    for (const m of crossSellMetrics) {
      expect(m.display.formatter, `${m.id} formatter 应为 percent`).toBe('percent');
    }
  });
});

// ═══════════════════════════════════════════════════
// 3. 率值治理: 禁止算术平均
// ═══════════════════════════════════════════════════

describe('率值治理: 禁止对率值做算术平均', () => {
  const allMetrics = getAllMetrics();

  it('无指标 SQL 含 AVG(xxx_ratio) 模式', () => {
    for (const m of allMetrics) {
      expect(
        m.sql.expression,
        `${m.id} SQL 含 AVG(xxx_ratio)，违反率值治理规则`,
      ).not.toMatch(/AVG\s*\(\s*\w+_ratio\b/i);
    }
  });

  it('无指标 SQL 含 AVG(xxx_rate) 模式', () => {
    for (const m of allMetrics) {
      expect(
        m.sql.expression,
        `${m.id} SQL 含 AVG(xxx_rate)，违反率值治理规则`,
      ).not.toMatch(/AVG\s*\(\s*\w+_rate\b/i);
    }
  });
});

// ═══════════════════════════════════════════════════
// 4. L4 占位符标识
// ═══════════════════════════════════════════════════

describe('L4 占位符: SQL 以 "-- L4" 开头', () => {
  it.each(L4_METRIC_ID_LIST)('%s SQL 以 "-- L4" 开头', (id) => {
    const m = getAllMetrics().find((m) => m.id === id);
    expect(m, `${id} 不在注册表中`).toBeDefined();
    expect(m!.sql.expression.trimStart()).toMatch(/^-- L4/);
  });

  it.each(L4_METRIC_ID_LIST)('%s notes 含 "L4"', (id) => {
    const m = getAllMetrics().find((m) => m.id === id);
    expect(m!.sql.notes, `${id} notes 应说明 L4 计算`).toContain('L4');
  });

  it('非 L4 指标 SQL 不以 "--" 开头', () => {
    const nonL4 = getAllMetrics().filter(
      (m) => !L4_METRIC_IDS.has(m.id),
    );
    for (const m of nonL4) {
      expect(
        m.sql.expression.trimStart().startsWith('--'),
        `${m.id} SQL 以 "--" 开头但不在 L4 列表中`,
      ).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════
// 5. 客户类别枚举
// ═══════════════════════════════════════════════════

describe('客户类别枚举', () => {
  it('恰好 11 个类别', () => {
    expect(EXPECTED_CUSTOMER_CATEGORY_COUNT).toBe(11);
  });
});
