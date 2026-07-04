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

  describe('满期/赔案路径（requiredColumns 含 earned_days/policy_term/reported_claims/claim_cases）', () => {
    it('earned_claim_ratio 走 CTE 路径：base → latest_context → base_dedup → earned_base', () => {
      const sql = generatePivotQuery({
        dimensions: [dim('org_level_3')],
        metricIds: ['earned_claim_ratio'],
        whereClause: '1=1',
        limit: 100,
      });
      expect(sql).toContain('WITH base AS');
      expect(sql).toContain('latest_context AS');
      expect(sql).toContain('SELECT MAX(policy_date) AS latest_policy_date FROM base');
      expect(sql).toContain('base_dedup AS');
      expect(sql).toContain('earned_base AS');
      expect(sql).toContain('LEFT JOIN ClaimsAgg ca ON b.policy_no = ca.policy_no');
      expect(sql).toContain('FROM earned_base');
      // 简单路径（裸 PolicyFact 单层聚合）不应出现
      expect(sql).not.toMatch(/^SELECT org_level_3 AS org_level_3, [\s\S]*FROM PolicyFact/);
    });

    it('维度列正确穿透 base/base_dedup/earned_base（含 CASE 表达式维度）', () => {
      const sql = generatePivotQuery({
        dimensions: [dim('is_nev', "CASE WHEN is_nev THEN '新能源' ELSE '非新能源' END")],
        metricIds: ['earned_margin_amount'],
        whereClause: '1=1',
        limit: 100,
      });
      expect(sql).toContain("CASE WHEN is_nev THEN '新能源' ELSE '非新能源' END AS is_nev");
      expect(sql).toContain('GROUP BY policy_no, insurance_start_date, is_nev');
      expect(sql).toContain('b.is_nev');
      expect(sql).toMatch(/GROUP BY\s+1\s*$/m);
    });

    it('混用简单指标 + 满期指标时整体走 CTE 路径（保证同一截止日一致口径）', () => {
      const sql = generatePivotQuery({
        dimensions: [dim('org_level_3')],
        metricIds: ['total_premium', 'policy_count', 'earned_claim_ratio'],
        whereClause: '1=1',
        limit: 100,
      });
      expect(sql).toContain('WITH base AS');
      expect(sql).toContain('FROM earned_base');
    });

    it('avg_claim_amount（reported_claims+claim_cases，非 earned_days）同样走 CTE 路径', () => {
      const sql = generatePivotQuery({
        dimensions: [dim('customer_category')],
        metricIds: ['avg_claim_amount'],
        whereClause: '1=1',
        limit: 100,
      });
      expect(sql).toContain('WITH base AS');
      expect(sql).toContain('COALESCE(ca.claim_cases, 0) AS claim_cases');
    });

    it('纯简单指标（total_premium/policy_count）不触发 CTE 路径', () => {
      const sql = generatePivotQuery({
        dimensions: [dim('org_level_3')],
        metricIds: ['total_premium', 'policy_count'],
        whereClause: '1=1',
        limit: 100,
      });
      expect(sql).not.toContain('WITH base AS');
      expect(sql).toContain('FROM PolicyFact');
    });
  });
});
