/**
 * 报告可见范围解析（B346 机构级授权的前端侧）。
 *
 * 报告 URL 已统一走后端门户 `/api/reports/portal/<slug>/<file>`（服务端按登录身份
 * 选省级或本机构文件，见 `server/src/routes/reports.ts` resolvePortalScope），前端
 * 不再按 scope 拼 URL。本函数保留两个用途：
 *   - forbidden 判定：电销/未知角色/机构信息不全 → 不发请求并明示无权限（后端同样
 *     fail-closed 403，前端提前拦掉 403 噪音）
 *   - org / branch 区分：机构用户的「本机构报告暂未生成」文案与 manifest 缓存 key
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
