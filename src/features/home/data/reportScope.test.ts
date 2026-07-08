/**
 * B346：报告可见范围解析 + 范围化 URL 构造。
 * 与后端 server/src/routes/reports.ts assertStaticReportAccess 的路径约定对齐。
 */
import { describe, it, expect } from 'vitest'
import { UserRole, type UserPermission } from '../../../shared/config/organizations'
import { resolveReportScope } from './reportScope'
import { getManifestUrl, getReportUrl } from './reportEntries'

function perm(p: Partial<UserPermission>): UserPermission {
  return { username: 'u', displayName: 'u', role: UserRole.ORG_USER, ...p } as UserPermission
}

describe('resolveReportScope', () => {
  it('未登录 → forbidden', () => {
    expect(resolveReportScope(null)).toEqual({ kind: 'forbidden' })
  })

  it('branch_admin → 省级', () => {
    expect(resolveReportScope(perm({ role: UserRole.BRANCH_ADMIN }))).toEqual({ kind: 'branch' })
  })

  it('org_user（机构 + branchCode 齐全）→ 机构级', () => {
    expect(
      resolveReportScope(
        perm({ role: UserRole.ORG_USER, organization: '乐山' as never, branchCode: 'SC' })
      )
    ).toEqual({ kind: 'org', branch: 'SC', org: '乐山' })
  })

  it('org_user 缺 organization 或 branchCode → forbidden（fail-closed）', () => {
    expect(resolveReportScope(perm({ role: UserRole.ORG_USER, branchCode: 'SC' }))).toEqual({
      kind: 'forbidden',
    })
    expect(
      resolveReportScope(perm({ role: UserRole.ORG_USER, organization: '乐山' as never }))
    ).toEqual({ kind: 'forbidden' })
  })

  it('telemarketing → forbidden', () => {
    expect(resolveReportScope(perm({ role: UserRole.TELEMARKETING_USER }))).toEqual({
      kind: 'forbidden',
    })
  })
})

describe('门户报告 URL（同一 URL 随用户，服务端解析范围）', () => {
  const slug = 'diagnose-period-trend'

  it('manifest 与报告 URL 统一走 /api/reports/portal/<slug>/，不含任何机构段', () => {
    expect(getManifestUrl(slug)).toBe('/api/reports/portal/diagnose-period-trend/manifest.json')
    expect(getReportUrl(slug, '2026-07-06-dashboard.html')).toBe(
      '/api/reports/portal/diagnose-period-trend/2026-07-06-dashboard.html'
    )
  })
})
