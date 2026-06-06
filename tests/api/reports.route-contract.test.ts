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

describe('assertReportAccess (B328 报告托管行级安全)', () => {
  it('branch_admin 放行全部报告（含无归属 ownerOrg=null）', () => {
    const req = reqWith({ role: UserRole.BRANCH_ADMIN, organization: 'SC' });
    expect(() => assertReportAccess(req, null)).not.toThrow();
    expect(() => assertReportAccess(req, '四川')).not.toThrow();
  });

  it('org_user 本机构报告（ownerOrg 匹配）→ 放行 [纯函数契约，待生产方补齐 org 归属约定后才可达]', () => {
    // 注意：当前两条生产路由均以 ownerOrg=null 调用（见下一条用例），org_user 实际 100% 403；
    // 此用例验证 helper 的契约语义，为未来报告按机构归属存储后开放 org_user 访问铺垫。
    const req = reqWith({ role: UserRole.ORG_USER, organization: '四川' });
    expect(() => assertReportAccess(req, '四川')).not.toThrow();
  });

  it('org_user 跨机构报告 → 403', () => {
    const req = reqWith({ role: UserRole.ORG_USER, organization: '四川' });
    expect(() => assertReportAccess(req, '天津')).toThrowError(/无权访问其他机构/);
    expect(status(() => assertReportAccess(req, '天津'))).toBe(403);
  });

  it('org_user 无归属报告（ownerOrg=null）→ fail-closed 403', () => {
    const req = reqWith({ role: UserRole.ORG_USER, organization: '四川' });
    expect(status(() => assertReportAccess(req, null))).toBe(403);
  });

  it('telemarketing_user 机构级报告 → fail-closed 403', () => {
    const req = reqWith({ role: UserRole.TELEMARKETING_USER, organization: '四川' });
    expect(status(() => assertReportAccess(req, '四川'))).toBe(403);
  });

  it('未知角色 / 无 user → 403', () => {
    expect(status(() => assertReportAccess(reqWith({ role: 'hacker' }), null))).toBe(403);
    expect(status(() => assertReportAccess(reqWith(undefined), '四川'))).toBe(403);
  });
});
