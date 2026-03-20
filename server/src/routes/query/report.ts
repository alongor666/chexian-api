import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, parseFiltersAndBuildWhere, isValidDateFormat, QUERY_CACHE } from './shared.js';
import { generateOrgHolidayReportQuery, generateSalesmanHolidayDetailQuery } from '../../sql/marketing-report.js';
import { generateOrgPremiumReportQuery, generateSalesmanPremiumReportQuery } from '../../sql/premium-report.js';

const router = Router();

const marketingReportSchema = z.object({
  reportType: z.enum(['org', 'salesman']).default('org'),
  holidayDates: z.string().default(''),
});

router.get(
  '/marketing-report',
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

const premiumReportExtraSchema = z.object({
  reportType: z.enum(['org', 'salesman']).default('org'),
  planYear: z.coerce.number().default(2026),
});

router.get(
  '/premium-report',
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
      sql = generateSalesmanPremiumReportQuery(finalWhereClause, planYear);
    }

    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
