import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  commonFilterSchema, buildWhereFromFilterParamsWithoutDate,
} from './shared.js';
import { generateCoefficientByOrgQuery, generateFullCoefficientQuery } from '../../sql/coefficient.js';

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

    // queryType=batch: 返回结构化数据（成都/全省/各机构三层）
    if (queryType === 'batch') {
      const dateRange = {
        start: new Date(startDate),
        end: new Date(endDate),
      };

      const sql = generateFullCoefficientQuery(dateField, dateRange, finalWhereClauseWithoutDate);
      const rawData = await duckdbService.query(sql);

      const data = rawData.filter((r: Record<string, any>) => r.region_group !== 'chengdu' && r.region_group !== 'province');
      const provinceTop = rawData.filter((r: Record<string, any>) => r.org_level_3 === '全省');
      const chengduTop = rawData.filter((r: Record<string, any>) => r.org_level_3 === '成都');

      res.json({
        success: true,
        data: { data, periodGroups: [], provinceTop, chengduTop },
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
