/**
 * 报告可见范围解析（B346 静态报告机构级授权的前端侧）。
 *
 * 与后端 `server/src/routes/reports.ts` assertStaticReportAccess 的路径约定一一对应：
 *   - branch_admin（分公司管理员）→ 省级全量报告（/reports/<slug>/<file>）
 *   - org_user（三级机构用户）    → 机构级报告（/reports/<slug>/orgs/<branch>/<org>/<file>）
 *   - 其他角色 / 缺 organization、branchCode → forbidden（后端 fail-closed 403，
 *     前端直接不发起请求并明示无权限，避免 403 噪音）
 */
import { UserRole, type UserPermission } from '../../../shared/config/organizations'

export type ReportScope =
  /** 省级全量报告（分公司管理员） */
  | { kind: 'branch' }
  /** 机构级报告（三级机构用户，orgs/<branch>/<org>/ 子目录） */
  | { kind: 'org'; branch: string; org: string }
  /** 无报告查看权限（电销/未知角色/机构信息不全） */
  | { kind: 'forbidden' }

export function resolveReportScope(permission: UserPermission | null): ReportScope {
  if (!permission) return { kind: 'forbidden' }
  if (permission.role === UserRole.BRANCH_ADMIN) return { kind: 'branch' }
  if (permission.role === UserRole.ORG_USER && permission.organization && permission.branchCode) {
    return { kind: 'org', branch: permission.branchCode, org: permission.organization }
  }
  return { kind: 'forbidden' }
}
