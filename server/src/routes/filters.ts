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
    // 筛选器选项缓存 300 秒（数据不常变动）
    const FILTER_CACHE_TTL = 300_000;
    // 4. 查询业务员列表
    const salesmanSql = `
      SELECT DISTINCT salesman_name, org_level_3
      FROM PolicyFact
      WHERE ${permissionWhere}
      ORDER BY salesman_name
    `;
    // 5. 查询客户类别列表
    const customerSql = `
      SELECT DISTINCT customer_category
      FROM PolicyFact
      WHERE ${permissionWhere}
      ORDER BY customer_category
    `;
    // 6. 查询险别组合列表
    const insuranceSql = `
      SELECT DISTINCT coverage_combination
      FROM PolicyFact
      WHERE ${permissionWhere}
      ORDER BY coverage_combination
    `;
    // 7. 查询日期范围
    const dateRangeSql = `
      SELECT
        MIN(policy_date) as min_date,
        MAX(policy_date) as max_date
      FROM PolicyFact
      WHERE ${permissionWhere}
    `;
    // 8. 查询车险风险等级选项
    const insuranceGradeSql = `
      SELECT insurance_grade AS value, COUNT(*) AS count
      FROM PolicyFact
      WHERE ${permissionWhere} AND insurance_grade IS NOT NULL
      GROUP BY insurance_grade
      ORDER BY insurance_grade
    `;
    // 11. 查询实际可用年份（签单日期维度）
    const availableYearsSql = `
      SELECT DISTINCT YEAR(policy_date) AS year
      FROM PolicyFact
      WHERE ${permissionWhere} AND policy_date IS NOT NULL
      ORDER BY year DESC
    `;
    // 12. 查询业务员-团队映射（从 SalesmanTeamMapping 维度表，降级为空数组）
    const salesmanTeamSql = `
      SELECT DISTINCT
        full_name AS salesman_name,
        COALESCE(NULLIF(TRIM(CAST(team_name AS VARCHAR)), ''), '未归属团队') AS team_name,
        organization AS org_name
      FROM SalesmanTeamMapping
      ORDER BY full_name
    `;

    const [
      orgResult,
      salesmanResult,
      customerResult,
      insuranceResult,
      dateRangeResult,
      insuranceGradeResult,
      availableYearsResult,
      salesmanTeamResult,
    ] = await Promise.all([
      duckdbService.query<{ org_level_3: string }>(orgSql, FILTER_CACHE_TTL),
      duckdbService.query<{ salesman_name: string; org_level_3: string }>(salesmanSql, FILTER_CACHE_TTL),
      duckdbService.query<{ customer_category: string }>(customerSql, FILTER_CACHE_TTL),
      duckdbService.query<{ coverage_combination: string }>(insuranceSql, FILTER_CACHE_TTL),
      duckdbService.query<{ min_date: string; max_date: string }>(dateRangeSql, FILTER_CACHE_TTL),
      duckdbService.query<{ value: string; count: number }>(insuranceGradeSql, FILTER_CACHE_TTL),
      duckdbService.query<{ year: number }>(availableYearsSql, FILTER_CACHE_TTL),
      duckdbService.query<{ salesman_name: string; team_name: string; org_name: string }>(salesmanTeamSql, FILTER_CACHE_TTL).catch(() => [] as { salesman_name: string; team_name: string; org_name: string }[]),
    ]);

    const actualOrgs = orgResult.map((r) => r.org_level_3);

    // 13. 返回筛选器选项（字段名与前端 apiClient.getFilterOptions() 类型对齐）
    res.json({
      success: true,
      data: {
        orgs: actualOrgs,
        visibleOrganizations, // 用户权限可见的机构
        salesmen: salesmanResult.map((r) => r.salesman_name),
        salesmenWithOrg: salesmanResult, // 保留原始对象数组供后续机构-业务员映射
        salesmenWithTeam: salesmanTeamResult, // 业务员-团队映射（用于动态标题）
        customerCategories: customerResult.map((r) => r.customer_category),
        coverageCombinations: insuranceResult.map((r) => r.coverage_combination),
        dateRange: dateRangeResult[0] || { min_date: null, max_date: null },
        availableYears: availableYearsResult.map((r) => Number(r.year)),
        insuranceGrades: insuranceGradeResult.map((r) => ({ value: String(r.value), count: Number(r.count) })),
      },
    });
  })
);

export default router;
