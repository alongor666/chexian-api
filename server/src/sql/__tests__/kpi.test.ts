import { describe, expect, it } from 'vitest';
import { generateKpiQuery } from '../kpi.js';
import { getMetricSql } from '../../config/metric-registry/index.js';

// B305：变动成本率公式收归指标注册表（唯一事实源）。
// kpi.ts 的 variable_cost CTE 不再硬编码 CASE WHEN，而是内联
// getMetricSql('variable_cost_ratio') 注册表表达式。
// 本测试断言：
//   1) 生成的 SQL 完整包含注册表 variable_cost_ratio 表达式（派生自注册表，非硬编码）。
//   2) 旧硬编码片段（SUM(fee_amount) * 100.0 不带 COALESCE）已被消除。
//   3) variable_cost CTE 结构完整、整体查询结构未破坏。
describe('generateKpiQuery — variable_cost_ratio 注册表派生 (B305)', () => {
  it('variable_cost CTE 内联注册表 variable_cost_ratio 表达式', () => {
    const sql = generateKpiQuery('1=1');
    const registryExpr = getMetricSql('variable_cost_ratio');

    // 注册表表达式逐字出现在生成 SQL 中（证明派生自注册表）
    expect(sql).toContain(registryExpr);
    // 别名存在
    expect(sql).toContain('AS variable_cost_ratio');
  });

  it('消除旧硬编码：不再出现不带 COALESCE 的 SUM(fee_amount) * 100.0 片段', () => {
    const sql = generateKpiQuery('1=1');
    // 旧硬编码用的是 SUM(fee_amount) * 100.0 / SUM(premium)（无 COALESCE）。
    // 注册表口径统一为 SUM(COALESCE(fee_amount, 0)) * 100.0 / SUM(premium)。
    expect(sql).not.toContain('SUM(fee_amount) * 100.0');
    expect(sql).toContain('SUM(COALESCE(fee_amount, 0)) * 100.0 / SUM(premium)');
  });

  it('注册表表达式与 cost.ts 注册定义一致（满期赔付分母 earned_days/policy_term）', () => {
    const registryExpr = getMetricSql('variable_cost_ratio');
    // 闰年感知满期分母
    expect(registryExpr).toContain(
      'SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE))'
    );
    // 赔付率分子 + 费用率分子结构
    expect(registryExpr).toContain('SUM(reported_claims) * 100.0');
    expect(registryExpr).toContain('SUM(COALESCE(fee_amount, 0)) * 100.0 / SUM(premium)');
    expect(registryExpr).toContain('END AS variable_cost_ratio');
  });

  it('variable_cost CTE 结构完整（FROM variable_cost_base 保留）', () => {
    const sql = generateKpiQuery('1=1');
    expect(sql).toContain('variable_cost AS (');
    expect(sql).toContain('FROM variable_cost_base');
    // variable_cost_base 仍暴露注册表 requiredColumns
    for (const col of ['premium', 'reported_claims', 'fee_amount', 'policy_term', 'earned_days']) {
      expect(sql).toContain(col);
    }
  });

  it('整体查询结构完整（核心 CTE + 最终 SELECT 别名）', () => {
    const sql = generateKpiQuery('1=1');
    expect(sql).toContain('WITH filtered AS (');
    expect(sql).toContain('vc.variable_cost_ratio AS variable_cost_ratio');
    expect(sql).toContain(getMetricSql('earned_premium'));
    expect(sql).toContain(getMetricSql('maturity_rate'));
    expect(sql).toContain('vc.earned_premium AS earned_premium');
    expect(sql).toContain('vc.maturity_rate AS maturity_rate');
    expect(sql).toContain('CROSS JOIN variable_cost vc');
  });

  it('KPI 工作集不再从 PolicyFact 做 SELECT * 宽表扫描', () => {
    const sql = generateKpiQuery('1=1');

    expect(sql).not.toMatch(/SELECT\s+\*\s+FROM\s+PolicyFact/i);
    expect(sql).not.toMatch(/SELECT\s+\*\s*\n\s*FROM\s+PolicyFact/i);
    expect(sql).toContain('base_periods AS');
    expect(sql).not.toContain('vehicle_periods AS');
    expect(sql).not.toContain('driver_periods AS');
    expect(sql).not.toMatch(/YEAR\s*\(\s*CAST\s*\(\s*insurance_start_date\s+AS\s+DATE\s*\)\s*\)/i);
  });
});

describe('generateKpiQuery — 三级机构计划读取 PlanFact Parquet', () => {
  it('无业务员筛选时优先按年度/机构/省份读取 organization 级 PlanFact', () => {
    const sql = generateKpiQuery('1=1', {
      orgNames: ['太原一部'],
      achievementCacheBranchCode: 'SX',
      organizationPlanBranchCode: 'SX',
    });
    expect(sql).toContain('FROM PlanFact');
    expect(sql).toContain("level = 'organization'");
    expect(sql).toContain("organization IN ('太原一部')");
    expect(sql).toContain("branch_code = 'SX'");
    expect(sql).toContain('COUNT(*) = 1');
    expect(sql).toContain('COUNT(plan_vehicle) = 1');
    expect(sql).toContain('SELECT op.vehicle_plan_wan');
    expect(sql).not.toContain('achievement_plan AS');
  });

  it('四川机构视角保持 achievement_cache 人员计划汇总口径，不切到 PlanFact organization', () => {
    const sql = generateKpiQuery('1=1', {
      orgNames: ['乐山'],
      achievementCacheBranchCode: 'SC',
      organizationPlanBranchCode: 'SC',
    });
    expect(sql).not.toContain('FROM PlanFact');
    expect(sql).toContain('FROM achievement_cache');
    expect(sql).toContain("org_name IN ('乐山')");
    expect(sql).toContain("branch_code = 'SC'");
  });

  it('山西业务员筛选时计划为空，不回退人员级 achievement_cache', () => {
    const sql = generateKpiQuery('1=1', {
      orgNames: ['太原一部'],
      salesmanNames: ['10001张三'],
      achievementCacheBranchCode: 'SX',
      organizationPlanBranchCode: 'SX',
    });
    expect(sql).not.toContain('FROM PlanFact');
    expect(sql).not.toContain('FROM achievement_cache');
    expect(sql).toContain('SELECT NULL::DOUBLE AS vehicle_plan_wan');
  });

  it('山西分公司整体计划为空，避免全量分子除以10家机构计划', () => {
    const sql = generateKpiQuery('1=1', {
      achievementCacheBranchCode: 'SX',
      organizationPlanBranchCode: 'SX',
    });
    expect(sql).not.toContain('FROM PlanFact');
    expect(sql).not.toContain('FROM achievement_cache');
    expect(sql).toContain('SELECT NULL::DOUBLE AS vehicle_plan_wan');
  });

  it('RLS 兼容期 PlanFact 不可用时仍识别 SX，请求计划为空且不回退 achievement_cache', () => {
    const sql = generateKpiQuery('1=1', {
      orgNames: ['太原一部'],
      organizationPlanBranchCode: null,
      requestBranchCode: 'SX',
    });
    expect(sql).not.toContain('FROM PlanFact');
    expect(sql).not.toContain('FROM achievement_cache');
    expect(sql).toContain('SELECT NULL::DOUBLE AS vehicle_plan_wan');
  });

  it('山西显式多机构范围要求计划行全部存在', () => {
    const sql = generateKpiQuery('1=1', {
      orgNames: ['太原一部', '经代'],
      achievementCacheBranchCode: 'SX',
      organizationPlanBranchCode: 'SX',
    });
    expect(sql).toContain('COUNT(*) = 2');
    expect(sql).toContain('COUNT(plan_vehicle) = 2');
    expect(sql).toContain("organization IN ('太原一部', '经代')");
    expect(sql).toContain('ELSE NULL');
  });

  it('机构名中的单引号会被 SQL 转义', () => {
    const sql = generateKpiQuery('1=1', {
      orgNames: ["太原'一部"],
      achievementCacheBranchCode: 'SX',
      organizationPlanBranchCode: 'SX',
    });
    expect(sql).toContain("organization IN ('太原''一部')");
  });
});
