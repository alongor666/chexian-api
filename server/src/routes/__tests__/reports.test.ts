/**
 * reports.ts 行级安全单测（B328 phase-2：org_user 读本机构报告）
 *
 * 覆盖：
 *  - assertReportAccess 访问矩阵：branch_admin 全放行 / org_user 本机构放行·跨机构 403·跨 branch 403 /
 *    其他角色 fail-closed 403
 *  - assertReportRoleAllowed 粗粒度角色闸（枚举防护前置）
 *  - normalizeReportError org_user 枚举防护归一（非 403 的 4xx → 统一 403，branch_admin 保留精确码）
 *  - resolveReportOwner sidecar 归属解析（缺失/坏 JSON/无 ownerOrg/坏 branch/路径逃逸 → null，fail-closed）
 *
 * 测试直接调用导出的纯/半纯函数，不起 express（access 决策即安全决策，函数层是最强证据）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { dbEnv } from '../../config/env.js';
import {
  assertReportAccess,
  assertReportRoleAllowed,
  resolveReportOwner,
  normalizeReportError,
} from '../reports.js';
import { UserRole } from '../../middleware/permission.js';
import { AppError } from '../../middleware/error.js';

function makeReq(user?: unknown) {
  return { user } as any;
}

/** 断言 fn 抛出 AppError(403)。 */
function expectThrows403(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).statusCode).toBe(403);
    return;
  }
  throw new Error('期望抛出 AppError(403)，但未抛出');
}

beforeEach(() => {
  // 默认多分公司 RLS 关闭，单测按需切换
  dbEnv.BRANCH_RLS_ENABLED = 'false';
});

describe('assertReportAccess: 访问矩阵', () => {
  it('branch_admin + owner=null → 放行（不变）', () => {
    expect(() =>
      assertReportAccess(makeReq({ role: UserRole.BRANCH_ADMIN, branchCode: 'SC' }), null)
    ).not.toThrow();
  });

  it('branch_admin + 跨机构 owner → 放行（全放行不变）', () => {
    expect(() =>
      assertReportAccess(makeReq({ role: UserRole.BRANCH_ADMIN, branchCode: 'SC' }), {
        org: '乐山',
        branch: 'SC',
      })
    ).not.toThrow();
  });

  it('org_user 本机构（org 匹配，owner 无 branch）→ 放行', () => {
    expect(() =>
      assertReportAccess(
        makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' }),
        { org: '乐山', branch: null }
      )
    ).not.toThrow();
  });

  it('org_user 本机构 + branch 匹配 → 放行', () => {
    expect(() =>
      assertReportAccess(
        makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' }),
        { org: '乐山', branch: 'SC' }
      )
    ).not.toThrow();
  });

  it('org_user 跨机构 → 403', () => {
    expectThrows403(() =>
      assertReportAccess(
        makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' }),
        { org: '天府', branch: 'SC' }
      )
    );
  });

  it('org_user + owner=null（无 sidecar）→ 403（fail-closed）', () => {
    expectThrows403(() =>
      assertReportAccess(
        makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' }),
        null
      )
    );
  });

  it('org_user 同名机构跨 branch（ownerBranch≠branchCode）→ 403', () => {
    expectThrows403(() =>
      assertReportAccess(
        makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' }),
        { org: '乐山', branch: 'SX' }
      )
    );
  });

  it('org_user 缺 organization → 403', () => {
    expectThrows403(() =>
      assertReportAccess(makeReq({ role: UserRole.ORG_USER, branchCode: 'SC' }), {
        org: '乐山',
        branch: null,
      })
    );
  });

  it('org_user：owner 有 branch 但 user 缺 branchCode + RLS off → 放行（退回 org 等值）', () => {
    dbEnv.BRANCH_RLS_ENABLED = 'false';
    expect(() =>
      assertReportAccess(makeReq({ role: UserRole.ORG_USER, organization: '乐山' }), {
        org: '乐山',
        branch: 'SC',
      })
    ).not.toThrow();
  });

  it('org_user：owner 有 branch 但 user 缺 branchCode + RLS on → 403（fail-closed）', () => {
    dbEnv.BRANCH_RLS_ENABLED = 'true';
    expectThrows403(() =>
      assertReportAccess(makeReq({ role: UserRole.ORG_USER, organization: '乐山' }), {
        org: '乐山',
        branch: 'SC',
      })
    );
  });

  // codex 闸-2 P1：RLS 开启时 branch 是租户判别，owner 无 branch 不得仅凭 org 放行
  it('org_user：org 匹配 + owner 无 branch + RLS on → 403（缺 branch 判别 fail-closed）', () => {
    dbEnv.BRANCH_RLS_ENABLED = 'true';
    expectThrows403(() =>
      assertReportAccess(
        makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' }),
        { org: '乐山', branch: null }
      )
    );
  });

  it('org_user：org 匹配 + owner.branch=SC + user.branchCode=SC + RLS on → 放行', () => {
    dbEnv.BRANCH_RLS_ENABLED = 'true';
    expect(() =>
      assertReportAccess(
        makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' }),
        { org: '乐山', branch: 'SC' }
      )
    ).not.toThrow();
  });

  it('org_user：org 匹配 + owner.branch=SX + user.branchCode=SC + RLS on → 403（跨分公司租户隔离）', () => {
    dbEnv.BRANCH_RLS_ENABLED = 'true';
    expectThrows403(() =>
      assertReportAccess(
        makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' }),
        { org: '乐山', branch: 'SX' }
      )
    );
  });

  it('telemarketing_user → 403', () => {
    expectThrows403(() =>
      assertReportAccess(makeReq({ role: UserRole.TELEMARKETING_USER, branchCode: 'SC' }), {
        org: '乐山',
        branch: 'SC',
      })
    );
  });

  it('未认证（无 user）→ 403', () => {
    expectThrows403(() => assertReportAccess(makeReq(undefined), null));
  });
});

describe('assertReportRoleAllowed: 粗粒度角色闸（枚举防护前置）', () => {
  it('branch_admin → pass', () => {
    expect(() => assertReportRoleAllowed(makeReq({ role: UserRole.BRANCH_ADMIN }))).not.toThrow();
  });
  it('org_user → pass', () => {
    expect(() =>
      assertReportRoleAllowed(makeReq({ role: UserRole.ORG_USER, organization: '乐山' }))
    ).not.toThrow();
  });
  it('telemarketing_user → 403', () => {
    expectThrows403(() => assertReportRoleAllowed(makeReq({ role: UserRole.TELEMARKETING_USER })));
  });
  it('未知角色 → 403', () => {
    expectThrows403(() => assertReportRoleAllowed(makeReq({ role: 'something_else' })));
  });
  it('未认证 → 403', () => {
    expectThrows403(() => assertReportRoleAllowed(makeReq(undefined)));
  });
});

describe('normalizeReportError: org_user 枚举防护归一', () => {
  it('org_user + 404 → 归一 403', () => {
    const out = normalizeReportError(
      makeReq({ role: UserRole.ORG_USER, organization: '乐山' }),
      new AppError(404, '报告类型不存在')
    );
    expect(out).toBeInstanceOf(AppError);
    expect((out as AppError).statusCode).toBe(403);
  });

  it('org_user + 400 → 归一 403', () => {
    const out = normalizeReportError(
      makeReq({ role: UserRole.ORG_USER, organization: '乐山' }),
      new AppError(400, '快照名格式应为 YYYY-MM-DD')
    );
    expect((out as AppError).statusCode).toBe(403);
  });

  it('org_user + 403（跨机构消息）→ 归一为同一 403（消息也统一，消除存在性侧信道）', () => {
    const out = normalizeReportError(
      makeReq({ role: UserRole.ORG_USER, organization: '乐山' }),
      new AppError(403, '无权访问其他机构的报告')
    );
    expect(out).toBeInstanceOf(AppError);
    expect((out as AppError).statusCode).toBe(403);
    expect((out as AppError).message).toBe('无权访问报告');
  });

  it('branch_admin + 404 → 原样 404（精确码保留）', () => {
    const err = new AppError(404, '报告不存在或已过期');
    expect(normalizeReportError(makeReq({ role: UserRole.BRANCH_ADMIN }), err)).toBe(err);
  });

  it('org_user + 非 AppError → 原样返回', () => {
    const err = new Error('boom');
    expect(normalizeReportError(makeReq({ role: UserRole.ORG_USER, organization: '乐山' }), err)).toBe(
      err
    );
  });
});

describe('resolveReportOwner: sidecar 归属解析（fail-closed）', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-meta-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sidecar 缺失 → null', () => {
    expect(resolveReportOwner(path.join(tmpDir, 'a.html.meta.json'), tmpDir)).toBeNull();
  });

  it('合法 sidecar（org+branch）→ {org,branch}', () => {
    const p = path.join(tmpDir, 'a.html.meta.json');
    fs.writeFileSync(p, JSON.stringify({ ownerOrg: '乐山', ownerBranch: 'SC' }));
    expect(resolveReportOwner(p, tmpDir)).toEqual({ org: '乐山', branch: 'SC' });
  });

  it('仅 ownerOrg（无 branch）→ {org, branch:null}', () => {
    const p = path.join(tmpDir, 'a.html.meta.json');
    fs.writeFileSync(p, JSON.stringify({ ownerOrg: '乐山' }));
    expect(resolveReportOwner(p, tmpDir)).toEqual({ org: '乐山', branch: null });
  });

  it('ownerOrg 前后空白 → trim 后保留', () => {
    const p = path.join(tmpDir, 'a.html.meta.json');
    fs.writeFileSync(p, JSON.stringify({ ownerOrg: '  乐山  ' }));
    expect(resolveReportOwner(p, tmpDir)).toEqual({ org: '乐山', branch: null });
  });

  it('坏 JSON → null', () => {
    const p = path.join(tmpDir, 'a.html.meta.json');
    fs.writeFileSync(p, '{not valid json');
    expect(resolveReportOwner(p, tmpDir)).toBeNull();
  });

  it('无 ownerOrg → null', () => {
    const p = path.join(tmpDir, 'a.html.meta.json');
    fs.writeFileSync(p, JSON.stringify({ ownerBranch: 'SC' }));
    expect(resolveReportOwner(p, tmpDir)).toBeNull();
  });

  it('ownerOrg 空字符串 → null', () => {
    const p = path.join(tmpDir, 'a.html.meta.json');
    fs.writeFileSync(p, JSON.stringify({ ownerOrg: '   ' }));
    expect(resolveReportOwner(p, tmpDir)).toBeNull();
  });

  it('ownerOrg 非字符串（数字）→ null', () => {
    const p = path.join(tmpDir, 'a.html.meta.json');
    fs.writeFileSync(p, JSON.stringify({ ownerOrg: 123 }));
    expect(resolveReportOwner(p, tmpDir)).toBeNull();
  });

  it('ownerBranch 非法格式（小写）→ null（fail-closed）', () => {
    const p = path.join(tmpDir, 'a.html.meta.json');
    fs.writeFileSync(p, JSON.stringify({ ownerOrg: '乐山', ownerBranch: 'sc' }));
    expect(resolveReportOwner(p, tmpDir)).toBeNull();
  });

  it('ownerBranch 非法格式（超长）→ null（fail-closed）', () => {
    const p = path.join(tmpDir, 'a.html.meta.json');
    fs.writeFileSync(p, JSON.stringify({ ownerOrg: '乐山', ownerBranch: 'SCX' }));
    expect(resolveReportOwner(p, tmpDir)).toBeNull();
  });

  it('metaPath 逃逸 baseDir → null', () => {
    expect(resolveReportOwner(path.join(tmpDir, '../evil.meta.json'), tmpDir)).toBeNull();
  });
});
