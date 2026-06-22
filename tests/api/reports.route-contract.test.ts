import { describe, expect, it } from 'vitest';
import { isValidSnapshotDate, assertReportAccess } from '../../server/src/routes/reports';
import { UserRole } from '../../server/src/middleware/permission';
import type { AppError } from '../../server/src/middleware/error';

const reqWith = (user: unknown) => ({ user }) as never;
const status = (fn: () => void): number | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as AppError).statusCode;
  }
};

describe('reports route contract', () => {
  it('validates snapshot names as real calendar dates', () => {
    expect(isValidSnapshotDate('2026-05-17')).toBe(true);
    expect(isValidSnapshotDate('2026-02-29')).toBe(false);
    expect(isValidSnapshotDate('2026-02-30')).toBe(false);
    expect(isValidSnapshotDate('2026-13-01')).toBe(false);
    expect(isValidSnapshotDate('2026-00-10')).toBe(false);
    expect(isValidSnapshotDate('20260517')).toBe(false);
  });

  it('accepts leap day only in leap years', () => {
    expect(isValidSnapshotDate('2024-02-29')).toBe(true);
    expect(isValidSnapshotDate('2025-02-29')).toBe(false);
  });
});

// B328 phase-2 起 assertReportAccess 第二参数由 ownerOrg: string|null 升级为 owner: ReportOwner|null。
// 本契约测试同步迁移到新签名；细粒度访问矩阵（branch × RLS 组合）见 server/src/routes/__tests__/reports.test.ts。
describe('assertReportAccess (B328 报告托管行级安全)', () => {
  it('branch_admin 放行全部报告（含无归属 owner=null）', () => {
    const req = reqWith({ role: UserRole.BRANCH_ADMIN, organization: 'SC' });
    expect(() => assertReportAccess(req, null)).not.toThrow();
    expect(() => assertReportAccess(req, { org: '四川', branch: null })).not.toThrow();
  });

  it('org_user 本机构报告（owner.org 匹配）→ 放行 [phase-2：生产方补齐 sidecar 归属后端到端可达]', () => {
    const req = reqWith({ role: UserRole.ORG_USER, organization: '四川' });
    expect(() => assertReportAccess(req, { org: '四川', branch: null })).not.toThrow();
  });

  it('org_user 跨机构报告 → 403', () => {
    const req = reqWith({ role: UserRole.ORG_USER, organization: '四川' });
    expect(() => assertReportAccess(req, { org: '天津', branch: null })).toThrowError(
      /无权访问其他机构/
    );
    expect(status(() => assertReportAccess(req, { org: '天津', branch: null }))).toBe(403);
  });

  it('org_user 无归属报告（owner=null）→ fail-closed 403', () => {
    const req = reqWith({ role: UserRole.ORG_USER, organization: '四川' });
    expect(status(() => assertReportAccess(req, null))).toBe(403);
  });

  it('telemarketing_user 机构级报告 → fail-closed 403', () => {
    const req = reqWith({ role: UserRole.TELEMARKETING_USER, organization: '四川' });
    expect(status(() => assertReportAccess(req, { org: '四川', branch: null }))).toBe(403);
  });

  it('未知角色 / 无 user → 403', () => {
    expect(status(() => assertReportAccess(reqWith({ role: 'hacker' }), null))).toBe(403);
    expect(status(() => assertReportAccess(reqWith(undefined), { org: '四川', branch: null }))).toBe(
      403
    );
  });
});
