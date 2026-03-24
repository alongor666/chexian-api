import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, commonFilterSchema, isValidDateFormat } from './shared.js';
import type { AdvancedFilterState } from './shared.js';
import { generateRenewalRateQuery, generateRenewalDetailTableQuery } from '../../sql/renewal.js';
import { generateRenewalDrilldownQuery, type DrilldownDimension, type DrilldownLevel, type SortField, type SortOrder } from '../../sql/renewal-drilldown.js';

const router = Router();

/**
 * 续保分析请求验证Schema（特有参数）
 */
const renewalExtraSchema = z.object({
  queryType: z.enum(['rate', 'detail', 'full']).default('rate'),
  targetYear: z.coerce.number().default(new Date().getFullYear()),
  targetMonth: z.coerce.number().default(new Date().getMonth() + 1),
  perspective: z.string().optional(),
});

/**
 * GET /api/query/renewal
 * 续保分析
 */
router.get(
  '/renewal',
  asyncHandler(async (req, res) => {
    const renewalResult = renewalExtraSchema.safeParse(req.query);
    if (!renewalResult.success) {
      throw new AppError(400, renewalResult.error.issues[0].message);
    }
    const { queryType, targetYear, targetMonth } = renewalResult.data;

    // 解析通用筛选参数
    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    // 构建筛选条件（AdvancedFilterState格式，供续保SQL生成器使用）
    const filters: AdvancedFilterState = {};

    // 从通用参数中提取机构筛选
    const orgNames = filterResult.data.orgNames?.split(',').filter(Boolean);
    if (orgNames && orgNames.length > 0) {
      filters.org_level_3 = orgNames;
    } else if (filterResult.data.orgLevel3) {
      filters.org_level_3 = [filterResult.data.orgLevel3];
    } else if (filterResult.data.orgName) {
      filters.org_level_3 = [filterResult.data.orgName];
    }

    // 权限过滤 - 添加到filters中
    const permissionFilter = req.permissionFilter || '1=1';
    if (permissionFilter !== '1=1') {
      const orgMatch = permissionFilter.match(/org_level_3\s*(?:LIKE|=)\s*'%?([^%']+)%?'/i);
      if (orgMatch && !filters.org_level_3) {
        filters.org_level_3 = [orgMatch[1]];
      }

      const tmMatch = permissionFilter.match(/is_telemarketing\s*=\s*(true|false)/i);
      if (tmMatch) {
        filters.is_telemarketing = tmMatch[1].toLowerCase() === 'true';
      }
    }

    // queryType=full: 返回结构化数据（明细 + 可用月份 + 最新日期）
    if (queryType === 'full') {
      const detailSql = generateRenewalDetailTableQuery(filters, targetYear, targetMonth, 'premium');
      const detailData = await duckdbService.query(detailSql);

      const availableMonthsSql = `
        SELECT DISTINCT MONTH(DATE_ADD(CAST(insurance_start_date AS DATE), INTERVAL '1 year') - INTERVAL '1 day') AS month_num
        FROM PolicyFact
        WHERE YEAR(CAST(insurance_start_date AS DATE)) = ${targetYear - 1}
          AND YEAR(DATE_ADD(CAST(insurance_start_date AS DATE), INTERVAL '1 year') - INTERVAL '1 day') = ${targetYear}
        ORDER BY month_num
      `;
      const availableMonthsResult = await duckdbService.query(availableMonthsSql);
      const availableMonths = availableMonthsResult.map((r: Record<string, any>) => Number(r.month_num));

      const latestDateSql = `SELECT MAX(CAST(policy_date AS DATE)) AS latest_date FROM PolicyFact`;
      const latestDateResult = await duckdbService.query(latestDateSql);
      const latestPolicyDate = latestDateResult[0]?.latest_date ? String(latestDateResult[0].latest_date) : null;

      res.json({
        success: true,
        data: { detailData, availableMonths, latestPolicyDate },
      });
      return;
    }

    let sql: string;
    if (queryType === 'rate') {
      sql = generateRenewalRateQuery(filters, targetYear);
    } else {
      sql = generateRenewalDetailTableQuery(filters, targetYear, targetMonth, 'premium');
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 续保下钻分析请求验证Schema
 */
const renewalDrilldownSchema = z.object({
  targetYear: z.coerce.number().default(new Date().getFullYear()),
  level: z.enum(['company', 'org', 'team', 'salesman', 'coverage']).default('company'),
  orgFilter: z.string().max(255).optional(),
  teamFilter: z.string().max(255).optional(),
  salesmanFilter: z.string().max(255).optional(),
  selfRenewalOnly: z.string().max(10).optional(),
  bundleOnly: z.string().max(10).optional(),
  dueMonth: z.coerce.number().optional(),
  cutoffDate: z.string().max(20).optional(),
  sortField: z.enum(['renewal_rate', 'quote_rate', 'due_count', 'renewed_count']).default('renewal_rate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * GET /api/query/renewal-drilldown
 * 续保下钻分析（五层下钻：公司→机构→团队→业务员→险别组合）
 */
router.get(
  '/renewal-drilldown',
  asyncHandler(async (req, res) => {
    const parseResult = renewalDrilldownSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const {
      targetYear, level, orgFilter, teamFilter, salesmanFilter,
      selfRenewalOnly, bundleOnly, dueMonth, cutoffDate,
      sortField, sortOrder,
    } = parseResult.data;

    if (cutoffDate && !isValidDateFormat(cutoffDate)) {
      throw new AppError(400, `Invalid cutoffDate format: ${cutoffDate}. Expected YYYY-MM-DD`);
    }

    // 构建下钻维度
    const dimension: DrilldownDimension = {
      level: level as DrilldownLevel,
      selfRenewalOnly: selfRenewalOnly === 'true',
      bundleOnly: bundleOnly === 'true',
      dueMonth: dueMonth,
      filters: {
        org: orgFilter,
        team: teamFilter,
        salesman: salesmanFilter,
      },
    };

    // 构建筛选条件
    const filters: AdvancedFilterState = {};
    const permissionFilter = req.permissionFilter || '1=1';
    if (permissionFilter !== '1=1') {
      const orgMatch = permissionFilter.match(/org_level_3\s*(?:LIKE|=)\s*'%?([^%']+)%?'/i);
      if (orgMatch && !orgFilter) {
        dimension.filters = { ...dimension.filters, org: orgMatch[1] };
      }

      const tmMatch = permissionFilter.match(/is_telemarketing\s*=\s*(true|false)/i);
      if (tmMatch) {
        filters.is_telemarketing = tmMatch[1].toLowerCase() === 'true';
      }
    }

    const sql = generateRenewalDrilldownQuery(
      filters,
      targetYear,
      dimension,
      { enabled: false },
      sortField as SortField,
      sortOrder as SortOrder,
      cutoffDate,
    );

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
