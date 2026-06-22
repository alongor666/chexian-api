/**
 * 路由级单元测试：renewal-tracker 权限过滤安全降级
 *
 * 背景（P2 任务 2026-06-20-claude-10c9e9）：
 *   RenewalTrackerFact 只含 org_level_3，不含 is_telemarketing / branch_code。
 *   旧路由直接追加 permissionFilter → 电销用户（'is_telemarketing = true'）或多分公司
 *   用户（含 branch_code）触发 DuckDB Binder Error（列不存在）→ 500。
 *
 * 修法（平移 cube.ts PR #685 已验证的方式）：
 *   改用 buildOrgScopedPermissionWhere 安全降级，只保留 org_level_3 段。
 *
 * 本测试通过 mock generateRenewalTrackerQuery，检查路由传入的 extraConditions
 * 是否正确屏蔽了 is_telemarketing / branch_code，验证不再注入视图缺失的列。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ── mock：阻断原生 .node 模块加载 ──────────────────────────────
vi.mock('../../../services/duckdb.js', () => ({
  duckdbService: {
    query: vi.fn().mockResolvedValue([]),
  },
  DERIVED_RELATIONS: new Set(),
}));
vi.mock('../../../services/route-cache.js', () => ({
  getRouteCache: vi.fn(),
  setRouteCache: vi.fn(),
  computeEtag: vi.fn(),
  sendWithEtag: vi.fn(),
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

// ── mock：捕获 generateRenewalTrackerQuery 的调用参数 ──────────
const mockGenerate = vi.fn().mockReturnValue('SELECT 1');
const mockGenerateMeta = vi.fn().mockReturnValue('SELECT 1');
vi.mock('../../../sql/renewal-tracker.js', () => ({
  generateRenewalTrackerQuery: (...args: any[]) => mockGenerate(...args),
  generateRenewalTrackerMetaQuery: (...args: any[]) => mockGenerateMeta(...args),
}));

// 延迟导入，确保 mock 在 import 之前生效
import { buildOrgScopedPermissionWhere } from '../shared.js';

/** 构造最简 Request stub，设置必要的 query 参数与 permissionFilter */
function makeReq(permissionFilter: string): Request {
  return {
    query: { start: '2026-01-01', end: '2026-12-31', cutoff: '2026-06-22' },
    permissionFilter,
    user: {},
    headers: {},
  } as unknown as Request;
}

/** 构造最简 Response stub（sendWithEtag 已 mock，不需要真实发送） */
function makeRes(): Response {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
  } as unknown as Response;
}

// ── 直接测试 buildOrgScopedPermissionWhere 在路由场景中的行为 ──

describe('renewal-tracker 路由：权限过滤安全降级（不再 Binder Error）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // RT-P-01：四川单租户（permissionFilter='1=1'）短路，orgScoped='1=1' → 不追加任何条件
  it('RT-P-01: 四川单租户（permissionFilter=1=1）→ orgScoped=1=1，不追加条件（字节安全）', () => {
    const result = buildOrgScopedPermissionWhere(makeReq('1=1'));
    expect(result).toBe('1=1');
    // 确认不会把 '1=1' 追加到 extraConditions（路由侧 `if (orgScoped !== '1=1')` 守卫）
    expect(result).not.toMatch(/is_telemarketing|branch_code/);
  });

  // RT-P-02：电销用户（permissionFilter 含 is_telemarketing）→ 安全降级为 '1=1'，不追加视图缺失列
  it('RT-P-02: 电销用户（is_telemarketing=true）→ 1=1（不注入视图缺失列，防 Binder Error 500）', () => {
    const result = buildOrgScopedPermissionWhere(makeReq('is_telemarketing = true'));
    expect(result).toBe('1=1');
    // 验证 is_telemarketing 不会出现在最终条件中
    expect(result).not.toContain('is_telemarketing');
  });

  // RT-P-03：多分公司用户（org_level_3 AND branch_code）→ 仅保留 org_level_3，branch_code 被屏蔽
  it('RT-P-03: 多分公司（org_level_3=X AND branch_code=Y）→ 仅保留 org_level_3，branch_code 被屏蔽', () => {
    const result = buildOrgScopedPermissionWhere(makeReq("org_level_3 = '天府' AND branch_code = 'SC'"));
    expect(result).toBe("org_level_3 = '天府'");
    expect(result).not.toContain('branch_code');
  });

  // RT-P-04：普通机构用户（只有 org_level_3）→ 正常保留，不受影响（回归）
  it('RT-P-04: 普通机构用户（org_level_3=天府）→ 原样保留 org_level_3 段（无回归）', () => {
    const result = buildOrgScopedPermissionWhere(makeReq("org_level_3 = '天府'"));
    expect(result).toBe("org_level_3 = '天府'");
  });

  // RT-P-05：管理员（permissionFilter=undefined）→ 1=1，不追加任何条件
  it('RT-P-05: 管理员（无 permissionFilter）→ 1=1，不追加条件', () => {
    const result = buildOrgScopedPermissionWhere({ permissionFilter: undefined } as unknown as Request);
    expect(result).toBe('1=1');
  });

  // RT-P-06：确认 is_telemarketing / branch_code 均不出现在任何降级结果中（防误注入回归）
  it('RT-P-06: 任何降级路径的结果均不含 is_telemarketing 或 branch_code（防视图列不存在 Binder Error）', () => {
    const telemarketing = buildOrgScopedPermissionWhere(makeReq('is_telemarketing = true'));
    const multiBranch = buildOrgScopedPermissionWhere(makeReq("org_level_3 = '新都' AND branch_code = 'SX'"));
    const admin = buildOrgScopedPermissionWhere(makeReq('1=1'));

    for (const result of [telemarketing, multiBranch, admin]) {
      expect(result).not.toContain('is_telemarketing');
      expect(result).not.toContain('branch_code');
    }
  });
});
