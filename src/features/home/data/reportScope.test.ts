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

describe('范围化报告 URL', () => {
  const slug = 'diagnose-period-trend'

  it('省级：维持原 URL 形态（向后兼容）', () => {
    expect(getManifestUrl(slug, { kind: 'branch' })).toBe(
      '/reports/diagnose-period-trend/manifest.json'
    )
    expect(getReportUrl(slug, '2026-07-06-dashboard.html', { kind: 'branch' })).toBe(
      '/reports/diagnose-period-trend/2026-07-06-dashboard.html'
    )
  })

  it('机构级：orgs/<branch>/<org>/ 前缀 + 中文机构名 URL 编码', () => {
    const scope = { kind: 'org', branch: 'SC', org: '乐山' } as const
    expect(getManifestUrl(slug, scope)).toBe(
      `/reports/diagnose-period-trend/orgs/SC/${encodeURIComponent('乐山')}/manifest.json`
    )
    expect(getReportUrl(slug, '2026-07-06-dashboard.html', scope)).toBe(
      `/reports/diagnose-period-trend/orgs/SC/${encodeURIComponent('乐山')}/2026-07-06-dashboard.html`
    )
  })
})
