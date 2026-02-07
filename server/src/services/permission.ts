/**
 * 权限服务
 * Permission Service
 *
 * 处理权限过滤和SQL WHERE子句生成
 */

import { JwtPayload } from '../middleware/auth.js';
import { UserRole } from '../middleware/permission.js';

/**
 * 机构列表（从前端复用）
 */
export const ORGANIZATIONS = [
  '乐山',
  '天府',
  '宜宾',
  '德阳',
  '新都',
  '武侯',
  '泸州',
  '自贡',
  '资阳',
  '达州',
  '青羊',
  '高新',
] as const;

/**
 * 权限服务类
 */
class PermissionService {
  /**
   * 生成权限WHERE子句
   * 根据用户角色和机构生成行级安全过滤条件
   */
  generatePermissionWhereClause(user: JwtPayload): string {
    if (user.role === UserRole.BRANCH_ADMIN) {
      // 分公司管理员：无限制
      return '1=1';
    }

    if (user.role === UserRole.ORG_USER && user.organization) {
      // 三级机构用户：只能查看本机构
      return `org_level_3 LIKE '%${this.escapeSqlString(user.organization)}%'`;
    }

    // 未知角色或缺少机构信息：拒绝访问
    return '1=0';
  }

  /**
   * 合并WHERE子句
   * 将用户筛选条件和权限过滤条件合并
   */
  combineWhereClause(userFilter: string, permissionFilter: string): string {
    // 如果用户筛选为空或'1=1'，直接返回权限过滤
    if (!userFilter || userFilter === '1=1') {
      return permissionFilter;
    }

    // 如果权限过滤为'1=1'（管理员），直接返回用户筛选
    if (permissionFilter === '1=1') {
      return userFilter;
    }

    // 合并两个条件
    return `(${userFilter}) AND (${permissionFilter})`;
  }

  /**
   * 获取用户可见的机构列表
   */
  getVisibleOrganizations(user: JwtPayload): string[] {
    if (user.role === UserRole.BRANCH_ADMIN) {
      // 分公司管理员：可见所有机构
      return ['全部', ...ORGANIZATIONS];
    }

    if (user.role === UserRole.ORG_USER && user.organization) {
      // 三级机构用户：只可见"全部"和自己的机构
      return ['全部', user.organization];
    }

    // 默认：只可见全部
    return ['全部'];
  }

  /**
   * 检查用户是否有权限查看指定机构
   */
  canViewOrganization(user: JwtPayload, organization: string): boolean {
    const visibleOrgs = this.getVisibleOrganizations(user);
    return visibleOrgs.includes(organization);
  }

  /**
   * 转义SQL字符串，防止SQL注入
   */
  private escapeSqlString(str: string): string {
    return str.replace(/'/g, "''");
  }
}

// 导出单例实例
export const permissionService = new PermissionService();
