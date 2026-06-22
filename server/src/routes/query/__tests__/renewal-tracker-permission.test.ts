/**
 * 权限过滤安全降级测试：renewal-tracker 路由
 *
 * 背景（P2 任务 2026-06-20-claude-10c9e9）：
 *   RenewalTrackerFact 只含 org_level_3，不含 is_telemarketing / branch_code。
 *   旧路由直接追加 permissionFilter → 电销用户（'is_telemarketing = true'）或多分公司
 *   用户（含 branch_code）触发 DuckDB Binder Error（列不存在）→ 500。
 *
 * 修法（平移 cube.ts PR #685 已验证的方式）：
 *   改用 buildOrgScopedPermissionWhere 安全降级，只保留 org_level_3 段。
 *
 * 本文件包含两组测试：
 *   § A：buildOrgScopedPermissionWhere 辅助函数独立验证（helper 单测）
 *   § B：路由级测试 — 导入真实路由处理器，断言 generateRenewalTrackerQuery
 *        收到的 extraConditions 不含视图缺失列（防"未来路由绕过 buildOrgScoped 守卫"回归）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── mock：阻断原生 .node 模块加载 ──────────────────────────────
vi.mock('../../../services/duckdb.js', () => ({
  duckdbService: {
    query: vi.fn().mockResolvedValue([]),
  },
  DERIVED_RELATIONS: new Set(),
}));
vi.mock('../../../services/route-cache.js', () => ({
  getRouteCache: vi.fn(),
  getRouteCacheEntry: vi.fn().mockReturnValue(null),
  setRouteCache: vi.fn(),
  computeEtag: vi.fn(),
  sendWithEtag: vi.fn(),
  sendCachedEntry: vi.fn(),
}));
vi.mock('../../../services/permission.js', () => ({
  permissionService: {},
}));
vi.mock('../../../utils/request-context.js', () => ({
  markRequestCacheHit: vi.fn(),
  recordQueryMetric: vi.fn(),
}));
vi.mock('../../../utils/api-meta.js', () => ({
  buildResponseMeta: vi.fn(),
}));
vi.mock('../../../config/comprehensive-thresholds.js', () => ({
  DEFAULT_COMPREHENSIVE_THRESHOLDS: {},
}));
vi.mock('../../../config/env.js', () => ({
  dbEnv: {},
  env: {},
}));
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../middleware/error.js', () => ({
  asyncHandler: (fn: any) => fn,
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('../../../services/bootstrapper-registry.js', () => ({
  getBootstrapper: vi.fn(() => null),
  registerBootstrapper: vi.fn(),
}));
vi.mock('../../../utils/data-version.js', () => ({
  getDataVersion: vi.fn().mockReturnValue('v0'),
}));

// ── mock sql-sanitizer（renewal-tracker.ts 直接导入 buildInCondition）────
vi.mock('../../../utils/sql-sanitizer.js', () => ({
  isValidDateFormat: (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s),
  buildInCondition: (col: string, vals: string[]) =>
    `${col} IN (${vals.map(v => `'${v}'`).join(', ')})`,
  sanitizeTableName: (s: string) => s,
  escapeSqlValue: (s: string) => s,
}));

/**
 * buildOrgScopedPermissionWhere 真实逻辑内联（供 mock shared.js 用）。
 * 与 shared.ts 保持同一正则逻辑，隔离原生模块加载。
 */
function buildOrgScopedPermissionWhereImpl(req: Request): string {
  const pf = (req as any).permissionFilter as string | undefined;
  if (!pf || pf === '1=1') return '1=1';
  const match = pf.match(/org_level_3\s*=\s*'(?:[^']|'')*'/);
  return match ? match[0] : '1=1';
}

// ── mock shared.js：透传 withRouteCache/createDomainMiddleware，
//    保留 buildOrgScopedPermissionWhere 真实逻辑 ─────────────────
vi.mock('../shared.js', () => ({
  asyncHandler: (fn: any) => fn,
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  duckdbService: { query: vi.fn().mockResolvedValue([]) },
  isValidDateFormat: (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s),
  sendWithEtag: vi.fn(),
  QUERY_CACHE: { hotspotShort: 3600000, hotspotLong: 14400000 },
  HTTP_MAX_AGE: { query: 300 },
  withRouteCache: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  createDomainMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  buildOrgScopedPermissionWhere: buildOrgScopedPermissionWhereImpl,
}));

// ── mock：捕获 generateRenewalTrackerQuery 的调用参数 ──────────
const mockGenerate = vi.fn().mockReturnValue('SELECT 1');
const mockGenerateMeta = vi.fn().mockReturnValue('SELECT 1');
vi.mock('../../../sql/renewal-tracker.js', () => ({
  generateRenewalTrackerQuery: (...args: any[]) => mockGenerate(...args),
  generateRenewalTrackerMetaQuery: (...args: any[]) => mockGenerateMeta(...args),
}));

// 延迟导入，确保 mock 在 import 之前生效
import renewalTrackerRouter from '../renewal-tracker.js';

// ────────────────────────────────────────────────────────────────────────────
// § A：buildOrgScopedPermissionWhere helper 独立验证（单测）
// ────────────────────────────────────────────────────────────────────────────

/** 最简 Request stub（仅需 permissionFilter） */
function makeHelperReq(permissionFilter: string | undefined): Request {
  return { permissionFilter } as unknown as Request;
}

describe('§ A: buildOrgScopedPermissionWhere helper 单测（降级函数独立验证）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // RT-P-01：四川单租户（permissionFilter='1=1'）短路，orgScoped='1=1'
  it('RT-P-01: 四川单租户（permissionFilter=1=1）→ 1=1（不追加任何条件）', () => {
    expect(buildOrgScopedPermissionWhereImpl(makeHelperReq('1=1'))).toBe('1=1');
  });

  // RT-P-02：电销用户（permissionFilter 含 is_telemarketing）→ 安全降级为 '1=1'
  it('RT-P-02: 电销用户（is_telemarketing=true）→ 1=1（不注入视图缺失列，防 Binder Error 500）', () => {
    const result = buildOrgScopedPermissionWhereImpl(makeHelperReq('is_telemarketing = true'));
    expect(result).toBe('1=1');
    expect(result).not.toContain('is_telemarketing');
  });

  // RT-P-03：多分公司用户（org_level_3 AND branch_code）→ 仅保留 org_level_3
  it('RT-P-03: 多分公司（org_level_3=X AND branch_code=Y）→ 仅保留 org_level_3，branch_code 被屏蔽', () => {
    const result = buildOrgScopedPermissionWhereImpl(makeHelperReq("org_level_3 = '天府' AND branch_code = 'SC'"));
    expect(result).toBe("org_level_3 = '天府'");
    expect(result).not.toContain('branch_code');
  });

  // RT-P-04：普通机构用户（只有 org_level_3）→ 正常保留（回归）
  it('RT-P-04: 普通机构用户（org_level_3=天府）→ 原样保留 org_level_3 段（无回归）', () => {
    expect(buildOrgScopedPermissionWhereImpl(makeHelperReq("org_level_3 = '天府'"))).toBe("org_level_3 = '天府'");
  });

  // RT-P-05：管理员（permissionFilter=undefined）→ 1=1
  it('RT-P-05: 管理员（无 permissionFilter）→ 1=1，不追加条件', () => {
    expect(buildOrgScopedPermissionWhereImpl(makeHelperReq(undefined))).toBe('1=1');
  });

  // RT-P-06：任何降级路径均不含视图缺失列
  it('RT-P-06: 任何降级路径结果均不含 is_telemarketing 或 branch_code（防视图列 Binder Error）', () => {
    const cases = [
      buildOrgScopedPermissionWhereImpl(makeHelperReq('is_telemarketing = true')),
      buildOrgScopedPermissionWhereImpl(makeHelperReq("org_level_3 = '新都' AND branch_code = 'SX'")),
      buildOrgScopedPermissionWhereImpl(makeHelperReq('1=1')),
    ];
    for (const r of cases) {
      expect(r).not.toContain('is_telemarketing');
      expect(r).not.toContain('branch_code');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// § B：路由级测试 — 断言路由处理器将正确的 extraConditions 传给
//      generateRenewalTrackerQuery（防未来路由绕过 buildOrgScoped 守卫）
//
// 原理：
//   • withRouteCache / createDomainMiddleware 已 mock 为 pass-through
//   • asyncHandler 已 mock 为 (fn) => fn，router.stack 中存储的就是原始 async handler
//   • 遍历 router.stack 找 GET /renewal-tracker 的 route layer，取最后一个 handle
//   • 构造含 permissionFilter 的 req stub，调用 handler，断言 mockGenerate 的入参
// ────────────────────────────────────────────────────────────────────────────

/** 提取路由 GET handler（跳过中间件 layer，取 route.stack 末尾的 async handler） */
function extractGetHandler(router: any): (req: Request, res: Response) => Promise<void> {
  // router.stack 包含：use() 注册的中间件 layer + get() 注册的 route layer
  const routeLayer = router.stack.find(
    (layer: any) => layer.route?.path === '/renewal-tracker' && layer.route?.methods?.get,
  );
  if (!routeLayer) throw new Error('GET /renewal-tracker 路由 layer 未找到');
  // route.stack 包含 [withRouteCache middleware, asyncHandler]，取最后一个
  const handlers: any[] = routeLayer.route.stack;
  return handlers[handlers.length - 1].handle;
}

/** 构造最简 Request stub（含 query 三必填参数 + permissionFilter） */
function makeRouteReq(permissionFilter: string): Request {
  return {
    query: { start: '2026-01-01', end: '2026-12-31', cutoff: '2026-06-22' },
    permissionFilter,
    user: {},
    headers: { 'if-none-match': '' },
    get: vi.fn().mockReturnValue(undefined),
  } as unknown as Request;
}

/** 构造最简 Response stub */
function makeRouteRes(): Response {
  return {
    setHeader: vi.fn(),
    set: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
  } as unknown as Response;
}

describe('§ B: renewal-tracker 路由处理器：generateRenewalTrackerQuery 调用参数验证', () => {
  let handler: (req: Request, res: Response) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = extractGetHandler(renewalTrackerRouter);
  });

  // RT-R-01：四川单租户（permissionFilter='1=1'）→ extraConditions 不含任何权限条件
  it('RT-R-01: 四川单租户（1=1）→ generateRenewalTrackerQuery 收到的 extraConditions 不含权限条件', async () => {
    await handler(makeRouteReq('1=1'), makeRouteRes());
    expect(mockGenerate).toHaveBeenCalledOnce();
    const [{ extraConditions }] = mockGenerate.mock.calls[0];
    // orgScoped='1=1' 时，路由守卫 `if (orgScoped !== '1=1')` 跳过，不追加任何权限条件
    expect(extraConditions).not.toContain(expect.stringContaining('is_telemarketing'));
    expect(extraConditions).not.toContain(expect.stringContaining('branch_code'));
    expect(extraConditions.every((c: string) => !c.includes('is_telemarketing') && !c.includes('branch_code'))).toBe(true);
  });

  // RT-R-02：电销用户（is_telemarketing=true）→ 降级为 1=1，路由守卫不追加，extraConditions 不含电销列
  it('RT-R-02: 电销用户（is_telemarketing=true）→ 路由守卫跳过，extraConditions 不含 is_telemarketing（防 Binder Error）', async () => {
    await handler(makeRouteReq('is_telemarketing = true'), makeRouteRes());
    expect(mockGenerate).toHaveBeenCalledOnce();
    const [{ extraConditions }] = mockGenerate.mock.calls[0];
    expect(extraConditions.every((c: string) => !c.includes('is_telemarketing'))).toBe(true);
  });

  // RT-R-03：多分公司用户（org_level_3 AND branch_code）→ 仅追加 org_level_3 条件，branch_code 被屏蔽
  it('RT-R-03: 多分公司用户（org_level_3=天府 AND branch_code=SC）→ extraConditions 仅含 org_level_3，不含 branch_code', async () => {
    await handler(makeRouteReq("org_level_3 = '天府' AND branch_code = 'SC'"), makeRouteRes());
    expect(mockGenerate).toHaveBeenCalledOnce();
    const [{ extraConditions }] = mockGenerate.mock.calls[0];
    // 应有且仅有 org_level_3 = '天府' 这一权限条件（以括号包裹追加）
    const permCond = extraConditions.find((c: string) => c.includes('org_level_3'));
    expect(permCond).toBeDefined();
    expect(extraConditions.every((c: string) => !c.includes('branch_code'))).toBe(true);
    expect(extraConditions.every((c: string) => !c.includes('is_telemarketing'))).toBe(true);
  });

  // RT-R-04：普通机构用户（只有 org_level_3）→ 追加 org_level_3 权限条件（正常隔离，无回归）
  it('RT-R-04: 普通机构用户（org_level_3=天府）→ extraConditions 含 org_level_3 权限条件（正常隔离）', async () => {
    await handler(makeRouteReq("org_level_3 = '天府'"), makeRouteRes());
    expect(mockGenerate).toHaveBeenCalledOnce();
    const [{ extraConditions }] = mockGenerate.mock.calls[0];
    expect(extraConditions.some((c: string) => c.includes('org_level_3'))).toBe(true);
  });
});
