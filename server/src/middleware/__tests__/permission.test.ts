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

import {
  permissionMiddleware,
  requirePermissionFilter,
  UserRole,
  getManageableBranchScope,
  canManageBranch,
} from '../permission.js';
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

// ── B326：requirePermissionFilter fail-closed 收窄 ────────
describe('requirePermissionFilter: B326 fail-closed 收窄', () => {
  it('fail-closed: undefined（中间件未执行）→ 抛 AppError 403', () => {
    let caught: unknown;
    try { requirePermissionFilter(undefined); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).statusCode).toBe(403);
  });
  it("branch_admin '1=1' 原样返回", () => {
    expect(requirePermissionFilter('1=1')).toBe('1=1');
  });
  it('org_user 过滤原样返回', () => {
    expect(requirePermissionFilter("org_level_3 = '乐山'")).toBe("org_level_3 = '乐山'");
  });
  it('电销过滤原样返回', () => {
    expect(requirePermissionFilter('is_telemarketing = true')).toBe('is_telemarketing = true');
  });
  it('多分公司 RLS 合成过滤原样返回', () => {
    const f = "(org_level_3 = '乐山') AND branch_code = 'SC'";
    expect(requirePermissionFilter(f)).toBe(f);
  });
});

// ── 路由级白名单校验（纵深防御 —— 第二层）────────────────────────────────
// 场景矩阵：
//   org_user + 白名单内路由    → 通过（200）
//   org_user + 白名单外路由    → 403
//   branch_admin              → 不受白名单限制（通过）
//   telemarketing_user        → 不受路由白名单限制（无 PRESET_ROLES allowedRoutes）
//   路由不在映射表（共用基础路由）→ 通过（不限制）
// ─────────────────────────────────────────────────────────────────────────
import { API_ROUTE_TO_PAGE_MAP } from '../permission.js';

function makeReqWithPath(user: any, path: string, baseUrl?: string) {
  return { user, path, query: {}, ...(baseUrl !== undefined ? { baseUrl } : {}) } as any;
}

async function runMiddlewarePath(req: any): Promise<unknown> {
  let captured: unknown;
  await new Promise<void>((resolve) => {
    permissionMiddleware(req, {} as any, (err?: unknown) => {
      captured = err;
      resolve();
    });
  });
  return captured;
}

describe('permissionMiddleware: org_user 路由白名单校验（纵深防御）', () => {
  const orgUser = {
    role: UserRole.ORG_USER,
    organization: '乐山',
    branchCode: 'SC',
  };

  // ─── 白名单外路由 → 403 ───
  it('org_user 访问 /cost → 403（成本分析不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/cost');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).message).toContain('/cost');
  });

  it('org_user 访问 /premium-report → 403（报表不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/premium-report');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('org_user 访问 /plan-achievement → 403（计划达成不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/plan-achievement');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('org_user 访问 /salesman-ranking → 403（业务员排名不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/salesman-ranking');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('org_user 访问 /marketing-report → 403（营销报告不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/marketing-report');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('org_user 访问 /premium-plan → 403（保费计划不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/premium-plan');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  // ─── 六域新增映射 → 403（org_user 不可见）───
  it('org_user 访问 /repair/overview → 403（维修分析不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/repair/overview');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('org_user 访问 /customer-flow/summary → 403（客户流转不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/customer-flow/summary');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('org_user 访问 /claims-detail/pending-overview → 403（赔案明细不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/claims-detail/pending-overview');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('org_user 访问 /quote-conversion/kpi → 403（报价转化不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/quote-conversion/kpi');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('org_user 访问 /expense-development → 403（费用发展不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/expense-development');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('org_user 访问 /renewal-tracker → 403（续保跟踪不在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/renewal-tracker');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  // ─── 白名单内路由 → 通过 ───
  it('org_user 访问 /kpi → 通过（基础路由不在映射表，不受限）', async () => {
    const req = makeReqWithPath(orgUser, '/kpi');
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
    expect(req.permissionFilter).toBeDefined();
  });

  it('org_user 访问 /trend → 通过（基础路由不在映射表，不受限）', async () => {
    const req = makeReqWithPath(orgUser, '/trend');
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  it('org_user 访问 /growth → 通过（growth 页面在白名单）', async () => {
    // /growth 后端路由对应 /growth 前端页面（若在映射表则需在白名单），
    // 当前 /growth 未在 API_ROUTE_TO_PAGE_MAP 中（org_user 可访问 /growth 页面）
    const req = makeReqWithPath(orgUser, '/growth');
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  it('org_user 访问 /performance-summary → 通过（performance-analysis 在白名单）', async () => {
    const req = makeReqWithPath(orgUser, '/performance-summary');
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  // ─── 精确匹配防御：/cost 不应误匹配 /cost-indicators 等前缀 ───
  it('前缀匹配防御：/cost-indicators 路径不应被 /cost 规则误匹配（独立路径，不受限）', async () => {
    // /cost-indicators 不在 API_ROUTE_TO_PAGE_MAP，不应 403
    const req = makeReqWithPath(orgUser, '/cost-indicators');
    const err = await runMiddlewarePath(req);
    // /cost-indicators 不在映射表，resolvePageRoute 返回 undefined → 不拦截
    expect(err).toBeUndefined();
  });

  it('前缀匹配防御：/repair-xxx 路径不应被 /repair 规则误匹配（不在映射表，不受限）', async () => {
    // /repair-xxx 是假想路径（当前无此真实路由），仅用于验证 resolvePageRoute
    // 的前缀匹配要求 key + '/' 分隔符，不会把 /repair-xxx 误判为 /repair 的子路径
    const req = makeReqWithPath(orgUser, '/repair-xxx');
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  // ─── 挂载域限定：白名单只作用于 /api/query/*（242c07 收口时暴露的误伤面）───
  it('org_user 经 /api/agent/diagnosis 挂载点访问 /quote-conversion → 通过（agent 诊断路由不受页面白名单约束）', async () => {
    // agent 诊断路由（app.ts 挂载 /api/agent/diagnosis）设计上对 org_user 开放并
    // 带角色过滤；其 router 内 req.path='/quote-conversion' 与六域页面映射键同名，
    // 必须靠 baseUrl 挂载域判定避免误伤 403
    const req = makeReqWithPath(orgUser, '/quote-conversion', '/api/agent/diagnosis');
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  it('org_user 经 /api/query 挂载点访问 /quote-conversion → 403（页面白名单正常生效）', async () => {
    const req = makeReqWithPath(orgUser, '/quote-conversion', '/api/query');
    const err = await runMiddlewarePath(req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  // ─── admin / branch_admin 不受白名单限制 ───
  it('branch_admin 访问 /cost → 通过（不受路由白名单限制）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.BRANCH_ADMIN, branchCode: 'SC' },
      '/cost'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
    expect(req.permissionFilter).toBe('1=1');
  });

  it('branch_admin 访问 /premium-report → 通过（不受路由白名单限制）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.BRANCH_ADMIN, branchCode: 'SC' },
      '/premium-report'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
    expect(req.permissionFilter).toBe('1=1');
  });

  it('branch_admin 访问 /plan-achievement → 通过（不受路由白名单限制）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.BRANCH_ADMIN, branchCode: 'SC' },
      '/plan-achievement'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  // ─── 六域新增映射：branch_admin 不受路由白名单限制 ───
  it('branch_admin 访问 /repair/overview → 通过（不受路由白名单限制）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.BRANCH_ADMIN, branchCode: 'SC' },
      '/repair/overview'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  it('branch_admin 访问 /customer-flow/summary → 通过（不受路由白名单限制）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.BRANCH_ADMIN, branchCode: 'SC' },
      '/customer-flow/summary'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  it('branch_admin 访问 /claims-detail/pending-overview → 通过（不受路由白名单限制）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.BRANCH_ADMIN, branchCode: 'SC' },
      '/claims-detail/pending-overview'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  it('branch_admin 访问 /quote-conversion/kpi → 通过（不受路由白名单限制）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.BRANCH_ADMIN, branchCode: 'SC' },
      '/quote-conversion/kpi'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  it('branch_admin 访问 /expense-development → 通过（不受路由白名单限制）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.BRANCH_ADMIN, branchCode: 'SC' },
      '/expense-development'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  it('branch_admin 访问 /renewal-tracker → 通过（不受路由白名单限制）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.BRANCH_ADMIN, branchCode: 'SC' },
      '/renewal-tracker'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  // ─── telemarketing_user：无 PRESET_ROLES allowedRoutes → 不受白名单限制 ───
  it('telemarketing_user 访问 /cost → 通过（该角色无路由白名单）', async () => {
    const req = makeReqWithPath(
      { role: UserRole.TELEMARKETING_USER, branchCode: 'SC' },
      '/cost'
    );
    const err = await runMiddlewarePath(req);
    expect(err).toBeUndefined();
  });

  // ─── API_ROUTE_TO_PAGE_MAP 导出验证 ───
  it('API_ROUTE_TO_PAGE_MAP 包含受限路由映射', () => {
    expect(API_ROUTE_TO_PAGE_MAP['/cost']).toBe('/cost');
    expect(API_ROUTE_TO_PAGE_MAP['/premium-report']).toBe('/reports');
    expect(API_ROUTE_TO_PAGE_MAP['/plan-achievement']).toBe('/reports');
    expect(API_ROUTE_TO_PAGE_MAP['/salesman-ranking']).toBe('/reports');
    // 六域新增映射
    expect(API_ROUTE_TO_PAGE_MAP['/repair']).toBe('/repair');
    expect(API_ROUTE_TO_PAGE_MAP['/customer-flow']).toBe('/customer-flow');
    expect(API_ROUTE_TO_PAGE_MAP['/claims-detail']).toBe('/claims-detail');
    expect(API_ROUTE_TO_PAGE_MAP['/quote-conversion']).toBe('/quote-conversion');
    expect(API_ROUTE_TO_PAGE_MAP['/expense-development']).toBe('/expense-development');
    expect(API_ROUTE_TO_PAGE_MAP['/renewal-tracker']).toBe('/renewal-tracker');
  });
});

describe('用户管理面按省隔离：getManageableBranchScope', () => {
  it('RLS 关 → null（可管理全部，行为不变）', () => {
    envMock.BRANCH_RLS_ENABLED = 'false';
    expect(getManageableBranchScope({ branchCode: 'SX' })).toBeNull();
    expect(getManageableBranchScope({ visibleBranches: ['SC', 'SX'] })).toBeNull();
  });

  it('RLS 开 + 单省 branch_admin（无 visibleBranches）→ 仅本省', () => {
    envMock.BRANCH_RLS_ENABLED = 'true';
    expect(getManageableBranchScope({ branchCode: 'SX' })).toEqual(['SX']);
    expect(getManageableBranchScope({ branchCode: 'SC' })).toEqual(['SC']);
  });

  it('RLS 开 + 全国超管（visibleBranches 非空）→ 其可见省集合（优先于 branchCode）', () => {
    envMock.BRANCH_RLS_ENABLED = 'true';
    expect(getManageableBranchScope({ branchCode: 'SC', visibleBranches: ['SC', 'SX'] })).toEqual([
      'SC',
      'SX',
    ]);
  });

  it('RLS 开 + 无合法 branchCode → 空数组（fail-closed，谁都管不了）', () => {
    envMock.BRANCH_RLS_ENABLED = 'true';
    expect(getManageableBranchScope({})).toEqual([]);
    expect(getManageableBranchScope({ branchCode: 'sc' })).toEqual([]); // 小写非法形态
  });
});

describe('用户管理面按省隔离：canManageBranch', () => {
  it('scope=null（RLS 关）→ 放行任何目标（含无省账号）', () => {
    expect(canManageBranch(null, 'SC')).toBe(true);
    expect(canManageBranch(null, undefined)).toBe(true);
  });

  it('单省 scope → 仅放行同省，拒绝跨省（山西 admin 不能碰四川账号）', () => {
    expect(canManageBranch(['SX'], 'SX')).toBe(true);
    expect(canManageBranch(['SX'], 'SC')).toBe(false);
  });

  it('目标账号无 branchCode + 非 null scope → 拒绝（fail-safe，杜绝模糊态跨省）', () => {
    expect(canManageBranch(['SX'], undefined)).toBe(false);
    expect(canManageBranch([], 'SC')).toBe(false);
  });

  it('全国超管 scope → 放行集合内所有省', () => {
    expect(canManageBranch(['SC', 'SX'], 'SC')).toBe(true);
    expect(canManageBranch(['SC', 'SX'], 'SX')).toBe(true);
  });
});
