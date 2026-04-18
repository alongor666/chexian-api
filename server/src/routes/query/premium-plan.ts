import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService } from './shared.js';
import { generatePremiumPlanDrilldownQuery, generateKPICardQuery, generateRateDistributionQuery, generatePlanAchievementPanel, type PlanDrilldownDimension, type PlanDrilldownLevel, type PlanSortField, type SortOrder as PlanSortOrder } from '../../sql/premiumPlan.js';

const router = Router();

const premiumPlanSchema = z.object({
  queryType: z.enum(['drilldown', 'kpi', 'distribution']).default('drilldown'),
  planYear: z.coerce.number().default(2026),
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
  asyncHandler(async (req, res) => {
    const parseResult = premiumPlanSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const {
      queryType, planYear, level,
      orgFilter, teamFilter, salesmanFilter, customerCategoryFilter,
      sortField, sortOrder,
      rankingEnabled, topN, bottomN,
    } = parseResult.data;

    const isOrgUser = req.user?.role === 'org_user';
    const forcedOrg = isOrgUser ? req.user?.organization : undefined;
    if (isOrgUser && !forcedOrg) {
      throw new AppError(403, 'Organization not specified for ORG_USER role');
    }

    const dimension: PlanDrilldownDimension = {
      level: level as PlanDrilldownLevel,
      filters: {
        org: forcedOrg || orgFilter,
        team: teamFilter,
        salesman: salesmanFilter,
        customerCategory: customerCategoryFilter,
      },
    };

    let sql: string;
    switch (queryType) {
      case 'kpi':
        sql = generateKPICardQuery(planYear, dimension);
        break;
      case 'distribution':
        sql = generateRateDistributionQuery(planYear, dimension);
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

const planAchievementSchema = z.object({
  planYear: z.coerce.number().default(2026),
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
  asyncHandler(async (req, res) => {
    const parseResult = planAchievementSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { planYear, level, orgFilter, teamFilter, salesmanFilter, customerCategoryFilter, sortField, sortOrder } = parseResult.data;
    const isOrgUser = req.user?.role === 'org_user';
    const forcedOrg = isOrgUser ? req.user?.organization : undefined;
    if (isOrgUser && !forcedOrg) {
      throw new AppError(403, 'Organization not specified for ORG_USER role');
    }

    const dimension: PlanDrilldownDimension = {
      level: level as PlanDrilldownLevel,
      filters: {
        org: forcedOrg || orgFilter,
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
