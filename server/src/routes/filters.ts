/**
 * 筛选器路由
 * Filter Routes
 *
 * GET /api/filters/options - 获取筛选器选项（机构列表、业务员列表等）
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { permissionMiddleware } from '../middleware/permission.js';
import { asyncHandler } from '../middleware/error.js';
import { duckdbService } from '../services/duckdb.js';
import { permissionService } from '../services/permission.js';

const router = Router();

/**
 * 应用认证和权限中间件
 */
router.use(authMiddleware);
router.use(permissionMiddleware);

/**
 * GET /api/filters/options
 * 获取所有筛选器选项
 */
router.get(
  '/options',
  asyncHandler(async (req: Request, res: Response) => {
    // 1. 获取用户可见的机构列表（根据权限）
    const visibleOrganizations = permissionService.getVisibleOrganizations(req.user!);

    // 2. 构建权限WHERE子句
    const permissionWhere = req.permissionFilter || '1=1';

    // 3. 查询机构列表（从数据中实际存在的机构）
    const orgSql = `
      SELECT DISTINCT org_level_3
      FROM PolicyFact
      WHERE ${permissionWhere}
      ORDER BY org_level_3
    `;
    const orgResult = await duckdbService.query<{ org_level_3: string }>(orgSql);
    const actualOrgs = orgResult.map((r) => r.org_level_3);

    // 4. 查询业务员列表
    const salesmanSql = `
      SELECT DISTINCT salesman_name, org_level_3
      FROM PolicyFact
      WHERE ${permissionWhere}
      ORDER BY salesman_name
    `;
    const salesmanResult = await duckdbService.query<{
      salesman_name: string;
      org_level_3: string;
    }>(salesmanSql);

    // 5. 查询客户类别列表
    const customerSql = `
      SELECT DISTINCT customer_category
      FROM PolicyFact
      WHERE ${permissionWhere}
      ORDER BY customer_category
    `;
    const customerResult = await duckdbService.query<{ customer_category: string }>(
      customerSql
    );

    // 6. 查询险别组合列表
    const insuranceSql = `
      SELECT DISTINCT coverage_combination
      FROM PolicyFact
      WHERE ${permissionWhere}
      ORDER BY coverage_combination
    `;
    const insuranceResult = await duckdbService.query<{ coverage_combination: string }>(
      insuranceSql
    );

    // 7. 查询日期范围
    const dateRangeSql = `
      SELECT
        MIN(policy_date) as min_date,
        MAX(policy_date) as max_date
      FROM PolicyFact
      WHERE ${permissionWhere}
    `;
    const dateRangeResult = await duckdbService.query<{
      min_date: string;
      max_date: string;
    }>(dateRangeSql);

    // 8. 查询车险分等级选项
    const insuranceGradeSql = `
      SELECT insurance_grade AS value, COUNT(*) AS count
      FROM PolicyFact
      WHERE ${permissionWhere} AND insurance_grade IS NOT NULL
      GROUP BY insurance_grade
      ORDER BY insurance_grade
    `;
    const insuranceGradeResult = await duckdbService.query<{ value: string; count: number }>(insuranceGradeSql);

    // 9. 查询小货车评分选项
    const smallTruckScoreSql = `
      SELECT small_truck_score AS value, COUNT(*) AS count
      FROM PolicyFact
      WHERE ${permissionWhere} AND small_truck_score IS NOT NULL
      GROUP BY small_truck_score
      ORDER BY small_truck_score
    `;
    const smallTruckScoreResult = await duckdbService.query<{ value: string; count: number }>(smallTruckScoreSql);

    // 10. 查询大货车评分选项
    const largeTruckScoreSql = `
      SELECT large_truck_score AS value, COUNT(*) AS count
      FROM PolicyFact
      WHERE ${permissionWhere} AND large_truck_score IS NOT NULL
      GROUP BY large_truck_score
      ORDER BY large_truck_score
    `;
    const largeTruckScoreResult = await duckdbService.query<{ value: string; count: number }>(largeTruckScoreSql);

    // 11. 返回筛选器选项（字段名与前端 apiClient.getFilterOptions() 类型对齐）
    res.json({
      success: true,
      data: {
        orgs: actualOrgs,
        visibleOrganizations, // 用户权限可见的机构
        salesmen: salesmanResult.map((r) => r.salesman_name),
        salesmenWithOrg: salesmanResult, // 保留原始对象数组供后续机构-业务员映射
        customerCategories: customerResult.map((r) => r.customer_category),
        coverageCombinations: insuranceResult.map((r) => r.coverage_combination),
        dateRange: dateRangeResult[0] || { min_date: null, max_date: null },
        insuranceGrades: insuranceGradeResult.map((r) => ({ value: String(r.value), count: Number(r.count) })),
        smallTruckScores: smallTruckScoreResult.map((r) => ({ value: String(r.value), count: Number(r.count) })),
        largeTruckScores: largeTruckScoreResult.map((r) => ({ value: String(r.value), count: Number(r.count) })),
      },
    });
  })
);

export default router;
