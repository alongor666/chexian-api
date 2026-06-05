/**
 * permissionMiddleware 单测：基础角色过滤 + 0F BRANCH_RLS_ENABLED 矩阵
 *
 * 矩阵覆盖：
 *  - 三角色 (branch_admin / org_user / telemarketing_user) × 两 flag (on / off) × 两 branchCode (有 / 无)
 *  - 边界：未认证 / 缺 organization / 未知角色
 *  - SQL 注入：branchCode 含单引号必须转义
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 0F flag mock —— 默认关闭，单测用例按需切换
// vi.hoisted 是必需：vi.mock 工厂被提升到 import 之前，不能引用普通 const
const envMock = vi.hoisted(() => ({ BRANCH_RLS_ENABLED: 'false' as string }));
vi.mock('../../config/env.js', () => ({
  dbEnv: envMock,
}));

import { permissionMiddleware, UserRole } from '../permission.js';
import { AppError } from '../error.js';

function makeReq(user?: any) {
  return { user } as any;
}

async function runMiddleware(req: any): Promise<unknown> {
  let captured: unknown;
  await new Promise<void>((resolve) => {
    permissionMiddleware(req, {} as any, (err?: unknown) => {
      captured = err;
      resolve();
    });
  });
  return captured;
}

beforeEach(() => {
  envMock.BRANCH_RLS_ENABLED = 'false';
});

describe('permissionMiddleware: 基础过滤（flag off）', () => {
  it('未认证 → AppError 401', async () => {
    const req = makeReq(undefined);
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
  });

  it('branch_admin → 1=1', async () => {
    const req = makeReq({ role: UserRole.BRANCH_ADMIN, branchCode: 'SC' });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.permissionFilter).toBe('1=1');
  });

  it('org_user + organization → org_level_3 等值', async () => {
    const req = makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.permissionFilter).toBe(`org_level_3 = '乐山'`);
  });

  it('org_user 缺 organization → AppError 403', async () => {
    const req = makeReq({ role: UserRole.ORG_USER, branchCode: 'SC' });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('telemarketing_user → is_telemarketing = true', async () => {
    const req = makeReq({ role: UserRole.TELEMARKETING_USER, branchCode: 'SC' });
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.permissionFilter).toBe('is_telemarketing = true');
  });

  it('未知角色 → AppError 403', async () => {
    const req = makeReq({ role: 'unknown_role' });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });
});

describe('permissionMiddleware: 0F BRANCH_RLS_ENABLED=true 矩阵', () => {
  beforeEach(() => {
    envMock.BRANCH_RLS_ENABLED = 'true';
  });

  it('branch_admin + branchCode=SC → branch_code = \'SC\'（无括号，baseFilter=1=1 优化掉）', async () => {
    const req = makeReq({ role: UserRole.BRANCH_ADMIN, branchCode: 'SC' });
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code = 'SC'`);
  });

  it('org_user + branchCode=SC → (org_level_3 = \'乐山\') AND branch_code = \'SC\'', async () => {
    const req = makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' });
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`(org_level_3 = '乐山') AND branch_code = 'SC'`);
  });

  it('telemarketing + branchCode=SC → (is_telemarketing = true) AND branch_code = \'SC\'', async () => {
    const req = makeReq({ role: UserRole.TELEMARKETING_USER, branchCode: 'SC' });
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`(is_telemarketing = true) AND branch_code = 'SC'`);
  });

  it('branchCode=SX → 用 SX 而非 SC（多分公司独立）', async () => {
    const req = makeReq({ role: UserRole.BRANCH_ADMIN, branchCode: 'SX' });
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code = 'SX'`);
  });

  it('SQL 注入防御：branchCode 含单引号必须转义', async () => {
    const req = makeReq({ role: UserRole.BRANCH_ADMIN, branchCode: `S'C` });
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code = 'S''C'`);
  });

  // codex PR #492 P1 fail-closed：旧 JWT / 旧 user_store.json 无 branchCode → 必须 401
  it('fail-closed: branch_admin 无 branchCode → AppError 401 强制重登', async () => {
    const req = makeReq({ role: UserRole.BRANCH_ADMIN });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
    expect((err as AppError).message).toMatch(/branchCode/);
  });

  it('fail-closed: org_user 有 organization 但无 branchCode → 401（不降级到 org_level_3 过滤）', async () => {
    const req = makeReq({ role: UserRole.ORG_USER, organization: '乐山' });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
  });

  it('fail-closed: telemarketing 无 branchCode → 401（不降级到 is_telemarketing 过滤）', async () => {
    const req = makeReq({ role: UserRole.TELEMARKETING_USER });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
  });
});

describe('permissionMiddleware: 0F flag off + 有 branchCode → 不注入（兼容期）', () => {
  it('flag=false 即使用户带 branchCode 也不加 branch_code 过滤', async () => {
    envMock.BRANCH_RLS_ENABLED = 'false';
    const req = makeReq({ role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' });
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`org_level_3 = '乐山'`);
  });

  it('flag=false + 无 branchCode → 正常基础过滤（兼容期，不 fail-closed）', async () => {
    envMock.BRANCH_RLS_ENABLED = 'false';
    const req = makeReq({ role: UserRole.TELEMARKETING_USER });
    await runMiddleware(req);
    expect(req.permissionFilter).toBe('is_telemarketing = true');
  });
});

describe('permissionMiddleware: preset 用户标签验证', () => {
  it('所有 preset 用户都有 branchCode=SC（含 admin，0D 单租户假设）', async () => {
    const { PRESET_USERS } = await import('../../config/preset-users.js');
    const users = Object.values(PRESET_USERS);
    const scUsers = users.filter((u) => u.branchCode === 'SC');
    const noBranchCode = users.filter((u) => !u.branchCode);
    expect(scUsers.length).toBe(20); // 全部 20 个用户都标 SC
    expect(noBranchCode.length).toBe(0); // 无人缺 branchCode（fail-closed 前提）
  });
});
