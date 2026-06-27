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

  // codex PR #804 评审 P1：malformed branchCode 必须 fail-closed（不再"转义后放行"）。
  // 含单引号 / 注入尝试不符 ^[A-Z]{2}$ → 403 拒绝，从源头杜绝 RLS gate-a 解析失效导致的 fail-open。
  it('fail-closed: branchCode 含单引号（注入尝试）不符 ^[A-Z]{2}$ → 403 拒绝', async () => {
    const req = makeReq({ role: UserRole.BRANCH_ADMIN, branchCode: `S'C` });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).message).toMatch(/branchCode/);
    expect(req.permissionFilter).toBeUndefined();
  });

  it('fail-closed: 小写 branchCode（脏配置 sx）不符 ^[A-Z]{2}$ → 403（防 gate-a 不匹配的 fail-open）', async () => {
    const req = makeReq({ role: UserRole.BRANCH_ADMIN, branchCode: 'sx' });
    const err = await runMiddleware(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
    expect(req.permissionFilter).toBeUndefined();
  });

  it('fail-closed: 长度不符 branchCode（如 SCX / S）→ 403', async () => {
    for (const bad of ['SCX', 'S', '12']) {
      const req = makeReq({ role: UserRole.BRANCH_ADMIN, branchCode: bad });
      const err = await runMiddleware(req);
      expect((err as AppError)?.statusCode).toBe(403);
    }
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
    expect(scUsers.length).toBe(20); // 全部 20 个 SC 用户都标 SC
    expect(noBranchCode.length).toBe(0); // 无人缺 branchCode（fail-closed 前提）
  });
});

// ========================================================================
// 全国超管 visibleBranches 切省 + 全国合并视图（设计 §5；codex 闸-1 P1-1/P1-2）
//   - targetBranch 是用户可控 query 参数 → 必用服务端 token 的 visibleBranches 白名单校验
//   - 安全核心：普通用户（无 visibleBranches / 非 branch_admin）传 targetBranch 一律被忽略，不越权
//   - ALL → 不拼 branch_code（baseFilter）；安全前提由 preset-users.test.ts 不变量锁定
//     （全国超管 visibleBranches == getAllBranchCodes()，故"不限制" ≡ "合并所有省"）
// ========================================================================
describe('permissionMiddleware: 全国超管 visibleBranches 切省（flag on）', () => {
  beforeEach(() => {
    envMock.BRANCH_RLS_ENABLED = 'true';
  });

  // 带 query 的 req 构造（现有 makeReq 不含 query）
  const makeReqQ = (user: any, targetBranch?: string) =>
    ({ user, query: targetBranch === undefined ? {} : { targetBranch } } as any);

  const superAdmin = (overrides: any = {}) => ({
    role: UserRole.BRANCH_ADMIN,
    branchCode: 'SC',
    visibleBranches: ['SC', 'SX'],
    ...overrides,
  });

  it('全国超管 targetBranch=SX → branch_code = \'SX\' + effectiveBranch=SX', async () => {
    const req = makeReqQ(superAdmin(), 'SX');
    const err = await runMiddleware(req);
    expect(err).toBeUndefined();
    expect(req.permissionFilter).toBe(`branch_code = 'SX'`);
    expect(req.effectiveBranch).toBe('SX');
  });

  it('全国超管 targetBranch=ALL → 显式 branch_code IN (visibleBranches) 白名单 + effectiveBranch=ALL（codex 闸-2 P1-1：绝不 1=1）', async () => {
    const req = makeReqQ(superAdmin(), 'ALL');
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code IN ('SC', 'SX')`);
    expect(req.permissionFilter).not.toBe('1=1'); // 防回归到 1=1（会泄漏未授权省）
    expect(req.effectiveBranch).toBe('ALL');
  });

  it('全国超管 ALL：visibleBranches 含脏值时仅 IN 合法省（脏值被滤除，不进 SQL）', async () => {
    const req = makeReqQ(superAdmin({ visibleBranches: ['SC', 'SX', "x'; DROP", 'gd'] }), 'ALL');
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code IN ('SC', 'SX')`);
    expect(req.permissionFilter).not.toContain('DROP');
  });

  it('全国超管 ALL：visibleBranches 全脏值 → fail-closed 回落本人默认省（不放行空 IN）', async () => {
    const req = makeReqQ(superAdmin({ visibleBranches: ['sc', 'sx'] }), 'ALL');
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code = 'SC'`);
    expect(req.permissionFilter).not.toContain('IN (');
  });

  it('全国超管 targetBranch=SC（本人默认省）→ branch_code = \'SC\' + effectiveBranch=SC', async () => {
    const req = makeReqQ(superAdmin(), 'SC');
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code = 'SC'`);
    expect(req.effectiveBranch).toBe('SC');
  });

  it('全国超管 无 targetBranch → 回落本人默认省 branch_code = \'SC\'（保守，不默认 ALL）', async () => {
    const req = makeReqQ(superAdmin());
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code = 'SC'`);
    expect(req.effectiveBranch).toBe('SC');
  });

  it('全国超管 targetBranch=GD（未上线/不在 visibleBranches）→ 回落 branch_code = \'SC\'', async () => {
    const req = makeReqQ(superAdmin(), 'GD');
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code = 'SC'`);
    expect(req.effectiveBranch).toBe('SC');
  });

  it('注入防护：targetBranch 含注入串（不符 ^[A-Z]{2}$ 且不在白名单）→ 回落 SC，不进 SQL', async () => {
    const req = makeReqQ(superAdmin(), `SX'; DROP TABLE x; --`);
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code = 'SC'`);
    expect(req.permissionFilter).not.toContain('DROP');
  });

  // ───── 安全关键：越权防护（普通用户传 targetBranch 一律忽略）─────
  it('【越权】普通 SC org_user 传 targetBranch=SX → 仍 (org_level_3=\'乐山\') AND branch_code=\'SC\'（不越权）', async () => {
    const req = makeReqQ(
      { role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC' }, // 无 visibleBranches
      'SX'
    );
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`(org_level_3 = '乐山') AND branch_code = 'SC'`);
    expect(req.permissionFilter).not.toContain(`'SX'`);
    expect(req.effectiveBranch).toBe('SC');
  });

  it('【越权】普通 SC branch_admin（无 visibleBranches）传 targetBranch=SX → 仍 branch_code=\'SC\'', async () => {
    const req = makeReqQ({ role: UserRole.BRANCH_ADMIN, branchCode: 'SC' }, 'SX');
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`branch_code = 'SC'`);
    expect(req.permissionFilter).not.toContain(`'SX'`);
  });

  it('【越权】org_user 即使脏配置带 visibleBranches，传 targetBranch=SX 仍不越权（visibleBranches 仅 branch_admin 生效）', async () => {
    const req = makeReqQ(
      { role: UserRole.ORG_USER, organization: '乐山', branchCode: 'SC', visibleBranches: ['SC', 'SX'] },
      'SX'
    );
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`(org_level_3 = '乐山') AND branch_code = 'SC'`);
    expect(req.permissionFilter).not.toContain(`'SX'`);
  });

  it('【越权】电销用户带 visibleBranches 传 targetBranch=SX 仍不越权', async () => {
    const req = makeReqQ(
      { role: UserRole.TELEMARKETING_USER, branchCode: 'SC', visibleBranches: ['SC', 'SX'] },
      'SX'
    );
    await runMiddleware(req);
    expect(req.permissionFilter).toBe(`(is_telemarketing = true) AND branch_code = 'SC'`);
    expect(req.permissionFilter).not.toContain(`'SX'`);
  });

  it('全国超管 flag off → 不注入（兼容期），不受 visibleBranches 影响', async () => {
    envMock.BRANCH_RLS_ENABLED = 'false';
    const req = makeReqQ(superAdmin(), 'SX');
    await runMiddleware(req);
    expect(req.permissionFilter).toBe('1=1');
  });
});
