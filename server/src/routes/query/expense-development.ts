/**
 * 费用率发展路由
 *
 * 数据源：PolicyFact（保单级 fee_amount + premium）
 * 端点：/api/query/expense-development
 *
 * 使用全局筛选参数（parseFiltersAndBuildWhere），支持多选机构/客户类别/险别等。
 */

import { Router } from 'express';
import {
  asyncHandler, parseFiltersAndBuildWhere, duckdbService, withRouteCache,
  requirePermissionFilter,
} from './shared.js';
import {
  generateExpenseRatioDevelopmentQuery,
} from '../../sql/expense-development.js';
import {
  buildWhereFromFilterParamsWithoutDate,
} from '../../utils/filter-params.js';
import { commonFilterSchema } from '../../utils/filter-params.js';
import { parseCohortYears } from '../../utils/cohort-years.js';
import { AppError } from '../../middleware/error.js';

const router = Router();

/**
 * GET /api/query/expense-development
 * 费用率发展趋势（按起保年份 × 发展月 M1~M12）
 *
 * 接受全局筛选参数（orgNames, customerCategories, isNev, isTransfer 等）
 * 日期参数被忽略（发展口径由 cohortYears 控制）
 */
router.get(
  '/expense-development',
  withRouteCache('expense-development'),
  asyncHandler(async (req, res) => {
    // 解析全局筛选参数，不含日期（发展口径用 cohortYears 代替）
    const parseResult = commonFilterSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const whereClause = buildWhereFromFilterParamsWithoutDate(
      parseResult.data,
      requirePermissionFilter(req.permissionFilter)
    );

    // 默认最近 4 个起保年份（动态派生，防跨年硬编码），解析口径见 utils/cohort-years.ts
    const cohortYears = parseCohortYears(req.query.cohortYears);

    const sql = generateExpenseRatioDevelopmentQuery(whereClause, cohortYears);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

export default router;
