import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  commonFilterSchema, buildWhereFromFilterParamsWithoutDate,
} from './shared.js';
import { generateCoefficientByOrgQuery, generateFullCoefficientQuery, generateWeekBatchQuery, getMonthPeriods } from '../../sql/coefficient.js';

const router = Router();

/**
 * 系数监控请求验证Schema
 */
const coefficientQuerySchema = z.object({
  queryType: z.enum(['byOrg', 'full', 'batch']).default('byOrg'),
  dateField: z.enum(['policy_date', 'insurance_start_date']).default('policy_date'),
  startDate: z.string(),
  endDate: z.string(),
  cutoffDate: z.string().optional(),
  analysisYear: z.coerce.number().optional(),
});

/**
 * GET /api/query/coefficient
 * 商车自主定价系数监控
 * 注意：系数监控使用独立的日期处理逻辑，不使用通用筛选
 */
router.get(
  '/coefficient',
  asyncHandler(async (req, res) => {
    const parseResult = coefficientQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { queryType, dateField, startDate, endDate, cutoffDate, analysisYear } = parseResult.data;

    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    // 权限 + 通用筛选（不含日期，系数接口使用独立日期参数）
    const permissionFilter = req.permissionFilter || '1=1';
    const finalWhereClauseWithoutDate = buildWhereFromFilterParamsWithoutDate(
      filterResult.data,
      permissionFilter
    );

    // queryType=batch: 返回结构化数据（成都/全省/各机构三层，按月内4个周期分组）
    if (queryType === 'batch') {
      const cutoffDateObj = new Date(endDate);
      const sql = generateWeekBatchQuery(dateField, cutoffDateObj, finalWhereClauseWithoutDate);
      const rawData = await duckdbService.query(sql);

      // snake_case → camelCase 映射，补齐 CoefficientRow 所需的所有字段
      const mapRow = (r: Record<string, any>) => ({
        orgLevel3: r.org_level_3 ?? '',
        regionGroup: r.region_group ?? 'other',
        isNev: Boolean(r.is_nev),
        customerCategoryGroup: r.customer_category_group ?? 'all',
        isNewCar: r.is_new_car ?? null,
        scenario: 'normal' as const,
        // 本查询仅含当周数据，其余周期置 null
        dayFactor: null,
        weekFactor: r.week_factor ?? null,
        monthFactor: null,
        yearFactor: null,
        threshold: null,
        thresholdDirection: null,
        thresholdDisplay: '待定',
        weekThresholdRatio: null,
        gapPremium: null,
        isCompliant: null,
        periodType: 'general' as const,
        periodName: r.period_name ?? '',
        dayPremium: 0,
        weekPremium: r.week_premium ?? 0,
        monthPremium: 0,
        yearPremium: 0,
        dayCount: 0,
        weekCount: r.week_count ?? 0,
        monthCount: 0,
        yearCount: 0,
        sortKey: r.org_level_3 === '成都' ? 1 : r.org_level_3 === '全省' ? 2 : 3,
      });

      const mappedRows = rawData.map(mapRow);

      // 按 periodName 分组构建 periodGroups
      const year = cutoffDateObj.getFullYear();
      const month = cutoffDateObj.getMonth();
      const periodDefs = getMonthPeriods(year, month);

      const periodGroups = periodDefs.map((pd) => {
        const rows = mappedRows.filter((r) => r.periodName === pd.name);
        const startDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(pd.start).padStart(2, '0')}`;
        const endDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(pd.end).padStart(2, '0')}`;
        return {
          periodName: pd.name,
          startDate: startDateStr,
          endDate: endDateStr,
          hasData: rows.length > 0,
          rows,
        };
      });

      // 全省/成都置顶行（所有周期合并，取最后一个周期或首周期数据作为汇总展示）
      const allRows = mappedRows;
      const provinceTop = allRows.filter((r) => r.orgLevel3 === '全省');
      const chengduTop = allRows.filter((r) => r.orgLevel3 === '成都');
      const data = allRows.filter((r) => r.orgLevel3 !== '全省' && r.orgLevel3 !== '成都');

      res.json({
        success: true,
        data: { data, periodGroups, provinceTop, chengduTop },
      });
      return;
    }

    const dateRange = {
      start: new Date(startDate),
      end: new Date(endDate),
    };

    let sql: string;
    if (queryType === 'byOrg') {
      sql = generateCoefficientByOrgQuery(dateField, dateRange, finalWhereClauseWithoutDate);
    } else {
      sql = generateFullCoefficientQuery(dateField, dateRange, finalWhereClauseWithoutDate);
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
