/**
 * 权限服务
 * Permission Service
 *
 * 处理权限过滤和SQL WHERE子句生成
 */

import { JwtPayload } from '../middleware/auth.js';
import { UserRole } from '../middleware/permission.js';

/**
 * 四川（SC）机构列表（从前端复用）。
 * 与 src/shared/config/organizations.ts 的 ORGANIZATIONS 镜像一致
 * （前后端独立编译域，禁止 import，逐条对齐）。governance「省份映射前后端镜像」锚点对账。
 */
// ── SC-ORG-MIRROR-BEGIN（governance 对账锚点：前后端两份镜像逐字一致）──
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
// ── SC-ORG-MIRROR-END ──

/**
 * 山西（SX）经营单元列表（13，2026-07-15 经代/车商/重客 拆分后口径，BACKLOG 2026-07-15-user-e04971）。
 * SSOT：数据管理/config/branch-org-mapping/SX.json 的 "units"（= ETL 规范化后的 org_level_3 值），
 * 与 preset-users.ts 的 13 个 SX org_user `organization` 字段一致。漂移由 permission.test.ts 对账 PRESET_USERS 锁定。
 * governance「省份映射前后端镜像」锚点对账。
 */
// ── SX-ORG-MIRROR-BEGIN（governance 对账锚点：前后端两份镜像逐字一致）──
export const SX_ORGANIZATIONS = [
  '太原一部',
  '太原二部',
  '经代',
  '车商',
  '重客',
  '大同',
  '阳泉',
  '长治',
  '晋城',
  '晋中',
  '运城',
  '临汾',
  '吕梁',
] as const;
// ── SX-ORG-MIRROR-END ──

/**
 * branchCode → 该分公司机构列表。新增省份上线时须在此登记，否则该省 branch_admin 的机构下拉会回落到默认（SC）。
 * 多省 RLS-on 后，branch_admin 的可见机构必须按本人 branchCode 取，禁止再硬编码单省常量
 * （历史 bug：getVisibleOrganizations 对所有 branch_admin 返回静态 SC 列表 → 山西管理员下拉泄漏四川机构名且缺山西机构）。
 * governance「省份映射前后端镜像」锚点对账。
 */
// ── BRANCH-ORG-MIRROR-BEGIN（governance 对账锚点：前后端两份镜像逐字一致）──
export const BRANCH_ORGANIZATIONS: Record<string, readonly string[]> = {
  SC: ORGANIZATIONS,
  SX: SX_ORGANIZATIONS,
};
// ── BRANCH-ORG-MIRROR-END ──

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
      return `org_level_3 = '${this.escapeSqlString(user.organization)}'`;
    }

    if (user.role === UserRole.TELEMARKETING_USER) {
      // 电销用户：只能查看电销数据
      return 'is_telemarketing = true';
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
   * 获取用户可见的机构列表。
   *
   * @param effectiveBranch 全国超管解析后的有效省（'SC'/'SX'/'ALL'）。
   *   - 缺省 → 按 user.branchCode 取（普通用户/未切省，行为不变）。
   *   - 单省码 → 取该省机构（超管切省）。
   *   - 'ALL' → 合并该超管 visibleBranches 各省机构（去重、按省顺序）。
   *   防全国超管切省后机构下拉仍显示默认省（codex 闸-1 P2-2 / 设计 §8）。
   */
  getVisibleOrganizations(user: JwtPayload, effectiveBranch?: string): string[] {
    if (user.role === UserRole.BRANCH_ADMIN || user.role === UserRole.TELEMARKETING_USER) {
      // 全国超管「全国」合并视图：合并 visibleBranches 各省机构（数据驱动，禁硬编码省份）。
      if (effectiveBranch === 'ALL') {
        const branches =
          user.visibleBranches && user.visibleBranches.length > 0
            ? user.visibleBranches
            : Object.keys(BRANCH_ORGANIZATIONS);
        const merged: string[] = [];
        const seen = new Set<string>();
        for (const b of branches) {
          for (const org of BRANCH_ORGANIZATIONS[b] ?? []) {
            if (!seen.has(org)) {
              seen.add(org);
              merged.push(org);
            }
          }
        }
        return ['全部', ...merged];
      }
      // 单省：优先用有效省（超管切省后的 effectiveBranch），否则用本人 branchCode。
      // 多省 RLS-on 后必须按省取；未登记的省回落到 SC（保守默认，避免泄漏）。
      const branchKey = effectiveBranch ?? user.branchCode;
      const branchOrgs = (branchKey && BRANCH_ORGANIZATIONS[branchKey]) || ORGANIZATIONS;
      return ['全部', ...branchOrgs];
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
