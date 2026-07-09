/**
 * 成本立方体 SQL 模块单元测试（纯字符串级，CI 可跑）
 * 数据级等值见集成测试 services/__tests__/duckdb-cube-cost.test.ts（仅本地）。
 */
import { describe, expect, it } from 'vitest';
import {
  COST_CUBE_TABLE,
  buildCostCubeSql,
  buildCostCubeProbeSql,
  isCostCubeServable,
  generateCostCubeQuery,
  type CostCubeAnalysisType,
} from '../cost-cube.js';
import {
  generateClaimRatioQuery,
  generateExpenseRatioQuery,
  generateComprehensiveCostQuery,
  generateVariableCostQuery,
} from '../../cost/cost-ratios.js';
import type { CostAnalysisConfig, CostDimension } from '../../cost/shared.js';

const config = (over: Partial<CostAnalysisConfig> = {}): CostAnalysisConfig => ({
  dimension: 'org_level_3',
  cutoffDate: '2026-05-31',
  whereClause: '1=1',
  ...over,
});

describe('isCostCubeServable', () => {
  it('五个分组维度 × 立方体内 WHERE → 全部可服务', () => {
    const dims: CostDimension[] = ['customer_category', 'org_level_3', 'coverage_combination', 'org_customer', 'org_coverage'];
    for (const dimension of dims) {
      expect(isCostCubeServable({ whereClause: '1=1', dimension }).servable).toBe(true);
    }
    expect(isCostCubeServable({
      whereClause: "1=1 AND org_level_3 IN ('天府', '乐山') AND is_renewal = true AND insurance_type = '交强险'",
      dimension: 'org_level_3',
    }).servable).toBe(true);
    expect(isCostCubeServable({
      whereClause: "1=1 AND customer_category LIKE '营业%' AND tonnage_segment = '2-9吨' AND coverage_combination IS NOT NULL",
      dimension: 'org_customer',
    }).servable).toBe(true);
  });

  it('起保日窗（日粒度格子键）→ 可服务', () => {
    expect(isCostCubeServable({
      whereClause: "1=1 AND insurance_start_date >= '2025-06-01' AND insurance_start_date <= '2026-03-31'",
      dimension: 'org_level_3',
    }).servable).toBe(true);
  });

  it('签单日窗（行级属性，批改行会被切开）→ 结构性回退', () => {
    const r = isCostCubeServable({
      whereClause: "1=1 AND policy_date >= '2026-01-01'",
      dimension: 'org_level_3',
    });
    expect(r.servable).toBe(false);
    expect(r.reason).toContain('policy_date');
  });

  it('立方体外列（业务员/车型/燃料/评分/套单）→ 回退', () => {
    for (const where of [
      "1=1 AND salesman_name = '张三'",
      "1=1 AND vehicle_model LIKE '%自卸%'",
      "1=1 AND fuel_type LIKE '天然气%'",
      "1=1 AND insurance_grade IN ('A', 'B')",
      "1=1 AND is_commercial_insure = '套单'",
      "1=1 AND renewal_mode IS NULL",
    ]) {
      expect(isCostCubeServable({ whereClause: where, dimension: 'org_level_3' }).servable).toBe(false);
    }
  });
});

describe('buildCostCubeSql / buildCostCubeProbeSql', () => {
  it('构建 SQL 返回三条语句数组（临时去重表 / 主表 / 清理）', () => {
    const sqls = buildCostCubeSql(false);
    // 方案 A：返回 [建临时表, 建主表, 清理临时表] 三元组
    expect(Array.isArray(sqls)).toBe(true);
    expect(sqls).toHaveLength(3);
    const [tempSql, mainSql, cleanupSql] = sqls;

    // 第一条：B252 去重物化到 TEMP TABLE（含去重三要素）
    expect(tempSql).toContain('CREATE OR REPLACE TEMP TABLE __cost_policy_dedup');
    expect(tempSql).toContain('GROUP BY policy_no, CAST(insurance_start_date AS DATE)');
    expect(tempSql).toContain('HAVING SUM(premium) > 0');
    expect(tempSql).not.toContain('branch_code');
    // 临时表只做去重，不含 JOIN 与格子聚合
    expect(tempSql).not.toContain('LEFT JOIN ClaimsAgg');
    expect(tempSql).not.toContain(`CREATE OR REPLACE TABLE ${COST_CUBE_TABLE}`);

    // 第二条：从轻量临时表 JOIN ClaimsAgg 聚合成格子
    expect(mainSql).toContain(`CREATE OR REPLACE TABLE ${COST_CUBE_TABLE}`);
    expect(mainSql).toContain('FROM __cost_policy_dedup d');
    expect(mainSql).toContain('LEFT JOIN ClaimsAgg');
    expect(mainSql).toContain('GROUP BY ALL');
    // 主表不再直读 PolicyFact（内存峰值根因）
    expect(mainSql).not.toContain('FROM PolicyFact');

    // 第三条：清理临时表
    expect(cleanupSql).toContain('DROP TABLE IF EXISTS __cost_policy_dedup');
  });

  it('branch_code 探测开启时纳入粒度（构建 + 探针一致）', () => {
    const [tempSql] = buildCostCubeSql(true);
    expect(tempSql).toContain('ANY_VALUE(branch_code) AS branch_code');
    expect(buildCostCubeProbeSql(true)).toContain('branch_code');
    expect(buildCostCubeProbeSql(false)).not.toContain('branch_code');
  });

  it('探针对起保日 + 每个维度列做跨格检测（NULL 哨兵参与）', () => {
    const sql = buildCostCubeProbeSql(false);
    // MIN<>MAX 与 COUNT(DISTINCT)>1 逐组等价（COALESCE 哨兵后全非 NULL），
    // 内存降一个量级（多省数据 OOM 根因修复，勿改回 COUNT(DISTINCT)）
    expect(sql).toContain('MIN(CAST(insurance_start_date AS DATE)) <> MAX(CAST(insurance_start_date AS DATE))');
    expect(sql).not.toMatch(/COUNT\(DISTINCT/i);
    expect(sql).toContain("MIN(COALESCE(CAST(org_level_3 AS VARCHAR), '__NULL__')) <> MAX(COALESCE(CAST(org_level_3 AS VARCHAR), '__NULL__'))");
    expect(sql).toContain("MIN(COALESCE(CAST(tonnage_segment AS VARCHAR), '__NULL__')) <> MAX(COALESCE(CAST(tonnage_segment AS VARCHAR), '__NULL__'))");
    // 每个维度列都进入 HAVING 变异检测
    for (const dim of ['customer_category', 'coverage_combination', 'insurance_type', 'is_renewal', 'is_nev']) {
      expect(sql).toContain(`CAST(${dim} AS VARCHAR)`);
    }
  });
});

describe('generateCostCubeQuery（输出列与 cost-ratios.ts 逐列同名）', () => {
  // 每类分析的输出别名清单 —— 同时锚定 legacy 与 cube 两边（任一边改列名即红）
  const EXPECTED_ALIASES: Record<CostCubeAnalysisType, string[]> = {
    claimRatio: [
      'dim_key', 'policy_count', 'total_premium', 'total_claim_cases', 'total_reported_claims',
      'avg_claim_amount', 'earned_premium', 'total_exposure_days', 'avg_exposure_days',
      'earned_claim_ratio', 'earned_loss_frequency',
    ],
    expenseRatio: ['dim_key', 'policy_count', 'total_premium', 'total_fee', 'expense_ratio'],
    comprehensiveCost: [
      'dim_key', 'policy_count', 'total_premium', 'total_reported_claims', 'total_fee',
      'earned_premium', 'earned_claim_ratio', 'expense_ratio', 'comprehensive_expense_ratio',
      'earned_margin_amount', 'projected_margin_amount',
    ],
    variableCost: [
      'dim_key', 'policy_count', 'total_premium', 'earned_premium', 'total_reported_claims',
      'total_fee', 'earned_claim_ratio', 'expense_ratio', 'variable_cost_ratio',
    ],
  };

  const LEGACY_GENERATORS: Record<CostCubeAnalysisType, (c: CostAnalysisConfig) => string> = {
    claimRatio: generateClaimRatioQuery,
    expenseRatio: generateExpenseRatioQuery,
    comprehensiveCost: generateComprehensiveCostQuery,
    variableCost: generateVariableCostQuery,
  };

  const TYPES = Object.keys(EXPECTED_ALIASES) as CostCubeAnalysisType[];

  for (const analysisType of TYPES) {
    it(`${analysisType}：只查立方体、零行级残留、别名两边对齐`, () => {
      const cube = generateCostCubeQuery(analysisType, config());
      const legacy = LEGACY_GENERATORS[analysisType](config());

      expect(cube).toContain(`FROM ${COST_CUBE_TABLE}`);
      expect(cube).not.toMatch(/\bPolicyFact\b/);
      expect(cube).not.toMatch(/\bClaimsAgg\b/);
      expect(cube).not.toMatch(/\bCOUNT\(DISTINCT\b/);
      expect(cube).toContain('ORDER BY SUM(premium) DESC');

      for (const alias of EXPECTED_ALIASES[analysisType]) {
        expect(cube, `cube 缺输出列 ${alias}`).toContain(`AS ${alias}`);
        expect(legacy, `legacy 缺输出列 ${alias}（模板已演进？同步更新 cost-cube.ts 与本测试）`).toContain(`AS ${alias}`);
      }
    });
  }

  it('多维度（org_customer / org_coverage）：dim_key 拼接 + GROUP BY 两列', () => {
    const cube = generateCostCubeQuery('claimRatio', config({ dimension: 'org_customer' }));
    expect(cube).toContain("|| ' - ' ||");
    expect(cube).toContain('GROUP BY org_level_3, customer_category');
  });

  it('WHERE 透传到格子过滤', () => {
    const cube = generateCostCubeQuery('variableCost', config({ whereClause: "1=1 AND is_nev = true" }));
    expect(cube).toContain('WHERE 1=1 AND is_nev = true');
  });

  it('非法 cutoffDate → fail-fast 抛错（防注入兜底，路由层应已校验）', () => {
    expect(() => generateCostCubeQuery('claimRatio', config({ cutoffDate: "2026-05-31' OR 1=1 --" })))
      .toThrow(/cutoffDate/);
  });
});
