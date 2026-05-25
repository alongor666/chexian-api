/**
 * 单元测试：generatePivotQuery
 *
 * 覆盖：
 *   - 1 维 + 1 指标的最小 SQL
 *   - 2 维 + 多指标
 *   - 维度数量越界（1-2 之外）抛错
 *   - 指标数量越界（1-10 之外）抛错
 *   - getMetricSql 调用：指标 id 未注册时由 registry 抛错
 *   - WHERE 子句正确拼接
 */
import { describe, expect, it } from 'vitest';
import { generatePivotQuery, type PivotDimension } from '../pivot.js';

const dim = (id: string, sqlExpr = id): PivotDimension => ({ id, sqlExpr });

describe('generatePivotQuery', () => {
  it('1 维 + 1 指标：基本骨架', () => {
    const sql = generatePivotQuery({
      dimensions: [dim('org_level_3')],
      metricIds: ['total_premium'],
      whereClause: '1=1',
      limit: 100,
    });
    expect(sql).toContain('SELECT org_level_3 AS org_level_3');
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('WHERE 1=1');
    expect(sql).toMatch(/GROUP BY\s+1\b/);
    expect(sql).toMatch(/ORDER BY\s+total_premium\s+DESC/);
    expect(sql).toMatch(/LIMIT\s+100/);
    // 指标 SQL 应来自 registry（含 SUM(premium) as total_premium）
    expect(sql).toMatch(/SUM\(premium\)\s+as\s+total_premium/i);
  });

  it('2 维 + 多指标：GROUP BY 1, 2', () => {
    const sql = generatePivotQuery({
      dimensions: [
        dim('week_number'),
        dim('coverage_combination'),
      ],
      metricIds: ['total_premium', 'policy_count'],
      whereClause: "policy_date >= '2026-01-01'",
      limit: 500,
    });
    expect(sql).toContain('week_number AS week_number');
    expect(sql).toContain('coverage_combination AS coverage_combination');
    expect(sql).toMatch(/GROUP BY\s+1,\s*2/);
    expect(sql).toMatch(/LIMIT\s+500/);
    expect(sql).toContain("policy_date >= '2026-01-01'");
  });

  it('维度为 CASE 表达式（is_renewal）— sqlExpr 正确嵌入', () => {
    const sql = generatePivotQuery({
      dimensions: [dim('is_renewal', "CASE WHEN is_renewal THEN '续保' ELSE '新保' END")],
      metricIds: ['total_premium'],
      whereClause: '1=1',
      limit: 100,
    });
    expect(sql).toContain("CASE WHEN is_renewal THEN '续保' ELSE '新保' END AS is_renewal");
  });

  it('0 维拒绝', () => {
    expect(() =>
      generatePivotQuery({
        dimensions: [],
        metricIds: ['total_premium'],
        whereClause: '1=1',
        limit: 100,
      })
    ).toThrow(/dimensions must be 1-2/);
  });

  it('3 维拒绝', () => {
    expect(() =>
      generatePivotQuery({
        dimensions: [dim('a'), dim('b'), dim('c')],
        metricIds: ['total_premium'],
        whereClause: '1=1',
        limit: 100,
      })
    ).toThrow(/dimensions must be 1-2/);
  });

  it('0 指标拒绝', () => {
    expect(() =>
      generatePivotQuery({
        dimensions: [dim('org_level_3')],
        metricIds: [],
        whereClause: '1=1',
        limit: 100,
      })
    ).toThrow(/metrics must be 1-10/);
  });

  it('>10 指标拒绝', () => {
    expect(() =>
      generatePivotQuery({
        dimensions: [dim('org_level_3')],
        metricIds: Array(11).fill('total_premium'),
        whereClause: '1=1',
        limit: 100,
      })
    ).toThrow(/metrics must be 1-10/);
  });

  it('未注册的指标 id — getMetricSql 抛错', () => {
    expect(() =>
      generatePivotQuery({
        dimensions: [dim('org_level_3')],
        metricIds: ['totally_made_up_metric'],
        whereClause: '1=1',
        limit: 100,
      })
    ).toThrow(/Metric not found/);
  });
});
