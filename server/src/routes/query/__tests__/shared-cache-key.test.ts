import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request } from 'express';

let dataVersion = 'v-test-1';

vi.mock('../../../services/duckdb.js', () => ({
  duckdbService: {},
}));
vi.mock('../../../services/route-cache.js', () => ({
  getRouteCache: vi.fn(),
  getRouteCacheEntry: vi.fn(),
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
}));
vi.mock('../../../utils/api-meta.js', () => ({
  buildResponseMeta: vi.fn(),
}));
vi.mock('../../../config/comprehensive-thresholds.js', () => ({
  DEFAULT_COMPREHENSIVE_THRESHOLDS: {},
}));
vi.mock('../../../config/env.js', () => ({
  dbEnv: { ENABLE_QUERY_BUNDLES: 'true' },
}));
vi.mock('../../../utils/sql-sanitizer.js', () => ({
  isValidDateFormat: vi.fn(),
}));
vi.mock('../../../utils/filter-params.js', () => ({
  commonFilterSchema: {},
  buildWhereFromFilterParams: vi.fn(),
  buildWhereFromFilterParamsWithoutDate: vi.fn(),
}));
vi.mock('../../../utils/route-helpers.js', () => ({
  parseFiltersAndBuildWhere: vi.fn(),
  parseFiltersAndBuildBothWhere: vi.fn(),
  extractOrgNames: vi.fn(),
  extractSalesmanNames: vi.fn(),
  resolveGroupDim: vi.fn(),
}));
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../middleware/error.js', () => ({
  asyncHandler: (fn: unknown) => fn,
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('../../../services/data-version.js', () => ({
  getDataVersion: () => dataVersion,
}));

import { buildRouteCacheKey } from '../shared.js';

function makeReq(
  query: Record<string, unknown>,
  permissionFilter = 'org_level_3 IN (\'乐山\')',
  branchCode?: string,
  effectiveBranch?: string,
): Request {
  return {
    query,
    permissionFilter,
    effectiveBranch,
    user: branchCode !== undefined ? { branchCode } : undefined,
  } as unknown as Request;
}

describe('buildRouteCacheKey', () => {
  it('ignores cache-buster query params without changing semantic cache identity', () => {
    const base = makeReq({
      dateField: 'policy_date',
      startDate: '2026-01-01',
      endDate: '2026-05-11',
    });
    const withBust = makeReq({
      dateField: 'policy_date',
      startDate: '2026-01-01',
      endDate: '2026-05-11',
      _t: '1770000000000',
      _: '1770000000001',
      cacheBust: 'abc',
      cachebuster: 'def',
      timestamp: '1770000000002',
    });

    expect(buildRouteCacheKey(withBust, 'kpi')).toBe(buildRouteCacheKey(base, 'kpi'));
  });

  it('keeps real filter, permission, route-specific query, and data-version differences', () => {
    const base = buildRouteCacheKey(makeReq({
      dateField: 'policy_date',
      startDate: '2026-01-01',
      endDate: '2026-05-11',
      orgNames: '乐山,天府',
      salesmanNames: '张三',
      groupBy: 'org_level_3',
      drillPath: '[]',
      granularity: 'monthly',
    }), 'kpi');

    expect(buildRouteCacheKey(makeReq({
      dateField: 'policy_date',
      startDate: '2026-01-02',
      endDate: '2026-05-11',
      orgNames: '乐山,天府',
      salesmanNames: '张三',
      groupBy: 'org_level_3',
      drillPath: '[]',
      granularity: 'monthly',
    }), 'kpi')).not.toBe(base);

    expect(buildRouteCacheKey(makeReq({
      dateField: 'policy_date',
      startDate: '2026-01-01',
      endDate: '2026-05-11',
      orgNames: '乐山,天府',
      salesmanNames: '张三',
      groupBy: 'salesman_name',
      drillPath: '[]',
      granularity: 'monthly',
    }), 'kpi')).not.toBe(base);

    expect(buildRouteCacheKey(makeReq({
      dateField: 'policy_date',
      startDate: '2026-01-01',
      endDate: '2026-05-11',
      orgNames: '乐山,天府',
      salesmanNames: '张三',
      groupBy: 'org_level_3',
      drillPath: '[]',
      granularity: 'monthly',
    }, 'org_level_3 IN (\'天府\')'), 'kpi')).not.toBe(base);

    dataVersion = 'v-test-2';
    expect(buildRouteCacheKey(makeReq({
      dateField: 'policy_date',
      startDate: '2026-01-01',
      endDate: '2026-05-11',
      orgNames: '乐山,天府',
      salesmanNames: '张三',
      groupBy: 'org_level_3',
      drillPath: '[]',
      granularity: 'monthly',
    }), 'kpi')).not.toBe(base);
  });

  // 0B：BRANCH_RLS_ENABLED=true 时 permission.ts 注入 `branch_code='SC'` 到 req.permissionFilter，
  // 不同 branch 的同请求必须生成不同 cache key（避免 SC/SX 串读）。
  describe('multi-branch permissionFilter isolation', () => {
    beforeEach(() => {
      dataVersion = 'v-branch-test';
    });

    const baseQuery = {
      dateField: 'policy_date',
      startDate: '2026-01-01',
      endDate: '2026-05-11',
      perspective: 'premium',
    };

    it('admin SC vs admin SX → 不同 cache key', () => {
      const scKey = buildRouteCacheKey(makeReq(baseQuery, `branch_code = 'SC'`), 'dashboard-bundle');
      const sxKey = buildRouteCacheKey(makeReq(baseQuery, `branch_code = 'SX'`), 'dashboard-bundle');
      expect(scKey).not.toBe(sxKey);
      expect(scKey).toContain(`branch_code = 'SC'`);
      expect(sxKey).toContain(`branch_code = 'SX'`);
    });

    it('org_user 乐山 SC vs 乐山 SX → 不同 cache key（机构同名跨省）', () => {
      const scLeshan = buildRouteCacheKey(makeReq(baseQuery, `(org_level_3 = '乐山') AND branch_code = 'SC'`), 'kpi');
      const sxLeshan = buildRouteCacheKey(makeReq(baseQuery, `(org_level_3 = '乐山') AND branch_code = 'SX'`), 'kpi');
      expect(scLeshan).not.toBe(sxLeshan);
    });

    it('flag off 兼容期 1=1 vs flag on branch_code=SC → 不同 cache key（不串读）', () => {
      const flagOff = buildRouteCacheKey(makeReq(baseQuery, '1=1'), 'dashboard-bundle');
      const flagOnSc = buildRouteCacheKey(makeReq(baseQuery, `branch_code = 'SC'`), 'dashboard-bundle');
      expect(flagOff).not.toBe(flagOnSc);
    });

    it('同 branch 同请求 → 同 cache key（确定性，可命中预热）', () => {
      const a = buildRouteCacheKey(makeReq(baseQuery, `branch_code = 'SC'`), 'dashboard-bundle');
      const b = buildRouteCacheKey(makeReq(baseQuery, `branch_code = 'SC'`), 'dashboard-bundle');
      expect(a).toBe(b);
    });
  });

  // 0E codex P2 修复：flag off 兼容期 admin permissionFilter 都是 '1=1'，
  // 但响应体可能按 req.user.branchCode 变化（如 cross-sell 汇总行的 '四川分公司' 标签）。
  // cache key 必须独立含 b=<branchCode> 段，否则 SC 用户先请求的响应会缓给同 query 的 SX/全国 admin。
  describe('codex P2: flag off 兼容期按 user.branchCode 隔离 cache key', () => {
    beforeEach(() => {
      dataVersion = 'v-codex-p2';
    });

    const baseQuery = {
      dateField: 'policy_date',
      startDate: '2026-01-01',
      endDate: '2026-05-11',
    };

    it('同 permissionFilter=1=1 但 branchCode 不同 → 不同 cache key（防 cross-sell 汇总标签串读）', () => {
      const scAdmin = buildRouteCacheKey(makeReq(baseQuery, '1=1', 'SC'), 'cross-sell');
      const sxAdmin = buildRouteCacheKey(makeReq(baseQuery, '1=1', 'SX'), 'cross-sell');
      expect(scAdmin).not.toBe(sxAdmin);
      expect(scAdmin).toContain('b=SC');
      expect(sxAdmin).toContain('b=SX');
    });

    it('admin SC（branchCode=SC）vs 系统级超管（branchCode undefined）→ 不同 cache key', () => {
      const sc = buildRouteCacheKey(makeReq(baseQuery, '1=1', 'SC'), 'cross-sell');
      const superAdmin = buildRouteCacheKey(makeReq(baseQuery, '1=1'), 'cross-sell'); // req.user undefined
      expect(sc).not.toBe(superAdmin);
      expect(sc).toContain('b=SC');
      expect(superAdmin).toContain('b=_');
    });

    it('同 branchCode + 同请求 → 同 cache key（确定性，预热可命中）', () => {
      const a = buildRouteCacheKey(makeReq(baseQuery, '1=1', 'SC'), 'cross-sell');
      const b = buildRouteCacheKey(makeReq(baseQuery, '1=1', 'SC'), 'cross-sell');
      expect(a).toBe(b);
    });
  });

  // 全国超管切省（effectiveBranch）：SC / SX / ALL 三态 cache key 必须互异，防跨省串读（CRITICAL）。
  // branchCode 恒为 'SC'（默认省），仅靠 b=SC 段无法区分 → 必须含 effectiveBranch。
  describe('全国超管 effectiveBranch 隔离 cache key（切省防串读）', () => {
    beforeEach(() => {
      dataVersion = 'v-superadmin';
    });
    const baseQuery = {
      dateField: 'policy_date',
      startDate: '2026-01-01',
      endDate: '2026-05-11',
    };

    it('超管 SC / SX / ALL 三态 → 三个互不相同的 cache key', () => {
      // SC: targetBranch=SC, permissionFilter=branch_code='SC', effectiveBranch='SC'
      const sc = buildRouteCacheKey(
        makeReq({ ...baseQuery, targetBranch: 'SC' }, `branch_code = 'SC'`, 'SC', 'SC'), 'kpi');
      // SX: targetBranch=SX, permissionFilter=branch_code='SX', effectiveBranch='SX'
      const sx = buildRouteCacheKey(
        makeReq({ ...baseQuery, targetBranch: 'SX' }, `branch_code = 'SX'`, 'SC', 'SX'), 'kpi');
      // ALL: targetBranch=ALL, permissionFilter=branch_code IN ('SC','SX'), effectiveBranch='ALL'
      const all = buildRouteCacheKey(
        makeReq({ ...baseQuery, targetBranch: 'ALL' }, `branch_code IN ('SC', 'SX')`, 'SC', 'ALL'), 'kpi');
      expect(new Set([sc, sx, all]).size).toBe(3);
      expect(sc).toContain('b=SC');
      expect(sx).toContain('b=SX');
      expect(all).toContain('b=ALL');
    });

    it('超管 SX 与「普通 SX admin」(同 permissionFilter)→ 不串读（b 段一致是同省同数据，正确共享）', () => {
      // 超管切 SX：effectiveBranch=SX → b=SX；普通 SX admin：branchCode=SX，effectiveBranch=SX → b=SX
      const superSx = buildRouteCacheKey(
        makeReq({ ...baseQuery, targetBranch: 'SX' }, `branch_code = 'SX'`, 'SC', 'SX'), 'kpi');
      const plainSx = buildRouteCacheKey(
        makeReq(baseQuery, `branch_code = 'SX'`, 'SX', 'SX'), 'kpi');
      // permissionFilter 同（branch_code='SX'）、b 段同（SX）→ 但 query 段不同（超管带 targetBranch=SX）
      // 二者数据同省同口径，cache key 是否相同不影响安全（都看 SX）。此处仅验 effectiveBranch 段为 SX。
      expect(superSx).toContain('b=SX');
      expect(plainSx).toContain('b=SX');
    });

    it('普通用户无 effectiveBranch（旧路径）→ 回落 branchCode 段，字节不变（cache-warmer 对齐）', () => {
      const withEff = buildRouteCacheKey(makeReq(baseQuery, `branch_code = 'SC'`, 'SC', 'SC'), 'kpi');
      const noEff = buildRouteCacheKey(makeReq(baseQuery, `branch_code = 'SC'`, 'SC'), 'kpi');
      expect(withEff).toBe(noEff); // effectiveBranch='SC' == branchCode='SC' → 同 key
    });
  });
});
