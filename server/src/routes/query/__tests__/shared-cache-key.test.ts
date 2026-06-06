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
): Request {
  return {
    query,
    permissionFilter,
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
});
