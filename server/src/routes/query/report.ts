import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, parseFiltersAndBuildWhere, isValidDateFormat, QUERY_CACHE, withRouteCache, resolveBranchRlsCode, resolveLatestPlanYear } from './shared.js';
import { generateOrgHolidayReportQuery, generateSalesmanHolidayDetailQuery, generateHolidayFreeDrilldownQuery, type HolidayDrillDimension, type HolidayDrillStep } from '../../sql/marketing-report.js';
import { generateOrgPremiumReportQuery, generateSalesmanPremiumReportQuery } from '../../sql/premium-report.js';

const router = Router();

export const marketingReportSchema = z.object({
  reportType: z.enum(['org', 'salesman']).default('org'),
  holidayDates: z.string().default(''),
});

router.get(
  '/marketing-report',
  withRouteCache('marketing-report'),
  asyncHandler(async (req, res) => {
    const extraResult = marketingReportSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }

    const { reportType, holidayDates } = extraResult.data;
    const dates = holidayDates.split(',').filter(d => d && isValidDateFormat(d));

    const { filterData, whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    const dateField = filterData.dateField || 'policy_date';

    let sql: string;
    if (reportType === 'org') {
      sql = generateOrgHolidayReportQuery(finalWhereClause, dates, dateField);
    } else {
      sql = generateSalesmanHolidayDetailQuery(finalWhereClause, dates, dateField);
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

// ── 假日营销自由维度下钻 ──

const HOLIDAY_DRILL_DIMENSIONS = [
  'org_level_3', 'team', 'salesman',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing',
] as const;

export const holidayDrilldownSchema = z.object({
  groupBy: z.enum(HOLIDAY_DRILL_DIMENSIONS),
  drillPath: z.string().max(2000).default('[]'),
  holidayDates: z.string().default(''),
});

router.get(
  '/holiday-drilldown',
  withRouteCache('holiday-drilldown'),
  asyncHandler(async (req, res) => {
    const parseResult = holidayDrilldownSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { groupBy, drillPath: drillPathStr, holidayDates: datesStr } = parseResult.data;
    const dates = datesStr.split(',').filter(d => d && isValidDateFormat(d));

    let drillPath: HolidayDrillStep[] = [];
    try {
      const parsed = JSON.parse(drillPathStr);
      if (Array.isArray(parsed)) {
        drillPath = parsed.map((s: any) => ({
          dimension: String(s.dimension) as HolidayDrillDimension,
          value: String(s.value),
        }));
      }
    } catch {
      throw new AppError(400, 'Invalid drillPath JSON');
    }

    const { filterData, whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);
    const dateField = filterData.dateField || 'policy_date';

    // 分省 RLS（ADR G4 GATED 多省）：SalesmanTeamMapping team_mapping CTE 按省过滤（双门控）
    const holidayDrillBranchCode = await resolveBranchRlsCode(req, 'SalesmanTeamMapping');

    const sql = generateHolidayFreeDrilldownQuery(
      finalWhereClause,
      dates,
      groupBy as HolidayDrillDimension,
      drillPath,
      dateField,
      holidayDrillBranchCode,
    );

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

export const premiumReportExtraSchema = z.object({
  reportType: z.enum(['org', 'salesman']).default('org'),
  // 缺省时按 SalesmanPlanFact 最新计划年解析（见 handler），禁止硬编码年份默认值
  planYear: z.coerce.number().optional(),
});

router.get(
  '/premium-report',
  withRouteCache('premium-report'),
  asyncHandler(async (req, res) => {
    const extraResult = premiumReportExtraSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { reportType, planYear } = extraResult.data;

    const { filterData, whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    const dateField = filterData.dateField || 'policy_date';

    let sql: string;
    if (reportType === 'org') {
      sql = generateOrgPremiumReportQuery(finalWhereClause, dateField);
    } else {
      const resolvedPlanYear = planYear ?? await resolveLatestPlanYear('SalesmanPlanFact');
      // 分省 RLS（ADR G4 GATED 多省）：SalesmanPlanFact 子查询按省过滤（双门控）
      const premiumPlanBranchCode = await resolveBranchRlsCode(req, 'SalesmanPlanFact');
      sql = generateSalesmanPremiumReportQuery(finalWhereClause, resolvedPlanYear, premiumPlanBranchCode);
    }

    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
