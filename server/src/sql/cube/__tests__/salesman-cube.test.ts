/**
 * 业务员立方体 SQL 模块单元测试（纯字符串级，CI 可跑）
 * 数据级等值见集成测试 services/__tests__/duckdb-cube-salesman.test.ts（仅本地）。
 */
import { describe, expect, it } from 'vitest';
import {
  SALESMAN_CUBE_TABLE,
  buildSalesmanCubeSql,
  isSalesmanCubeServable,
  rewriteSalesmanSqlForCube,
  generateSalesmanRankingCubeQuery,
} from '../salesman-cube.js';

describe('isSalesmanCubeServable', () => {
  it('业务员/机构/签单日窗/类别/吨位/布尔筛选 → 可服务', () => {
    for (const where of [
      '1=1',
      "1=1 AND salesman_name IN ('张三', '李四')",
      "1=1 AND org_level_3 = '天府' AND policy_date >= '2026-01-01' AND policy_date <= '2026-05-31'",
      "1=1 AND customer_category LIKE '营业%' AND tonnage_segment = '2-9吨'",
      "1=1 AND is_renewal = true AND is_nev = false AND insurance_type = '商业保险'",
    ]) {
      expect(isSalesmanCubeServable(where).servable).toBe(true);
    }
  });

  it('起保日窗（未纳入粒度）/ 立方体外列 → 回退', () => {
    for (const where of [
      "1=1 AND insurance_start_date >= '2026-01-01'",
      "1=1 AND coverage_combination = '主全'",
      "1=1 AND vehicle_model LIKE '%自卸%'",
      "1=1 AND fuel_type LIKE '天然气%'",
      "1=1 AND insurance_grade IN ('A')",
      "1=1 AND renewal_mode IS NULL",
    ]) {
      expect(isSalesmanCubeServable(where).servable).toBe(false);
    }
  });
});

describe('buildSalesmanCubeSql', () => {
  it('日粒度签单日 + 业务员/机构/优质业务条件所需维度 + 可加度量', () => {
    const sql = buildSalesmanCubeSql(false);
    expect(sql).toContain(`CREATE OR REPLACE TABLE ${SALESMAN_CUBE_TABLE}`);
    expect(sql).toContain('CAST(policy_date AS DATE) AS policy_date');
    expect(sql).toContain('salesman_name');
    // QUALITY_BUSINESS_CONDITION 引用的三列必须在粒度内
    expect(sql).toContain('customer_category');
    expect(sql).toContain('tonnage_segment');
    expect(sql).toContain('is_nev');
    expect(sql).toContain('SUM(premium) AS premium_sum');
    expect(sql).toContain('COUNT(*) AS row_cnt');
    expect(sql).toContain('GROUP BY ALL');
    expect(sql).not.toContain('branch_code');
    expect(buildSalesmanCubeSql(true)).toContain('branch_code');
  });
});

describe('rewriteSalesmanSqlForCube / generateSalesmanRankingCubeQuery', () => {
  for (const rankingType of ['all', 'quality'] as const) {
    it(`${rankingType} 排名：机械替换零残留 + 排序/LIMIT 保留`, () => {
      const cube = generateSalesmanRankingCubeQuery(rankingType, "1=1 AND org_level_3 = '天府'", 20);
      expect(cube).toContain(`FROM ${SALESMAN_CUBE_TABLE}`);
      expect(cube).toContain('SUM(premium_sum) as total_premium');
      expect(cube).toContain('SUM(row_cnt) as policy_count');
      expect(cube).toContain('ORDER BY total_premium DESC');
      // Tie-break：两人保费相等时排序须确定（防 burn-in 抓到的 cube vs legacy 第 N 名差异，PR #9）
      expect(cube).toContain('ORDER BY total_premium DESC, salesman_name ASC, org_level_3 ASC');
      expect(cube).toContain('LIMIT 20');
      expect(cube).not.toMatch(/\bPolicyFact\b/);
      expect(cube).not.toMatch(/\bSUM\(premium\)/);
      expect(cube).not.toMatch(/\bCOUNT\(/);
    });
  }

  it('quality 排名保留优质业务条件（条件列全在立方体粒度内）', () => {
    const cube = generateSalesmanRankingCubeQuery('quality', '1=1', 10);
    expect(cube).toContain("tonnage_segment IN ('1吨以下', '2-9吨')");
    expect(cube).toContain('is_nev = false');
  });

  it('模板漂移 fail-fast：COUNT(DISTINCT / 模式次数对不上即抛错', () => {
    expect(() => rewriteSalesmanSqlForCube('SELECT COUNT(DISTINCT policy_no) FROM PolicyFact'))
      .toThrow(/COUNT\(DISTINCT/);
    expect(() => rewriteSalesmanSqlForCube('SELECT SUM(premium) FROM PolicyFact JOIN PolicyFact'))
      .toThrow(/改写断言失败/);
    expect(() => rewriteSalesmanSqlForCube('SELECT 1 FROM SomewhereElse'))
      .toThrow(/改写断言失败/);
  });
});
