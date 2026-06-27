/**
 * 筛选器路由
 * Filter Routes
 *
 * GET /api/filters/options - 获取筛选器选项（机构列表、业务员列表等）
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { readonlyMiddleware } from '../middleware/readonly.js';
import { permissionMiddleware } from '../middleware/permission.js';
import { asyncHandler } from '../middleware/error.js';
import { duckdbService } from '../services/duckdb.js';
import { permissionService } from '../services/permission.js';
import { resolveBranchRlsCode } from './query/shared.js';

const router = Router();

/**
 * 为 SalesmanTeamMapping 维度表生成行级过滤条件（纯函数，供单测）。
 *
 * 维度表用 organization 字段（非 PolicyFact.org_level_3），无法直接复用 req.permissionFilter。
 * 分省 RLS（BRANCH_RLS_ENABLED=true，GATED 多省）时额外追加 branch_code 等值过滤：
 *   - branchRlsCode 来自路由层 resolveBranchRlsCode 双门控解析；
 *   - flag off / 单省无 branch_code 列 → branchRlsCode=undefined → 不追加 → 字节安全。
 *
 * @param role 用户角色
 * @param organization 机构名（org_user 时使用）
 * @param branchRlsCode 省份码（undefined → 不注入，行为与旧代码完全一致）
 */
export function buildMappingPermissionWhere(
  role: string,
  organization: string | undefined,
  branchRlsCode: string | undefined,
): string {
  // 1. 基础机构级过滤（与旧代码逻辑一致）
  let baseWhere: string;
  if (role === 'branch_admin') {
    baseWhere = '1=1';
  } else if (role === 'telemarketing_user') {
    baseWhere = '1=1';
  } else if (role === 'org_user' && organization) {
    const escaped = organization.replace(/'/g, "''");
    baseWhere = `organization = '${escaped}'`;
  } else {
    // fail-closed：未知角色或缺机构信息
    baseWhere = '1=0';
  }

  // 2. 分省 RLS（ADR G4 GATED 多省）：追加 branch_code 等值过滤
  // branchRlsCode 来自 resolveBranchRlsCode 双门控（flag a: permissionFilter 含 branch_code + flag b: 列实测存在）。
  // flag off / 单省无列 → undefined → 不追加 → 逐字节等价旧代码（字节安全）。
  if (!branchRlsCode) {
    return baseWhere;
  }

  const branchClause = `branch_code = '${branchRlsCode}'`;
  return baseWhere === '1=1' ? branchClause : `${baseWhere} AND ${branchClause}`;
}

/**
 * 应用认证与权限中间件
 */
router.use(authMiddleware);
// PAT 只读护栏：filters 仅 GET，对齐 query.ts，拦截 PAT 的非 GET 请求
router.use(readonlyMiddleware);
router.use(permissionMiddleware);

/**
 * GET /api/filters/options
 * 获取所有筛选器选项
 */
router.get(
  '/options',
  asyncHandler(async (req: Request, res: Response) => {
    // 1. 获取用户可见的机构列表（根据权限 + 全国超管有效省）。
    //    effectiveBranch 由 permissionMiddleware 解析（普通用户=本人省；超管=切省/ALL）。
    const visibleOrganizations = permissionService.getVisibleOrganizations(req.user!, req.effectiveBranch);

    // 2. 构建权限WHERE子句（fail-closed：permissionFilter 未生成时拒绝放行任何行）
    const permissionWhere = req.permissionFilter || '1=0';

    // 维度表 SalesmanTeamMapping 用 organization 字段而非 PolicyFact 的 org_level_3，
    // 故由 buildMappingPermissionWhere 生成等价的行级过滤。
    // 分省 RLS（BRANCH_RLS_ENABLED=true，GATED 多省）时额外追加 branch_code 等值过滤。
    const mappingBranchCode = await resolveBranchRlsCode(req, 'SalesmanTeamMapping');
    const mappingPermissionWhere = buildMappingPermissionWhere(
      req.user!.role,
      req.user!.organization,
      mappingBranchCode,
    );

    // 3. 查询机构列表（从数据中实际存在的机构）
    const orgSql = `
      SELECT DISTINCT org_level_3
      FROM PolicyFact
      WHERE ${permissionWhere}
      ORDER BY org_level_3
    `;
    // 筛选器选项每天 ETL 后才变化，延长缓存至 4 小时（invalidateCache 在数据更新时清空）
    const FILTER_CACHE_TTL = 14_400_000;
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
    // 12. 查询业务员-团队映射（从 SalesmanTeamMapping 维度表，按 organization 行级过滤）
    // 多分公司前置（0A 改造）：原 SQL 未挂行级过滤，会泄漏跨机构业务员-团队关系；
    // 现按 user.organization 限定 → org_user 仅看本机构映射，branch_admin/电销保持全量。
    const salesmanTeamSql = `
      SELECT DISTINCT
        full_name AS salesman_name,
        COALESCE(NULLIF(TRIM(CAST(team_name AS VARCHAR)), ''), '未归属团队') AS team_name,
        organization AS org_name
      FROM SalesmanTeamMapping
      WHERE ${mappingPermissionWhere}
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
