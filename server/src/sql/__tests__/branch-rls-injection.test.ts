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
import { generatePerformanceDrilldownQuery } from '../performance-analysis/drilldown.js';
import { generatePerformanceTopSalesmanQuery } from '../performance-analysis/top-salesman.js';
import { generateCrossSellHeatmapQuery } from '../cross-sell-heatmap.js';
import { generateCrossSellQuery } from '../cross-sell.js';

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

  it('SX 机构行从 PlanFact 取计划，整体/团队/业务员不回退业务员计划', () => {
    const sxOrg = generatePremiumPlanDrilldownQuery(
      2026, { level: 'org' }, { enabled: false }, 'plan_vehicle', 'desc',
      undefined, undefined, 'SX', 'SX'
    );
    expect(sxOrg).toContain('FROM PlanFact');
    expect(sxOrg).toContain("level = 'organization'");
    expect(sxOrg).toContain("branch_code = 'SX'");

    for (const level of ['company', 'team', 'salesman'] as const) {
      const sql = generatePremiumPlanDrilldownQuery(
        2026, { level }, { enabled: false }, 'plan_vehicle', 'desc',
        undefined, undefined, 'SX', 'SX'
      );
      expect(sql).not.toContain('FROM PlanFact');
      expect(sql).toContain('NULL::DOUBLE AS plan_vehicle');
    }
  });

  it('SX 明确机构筛选时允许机构计划，汇总达成率复用行级时间进度口径', () => {
    const sxDim: PlanDrilldownDimension = { level: 'org', filters: { org: '太原' } };
    const sql = generateKPICardQuery(2026, sxDim, undefined, 'SX', 'SX');
    expect(sql).toContain("organization = '太原'");
    expect(sql).toContain('MAX(rate_vehicle) AS avg_rate_vehicle');
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
  it('SC achievementCacheBranchCode → vehicle_plan CTE 含 branch_code 过滤', () => {
    expect(generateKpiQuery('1=1', {
      achievementCacheBranchCode: 'SC',
      organizationPlanBranchCode: null,
    })).toContain("branch_code = 'SC'");
  });
  it('achievement_cache 与 PlanFact branch gate 可独立表达，避免跨表误注入', () => {
    const sql = generateKpiQuery('1=1', {
      achievementCacheBranchCode: 'SX',
      organizationPlanBranchCode: null,
    });
    expect(sql).toContain("branch_code = 'SX'");
    expect(sql).not.toContain('FROM PlanFact');
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
  it('SX 从机构级 PlanFact 读取，SC 仍保持 achievement_cache', () => {
    const sx = generateComprehensivePlanByOrgQuery(2026, ['太原'], 'SX', 'SX');
    expect(sx).toContain('FROM PlanFact');
    expect(sx).toContain("organization IN ('太原')");
    const sc = generateComprehensivePlanByOrgQuery(2026, ['乐山'], 'SC');
    expect(sc).toContain('FROM achievement_cache');
    expect(sc).not.toContain('FROM PlanFact');
  });
});

describe('performance SX 机构计划口径', () => {
  const sxScope = {
    requestBranchCode: 'SX',
    organizationPlanBranchCode: 'SX',
    branchCode: 'SX',
  } as const;

  it('机构下钻从 PlanFact 取计划，分公司整体与团队粒度均返回空计划', () => {
    const orgSql = generatePerformanceDrilldownQuery(
      '1=1', "branch_code = 'SX'", 'all', 'day', 'mom', [], 'org_level_3',
      undefined, 'policy_date', sxScope, 'SX'
    );
    expect(orgSql).toContain('FROM PlanFact');
    expect(orgSql).toContain("level = 'organization'");

    for (const groupBy of [null, 'team', 'salesman'] as const) {
      const sql = generatePerformanceDrilldownQuery(
        '1=1', "branch_code = 'SX'", 'all', 'day', 'mom', [], groupBy,
        undefined, 'policy_date', sxScope, 'SX'
      );
      expect(sql).not.toContain('FROM PlanFact');
      expect(sql).toContain('NULL AS plan_premium');
    }
  });

  it('机构热力图从 PlanFact 按计划年和机构连接，团队热力图不取计划', () => {
    const orgSql = generatePerformanceOrgHeatmapQuery(
      "branch_code = 'SX'", 'all', 'day', 15, 'org_level_3', [], 'policy_date', 'SX', sxScope
    );
    expect(orgSql).toContain('FROM PlanFact');
    expect(orgSql).toContain("branch_code = 'SX'");
    expect(orgSql).toContain('pbd.plan_year = CAST(EXTRACT');

    const teamSql = generatePerformanceOrgHeatmapQuery(
      "branch_code = 'SX'", 'all', 'day', 15, 'team', [], 'policy_date', 'SX', sxScope
    );
    expect(teamSql).not.toContain('FROM PlanFact');
    expect(teamSql).toContain('NULL::DOUBLE AS plan_premium');
  });

  it('SX Top 业务员不回退 achievement_cache 计划', () => {
    const sql = generatePerformanceTopSalesmanQuery(
      '1=1', "branch_code = 'SX'", 'all', 'day', 'mom', 20,
      undefined, 'policy_date', sxScope, 'SX'
    );
    expect(sql).toContain('NULL::DOUBLE AS annual_plan WHERE FALSE');
    expect(sql).not.toContain('FROM achievement_cache');
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

/**
 * 2026-07-09 生产 Binder Error 回归闸：
 *   `Ambiguous reference to column name "branch_code" (use: "p.branch_code" or "tm.branch_code")`
 *
 * 根因：permissionFilter 用裸 `branch_code = 'SX'` 拼进 baseWhereClause / whereWithoutDate，注入到
 * 按团队维度会 JOIN SalesmanTeamMapping（多省时同带 branch_code 列）的主查询 WHERE。事实表别名下
 * 该裸列同时匹配事实表与 tm.branch_code → DuckDB 歧义。仅团队维度（needsTeamJoin）触发。
 *
 * 不变式：主查询 tm-JOIN 作用域内 branch_code 必绑定到**事实表**（PolicyFact p. / CrossSellDailyAgg c.），
 * 与 tm.branch_code 消歧；省份隔离键作用在 policy 行（.claude/rules/data-pipeline.md 省份数据隔离）。
 */
describe('主查询 team 维度 branch_code 消歧（2026-07-09 生产 Binder Error 结构层根治 · 剥列 CTE）', () => {
  const BRANCH_SX = "branch_code = 'SX'";
  const TEAM_CTE = 'team_mapping AS (SELECT full_name, team_name FROM SalesmanTeamMapping)';
  // 新不变式（替代原 qualifyBranchCodeColumn 方案）：团队维度经**剥列 CTE** team_mapping JOIN
  // （只投影 full_name+team_name，不含 branch_code）→ 主查询裸 branch_code 天然只解析到事实表，
  // 结构层杜绝二义。断言：CTE 存在 + JOIN 指向 CTE 而非裸实体表 + 省份过滤仍注入。
  const expectStrippedTeamCte = (sql: string) => {
    expect(sql).toContain(TEAM_CTE);
    expect(sql).toContain('JOIN team_mapping tm');
    expect(sql).not.toContain('JOIN SalesmanTeamMapping tm'); // 不再裸 JOIN 实体表
  };

  it('performance-heatmap team 维度 → 走 team_mapping 剥列 CTE，裸 branch_code 无二义', () => {
    const sql = generatePerformanceOrgHeatmapQuery(BRANCH_SX, 'all', 'day', 15, 'team', [], 'policy_date');
    expect(sql).toContain(BRANCH_SX);
    expectStrippedTeamCte(sql);
  });

  it('performance drilldown（恒 JOIN tm）→ all_rows 走 team_mapping 剥列 CTE', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', BRANCH_SX, 'all', 'day', 'mom', [], 'team');
    expect(sql).toContain(BRANCH_SX);
    expectStrippedTeamCte(sql);
  });

  it('cross-sell-heatmap team 维度（usePF）→ 走 team_mapping 剥列 CTE', () => {
    const sql = generateCrossSellHeatmapQuery(BRANCH_SX, 'all', undefined, 'day', 'team', [], 'policy_date');
    expect(sql).toContain(BRANCH_SX);
    expectStrippedTeamCte(sql);
  });

  it('cross-sell team 维度（JOIN tm）→ 走 team_mapping 剥列 CTE', () => {
    const sql = generateCrossSellQuery(BRANCH_SX, [], 'team');
    expect(sql).toContain(BRANCH_SX);
    expectStrippedTeamCte(sql);
  });

  it('单省（无省份 permissionFilter）→ 四个生成器均不注入 branch_code（字节安全）', () => {
    expect(generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'team', [], 'policy_date')).not.toContain('branch_code');
    expect(generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'day', 'mom', [], 'team')).not.toContain('branch_code');
    expect(generateCrossSellHeatmapQuery('1=1', 'all', undefined, 'day', 'team', [], 'policy_date')).not.toContain('branch_code');
    expect(generateCrossSellQuery('1=1', [], 'team')).not.toContain('branch_code');
  });
});

/**
 * 剥列 CTE **按省过滤**（团队维度保费扇出根治 · 依赖 PR #1017 剥列 CTE 基座）。
 *
 * PR #1017 的剥列 CTE `SELECT full_name, team_name FROM SalesmanTeamMapping`（无省过滤）
 * 修了 Binder Error 却保留扇出：多省下同名业务员跨 SC/SX 各留一行，团队维度 JOIN 时
 * 单省事实保费被两省团队各记一次。真实 parquet 实证（2026-07-09）：SC 域凭空 +123,582 元、
 * SX 域 +153,326 元。本组断言：传入 rlsBranchCode → CTE 变 `SELECT DISTINCT ... WHERE branch_code='XX'`
 * → 同名跨省行按省过滤，扇出物理消失。详见 memory rls-branch-code-ambiguous-team-join。
 */
describe('剥列 CTE 按省过滤（团队维度保费扇出根治 · rlsBranchCode 注入）', () => {
  const BRANCH_SX = "branch_code = 'SX'";
  const TEAM_CTE_SX = "team_mapping AS (SELECT DISTINCT full_name, team_name FROM SalesmanTeamMapping WHERE branch_code = 'SX')";
  const TEAM_CTE_UNFILTERED = 'team_mapping AS (SELECT full_name, team_name FROM SalesmanTeamMapping)';

  it('performance-heatmap team 维度 + rlsBranchCode=SX → team_mapping 按省过滤', () => {
    const sql = generatePerformanceOrgHeatmapQuery(BRANCH_SX, 'all', 'day', 15, 'team', [], 'policy_date', 'SX');
    expect(sql).toContain(TEAM_CTE_SX);
    expect(sql).not.toContain(TEAM_CTE_UNFILTERED); // 不再是无省过滤形态
  });

  it('performance drilldown team 维度 + rlsBranchCode=SX → team_mapping 按省过滤', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', BRANCH_SX, 'all', 'day', 'mom', [], 'team', undefined, 'policy_date', undefined, 'SX');
    expect(sql).toContain(TEAM_CTE_SX);
    expect(sql).not.toContain(TEAM_CTE_UNFILTERED);
  });

  it('cross-sell-heatmap team 维度（usePF）+ rlsBranchCode=SX → team_mapping 按省过滤', () => {
    const sql = generateCrossSellHeatmapQuery(BRANCH_SX, 'all', undefined, 'day', 'team', [], 'policy_date', 'SX');
    expect(sql).toContain(TEAM_CTE_SX);
    expect(sql).not.toContain(TEAM_CTE_UNFILTERED);
  });

  it('cross-sell team 维度 + rlsBranchCode=SX → team_mapping 按省过滤', () => {
    const sql = generateCrossSellQuery(BRANCH_SX, [], 'team', undefined, 'SX');
    expect(sql).toContain(TEAM_CTE_SX);
    expect(sql).not.toContain(TEAM_CTE_UNFILTERED);
  });

  it('cross-sell salesman 维度 + rlsBranchCode=SX → salesman_dim 同样按省过滤（SalesmanDim 多省也带 branch_code）', () => {
    const sql = generateCrossSellQuery(BRANCH_SX, [], 'salesman', undefined, 'SX');
    expect(sql).toContain("salesman_dim AS (SELECT DISTINCT full_name, organization FROM SalesmanDim WHERE branch_code = 'SX')");
    expect(sql).not.toContain('salesman_dim AS (SELECT full_name, organization FROM SalesmanDim)');
  });

  it('单省（rlsBranchCode 未传）→ CTE 保持无省过滤无 DISTINCT（逐字节等价 PR #1017 基线）', () => {
    // 即使 where 串含 branch_code，未传 rlsBranchCode 时 CTE 不变 → 四川单省零变更
    expect(generateCrossSellQuery(BRANCH_SX, [], 'team')).toContain(TEAM_CTE_UNFILTERED);
    expect(generateCrossSellQuery(BRANCH_SX, [], 'salesman')).toContain('salesman_dim AS (SELECT full_name, organization FROM SalesmanDim)');
    expect(generatePerformanceOrgHeatmapQuery(BRANCH_SX, 'all', 'day', 15, 'team', [], 'policy_date')).toContain(TEAM_CTE_UNFILTERED);
  });
});
