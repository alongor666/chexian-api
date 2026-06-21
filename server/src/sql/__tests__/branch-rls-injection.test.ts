/**
 * 分省 RLS 注入纯函数单测（ADR G4 查询期收口）。CI 运行（无 DuckDB 依赖）。
 *
 * 被测：achievement_cache / SalesmanTeamMapping 直查类 SQL 生成器的 branchCode 注入口。
 * 不变式：
 *   - 传 branchCode（'SX'）→ SQL 含 `branch_code = 'SX'` 等值过滤（GATED 多省时路由双门控解析所得）
 *   - 不传（undefined）→ SQL **不含** `branch_code = '`（flag off / 单省 → 路由解析为 undefined →
 *     不注入 → 与历史 SQL 逐字节一致 = 字节安全）
 *
 * 注：路由层 resolveBranchRlsCode 的「列存在性 gate b」需 DuckDB，覆盖在 duckdb-branch-rls-resolve
 * 集成测试；本文件只证 SQL 生成器拿到 branchCode 后的注入正确性（纯函数）。
 */
import { describe, it, expect } from 'vitest';
import {
  generatePremiumPlanDrilldownQuery,
  generateKPICardQuery,
  generateRateDistributionQuery,
  generatePlanAchievementPanel,
  type PlanDrilldownDimension,
} from '../premiumPlan.js';
import { generateKpiQuery } from '../kpi.js';
import { generateComprehensivePlanByOrgQuery } from '../comprehensive-analysis.js';
import { buildPlanScopeConds } from '../performance-analysis/shared.js';
import { generatePerformanceOrgHeatmapQuery } from '../performance-heatmap.js';

const BRANCH = "branch_code = 'SX'";
const NO_BRANCH = "branch_code = '";
const dim: PlanDrilldownDimension = { level: 'org' };

describe('premiumPlan achievement_cache 分省 RLS 注入', () => {
  it('传 rlsBranchCode → drilldown/kpi/distribution 均含 branch_code 等值过滤', () => {
    expect(
      generatePremiumPlanDrilldownQuery(2026, dim, { enabled: false }, 'plan_vehicle', 'desc', undefined, undefined, 'SX'),
    ).toContain(BRANCH);
    expect(generateKPICardQuery(2026, dim, undefined, 'SX')).toContain(BRANCH);
    expect(generateRateDistributionQuery(2026, dim, undefined, 'SX')).toContain(BRANCH);
  });

  it('不传 rlsBranchCode → 不含 branch_code 过滤（字节安全）', () => {
    expect(generatePremiumPlanDrilldownQuery(2026, dim)).not.toContain(NO_BRANCH);
    expect(generateKPICardQuery(2026, dim)).not.toContain(NO_BRANCH);
    expect(generateRateDistributionQuery(2026, dim)).not.toContain(NO_BRANCH);
  });

  it('与 rlsOrgName 共存：org_name 与 branch_code 同时注入', () => {
    const sql = generateKPICardQuery(2026, dim, '乐山', 'SX');
    expect(sql).toContain("org_name = '乐山'");
    expect(sql).toContain(BRANCH);
  });

  it('generatePlanAchievementPanel 透传 rlsBranchCode 到 children/summary/distribution 三条 SQL', () => {
    const panel = generatePlanAchievementPanel(2026, dim, 'actual_vehicle', 'desc', undefined, undefined, 'SX');
    expect(panel.childrenSql).toContain(BRANCH);
    expect(panel.summarySql).toContain(BRANCH);
    expect(panel.distributionSql).toContain(BRANCH);
  });
});

describe('kpi achievement_cache 分省 RLS 注入', () => {
  it('options.branchCode → vehicle_plan CTE 含 branch_code 过滤', () => {
    expect(generateKpiQuery('1=1', { branchCode: 'SX' })).toContain(BRANCH);
  });
  it('无 branchCode → achievement_cache 段不含 branch_code 过滤（字节安全）', () => {
    expect(generateKpiQuery('1=1', { orgNames: ['乐山'] })).not.toContain(NO_BRANCH);
  });
});

describe('comprehensive achievement_cache 分省 RLS 注入', () => {
  it('rlsBranchCode → 含 branch_code 过滤', () => {
    expect(generateComprehensivePlanByOrgQuery(2026, [], 'SX')).toContain(BRANCH);
  });
  it('不传 → 不含（字节安全）', () => {
    expect(generateComprehensivePlanByOrgQuery(2026, ['乐山'])).not.toContain(NO_BRANCH);
  });
});

describe('performance buildPlanScopeConds 分省 RLS 注入', () => {
  it('branchCode → conds 含 branch_code 等值过滤', () => {
    expect(buildPlanScopeConds({ branchCode: 'SX' }, []).some((c) => c.includes(BRANCH))).toBe(true);
  });
  it('无 branchCode → conds 不含 branch_code（字节安全）', () => {
    expect(buildPlanScopeConds({ orgNames: ['乐山'] }, []).every((c) => !c.includes('branch_code'))).toBe(true);
  });
});

describe('performance-heatmap SalesmanTeamMapping 分省 RLS 注入（plan_by_dim CTE）', () => {
  // org_level_3 维度支持年计划 → 产出 plan_by_dim CTE（FROM SalesmanTeamMapping m）
  it('rlsBranchCode → plan_by_dim CTE 含 m.branch_code 过滤', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'org_level_3', [], 'policy_date', 'SX');
    expect(sql).toContain("m.branch_code = 'SX'");
  });
  it('不传 → 不含 branch_code（主热力图查询走 PolicyFact + whereWithoutDate 已含 RLS）', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'org_level_3', [], 'policy_date');
    expect(sql).not.toContain(NO_BRANCH);
  });
});
