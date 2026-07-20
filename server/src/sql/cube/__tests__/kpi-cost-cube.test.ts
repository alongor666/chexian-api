/**
 * KPI 成本立方体单行 SQL 模块单元测试（纯字符串级，CI 可跑）
 * 数据级等值见 services/__tests__/duckdb-cube-kpi-cost.test.ts（仅本地）。
 */
import { describe, expect, it } from 'vitest';
import {
  isKpiCostCubeServable,
  generateKpiCostCubeQuery,
} from '../kpi-cost-cube.js';
import { COST_CUBE_TABLE } from '../cost-cube.js';
import { generateKpiQuery } from '../../kpi.js';

describe('isKpiCostCubeServable', () => {
  it('dateField=insurance_start_date + 立方体内 WHERE → 可服务', () => {
    expect(isKpiCostCubeServable({
      whereClause: "1=1 AND insurance_start_date >= '2026-01-01' AND org_level_3 IN ('天府','乐山')",
      dateField: 'insurance_start_date',
    }).servable).toBe(true);
    expect(isKpiCostCubeServable({
      whereClause: "1=1 AND customer_category LIKE '营业%' AND tonnage_segment = '2-9吨' AND is_renewal = true",
      dateField: 'insurance_start_date',
    }).servable).toBe(true);
  });

  it('dateField=policy_date → 结构性回退（立方体无 policy_date 列）', () => {
    const r = isKpiCostCubeServable({ whereClause: '1=1', dateField: 'policy_date' });
    expect(r.servable).toBe(false);
    expect(r.reason).toContain('policy_date');
  });

  it('立方体外列（业务员/车型/燃料/评分/套单/续保方式）→ 回退', () => {
    for (const where of [
      "1=1 AND salesman_name = '张三'",
      "1=1 AND vehicle_model LIKE '%自卸%'",
      "1=1 AND fuel_type LIKE '天然气%'",
      "1=1 AND insurance_grade IN ('A', 'B')",
      "1=1 AND is_commercial_insure = '套单'",
      "1=1 AND renewal_mode IS NULL",
    ]) {
      expect(isKpiCostCubeServable({ whereClause: where, dateField: 'insurance_start_date' }).servable).toBe(false);
    }
  });
});

describe('generateKpiCostCubeQuery', () => {
  it('单行 SQL：CubeCostDay 来源、cost 五项别名、零 PolicyFact/ClaimsAgg 引用', () => {
    const sql = generateKpiCostCubeQuery('1=1');
    expect(sql).toContain(`FROM ${COST_CUBE_TABLE}`);
    expect(sql).toContain('AS variable_cost_ratio');
    expect(sql).toContain('AS earned_claim_ratio');
    expect(sql).toContain('AS expense_ratio');
    expect(sql).toContain('AS earned_premium');
    expect(sql).toContain('AS maturity_rate');
    expect(sql).not.toMatch(/\bPolicyFact\b/);
    expect(sql).not.toMatch(/\bClaimsAgg\b/);
    expect(sql).not.toMatch(/\bCOUNT\(DISTINCT\b/);
    // 立方体 SQL 不分组 → 不应出现 GROUP BY（cost 五项是单行单值）
    expect(sql).not.toMatch(/\bGROUP BY\b/);
  });

  it('latest_policy_date 从立方体 MAX(insurance_start_date) 取（不扫 PolicyFact）', () => {
    const sql = generateKpiCostCubeQuery('1=1');
    expect(sql).toMatch(/MAX\(insurance_start_date\)/);
    // latest_policy + cell_exposure 都查立方体 → FROM CubeCostDay 应至少 2 处
    const fromCount = (sql.match(new RegExp(`FROM ${COST_CUBE_TABLE}`, 'g')) ?? []).length;
    expect(fromCount).toBeGreaterThanOrEqual(2);
  });

  it('WHERE 透传到两个 CTE（latest_policy + cell_exposure）', () => {
    const sql = generateKpiCostCubeQuery("1=1 AND org_level_3 = '天府'");
    const occurrences = (sql.match(/WHERE 1=1 AND org_level_3 = '天府'/g) ?? []).length;
    expect(occurrences).toBe(2);
  });
});

describe('generateKpiQuery + excludeVariableCost 等价对比', () => {
  // 立方体路由模式开关 excludeVariableCost=true 时主 SQL 必须刚好少了 cost 五项
  // 与对应 CTE/JOIN，其他 17 项指标输出列完全一致（这是 merge 的等价前提）

  const FULL_KPI_OUTPUT_COLUMNS = [
    'latest_policy_date', 'vehicle_plan_wan', 'vehicle_premium', 'vehicle_achievement_rate',
    'vehicle_growth_rate',
    'variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio', 'earned_premium', 'maturity_rate',
    'bundle_renewal_rate', 'driver_premium', 'driver_achievement_rate', 'driver_growth_rate',
    'total_premium', 'policy_count', 'org_count', 'salesman_count',
    'transfer_rate', 'telesales_rate', 'per_capita_premium', 'renewal_rate',
    'commercial_rate', 'nev_rate', 'new_car_rate', 'quality_business_rate',
    'commercial_insurance_rate', 'per_vehicle_premium',
  ];

  // SELECT 的输出别名匹配方式：cost 五项与 5 项 plan/growth 用 `AS xxx`，
  // 其他 17 项 fm/bp 列直接 `fm.xxx,`/`bp.xxx,` 引用 —— 任一形态出现即视为存在
  const hasOutputColumn = (sql: string, col: string): boolean =>
    new RegExp(`AS ${col}\\b`).test(sql)
    || new RegExp(`\\b(fm|bp|vpl|dpl|vc|lc)\\.${col}\\b`).test(sql);

  it('默认（excludeVariableCost=false）输出 KPI 全部 28 列（包含 cost 五项）', () => {
    const sql = generateKpiQuery('1=1', {}, undefined, 'policy_date');
    for (const col of FULL_KPI_OUTPUT_COLUMNS) {
      expect(hasOutputColumn(sql, col), `缺输出列 ${col}`).toBe(true);
    }
    expect(sql).toMatch(/\bvariable_cost\b/);
    expect(sql).toMatch(/CROSS JOIN variable_cost vc/);
  });

  it('excludeVariableCost=true 移除 cost 五项 + variable_cost CTE/JOIN，其他 23 项保留', () => {
    const sql = generateKpiQuery('1=1', {}, undefined, 'insurance_start_date', true);
    const COST_FIVE = ['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio', 'earned_premium', 'maturity_rate'];
    const OTHERS = FULL_KPI_OUTPUT_COLUMNS.filter((c) => !COST_FIVE.includes(c));
    for (const col of OTHERS) {
      expect(hasOutputColumn(sql, col), `excludeVariableCost=true 不应移除 ${col}`).toBe(true);
    }
    for (const col of COST_FIVE) {
      expect(hasOutputColumn(sql, col), `excludeVariableCost=true 应移除 ${col}`).toBe(false);
    }
    // CTE 与 JOIN 必须连带剥离（否则白扫 P95 大头）
    expect(sql).not.toMatch(/\bvariable_cost_base\b/);
    expect(sql).not.toMatch(/\bfiltered_dedup\b/);
    expect(sql).not.toMatch(/CROSS JOIN variable_cost vc/);
    expect(sql).not.toMatch(/LEFT JOIN ClaimsAgg/);
  });
});
