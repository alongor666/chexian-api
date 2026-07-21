import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService, withRouteCache, parseFiltersAndBuildWhere,
  resolveBranchRlsCode, resolveLatestPlanYear, getRequestBranchCode,
  resolveRequiredPlanFactBranchCode, QUERY_CACHE,
} from './shared.js';
import { generatePremiumPlanDrilldownQuery, generateKPICardQuery, generateRateDistributionQuery, generatePlanAchievementPanel, type PlanDrilldownDimension, type PlanDrilldownLevel, type PlanSortField, type SortOrder as PlanSortOrder } from '../../sql/premiumPlan.js';

const router = Router();

async function resolvePremiumPlanYear(
  requestedPlanYear: number | undefined,
  requestBranchCode: string | undefined,
  whereClause: string,
): Promise<number> {
  if (requestedPlanYear) return requestedPlanYear;
  if (requestBranchCode !== 'SX') return resolveLatestPlanYear('achievement_cache');

  const rows = await duckdbService.query<{ max_data_date: string | null }>(
    `SELECT MAX(CAST(policy_date AS DATE)) AS max_data_date FROM PolicyFact WHERE ${whereClause}`,
    QUERY_CACHE.hotspotLong,
  );
  const maxDataDate = rows[0]?.max_data_date ? String(rows[0].max_data_date) : null;
  return maxDataDate ? Number(maxDataDate.slice(0, 4)) : new Date().getFullYear();
}

export const premiumPlanSchema = z.object({
  queryType: z.enum(['drilldown', 'kpi', 'distribution']).default('drilldown'),
  // 缺省时：SX 按请求范围内数据截止年，其他省沿用 achievement_cache 最新计划年
  planYear: z.coerce.number().optional(),
  level: z.enum(['company', 'org', 'team', 'salesman', 'customer_category', 'coverage']).default('company'),
  orgFilter: z.string().max(255).optional(),
  teamFilter: z.string().max(255).optional(),
  salesmanFilter: z.string().max(255).optional(),
  customerCategoryFilter: z.string().max(255).optional(),
  sortField: z.enum(['plan_vehicle', 'actual_vehicle', 'rate_vehicle', 'plan_total', 'prev_year_premium', 'yoy_growth_rate', 'year_2025_actual', 'plan_growth_rate']).default('plan_vehicle'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  rankingEnabled: z.string().optional(),
  topN: z.coerce.number().default(10),
  bottomN: z.coerce.number().default(10),
});

router.get(
  '/premium-plan',
  withRouteCache('premium-plan'),
  asyncHandler(async (req, res) => {
    const parseResult = premiumPlanSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const {
      queryType, planYear: requestedPlanYear, level,
      orgFilter, teamFilter, salesmanFilter, customerCategoryFilter,
      sortField, sortOrder,
      rankingEnabled, topN, bottomN,
    } = parseResult.data;
    // RLS：通过 permissionFilter 统一注入（覆盖 org_user / telemarketing_user / branchCode 三态）
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const requestBranchCode = getRequestBranchCode(req);
    const planYear = await resolvePremiumPlanYear(requestedPlanYear, requestBranchCode, whereClause);
    // achievement_cache 层需要单独映射 org_name（因该表无 org_level_3 / is_telemarketing 字段）
    const rlsOrgName = req.user?.role === 'org_user' ? (req.user?.organization ?? undefined) : undefined;
    // 分省 RLS（ADR G4 GATED 多省）：achievement_cache 多省时携 branch_code，双门控解析（flag off /
    // 单省无列 → undefined → 不注入 → 字节安全）。同理处理 org_name 旁路无法覆盖的省级隔离。
    const rlsBranchCode = await resolveBranchRlsCode(req, 'achievement_cache');
    const organizationPlanBranchCode = await resolveRequiredPlanFactBranchCode(req);

    // org_user 强制覆盖 orgFilter（与原逻辑等价，现已由 rlsOrgName 承接）
    if (req.user?.role === 'org_user' && !req.user?.organization) {
      throw new AppError(403, 'Organization not specified for ORG_USER role');
    }

    const dimension: PlanDrilldownDimension = {
      level: level as PlanDrilldownLevel,
      filters: {
        org: rlsOrgName ?? orgFilter,
        team: teamFilter,
        salesman: salesmanFilter,
        customerCategory: customerCategoryFilter,
      },
    };

    let sql: string;
    switch (queryType) {
      case 'kpi':
        sql = generateKPICardQuery(
          planYear, dimension, rlsOrgName, rlsBranchCode, organizationPlanBranchCode, requestBranchCode
        );
        break;
      case 'distribution':
        sql = generateRateDistributionQuery(
          planYear, dimension, rlsOrgName, rlsBranchCode, organizationPlanBranchCode, requestBranchCode
        );
        break;
      case 'drilldown':
      default:
        sql = generatePremiumPlanDrilldownQuery(
          planYear,
          dimension,
          {
            enabled: rankingEnabled === 'true',
            rankField: 'rate_vehicle',
            topN,
            bottomN,
          },
          sortField as PlanSortField,
          sortOrder as PlanSortOrder,
          rlsOrgName,
          whereClause,
          rlsBranchCode,
          organizationPlanBranchCode,
          requestBranchCode,
        );
        break;
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

export const planAchievementSchema = z.object({
  // 缺省时：SX 按请求范围内数据截止年，其他省沿用 achievement_cache 最新计划年
  planYear: z.coerce.number().optional(),
  level: z.enum(['company', 'org', 'team', 'salesman', 'customer_category', 'coverage']).default('org'),
  orgFilter: z.string().max(255).optional(),
  teamFilter: z.string().max(255).optional(),
  salesmanFilter: z.string().max(255).optional(),
  customerCategoryFilter: z.string().max(255).optional(),
  sortField: z.enum(['plan_vehicle', 'actual_vehicle', 'rate_vehicle', 'plan_total', 'prev_year_premium', 'yoy_growth_rate', 'year_2025_actual', 'plan_growth_rate']).default('actual_vehicle'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

router.get(
  '/plan-achievement',
  withRouteCache('plan-achievement'),
  asyncHandler(async (req, res) => {
    const parseResult = planAchievementSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { planYear: requestedPlanYear, level, orgFilter, teamFilter, salesmanFilter, customerCategoryFilter, sortField, sortOrder } = parseResult.data;
    // RLS：通过 permissionFilter 统一注入（覆盖 org_user / telemarketing_user / branchCode 三态）
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const requestBranchCode = getRequestBranchCode(req);
    const planYear = await resolvePremiumPlanYear(requestedPlanYear, requestBranchCode, whereClause);
    // achievement_cache 层需要单独映射 org_name
    const rlsOrgName = req.user?.role === 'org_user' ? (req.user?.organization ?? undefined) : undefined;
    // 分省 RLS（ADR G4 GATED 多省）：见上方 /premium-plan 同款双门控解析。
    const rlsBranchCode = await resolveBranchRlsCode(req, 'achievement_cache');
    const organizationPlanBranchCode = await resolveRequiredPlanFactBranchCode(req);

    if (req.user?.role === 'org_user' && !req.user?.organization) {
      throw new AppError(403, 'Organization not specified for ORG_USER role');
    }

    const dimension: PlanDrilldownDimension = {
      level: level as PlanDrilldownLevel,
      filters: {
        org: rlsOrgName ?? orgFilter,
        team: teamFilter,
        salesman: salesmanFilter,
        customerCategory: customerCategoryFilter,
      },
    };

    const { childrenSql, summarySql, distributionSql } = generatePlanAchievementPanel(
      planYear,
      dimension,
      sortField as PlanSortField,
      sortOrder as PlanSortOrder,
      rlsOrgName,
      whereClause,
      rlsBranchCode,
      organizationPlanBranchCode,
      requestBranchCode,
    );

    const [children, summaryRows, distribution] = await Promise.all([
      duckdbService.query(childrenSql),
      duckdbService.query(summarySql),
      duckdbService.query(distributionSql),
    ]);

    res.json({
      success: true,
      data: {
        children,
        summary: summaryRows[0] ?? null,
        distribution,
        meta: {
          plan_year: planYear,
          level,
        },
      },
    });
  })
);

export default router;
