import { describe, expect, it, vi } from 'vitest';
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

function makeReq(query: Record<string, unknown>, permissionFilter = 'org_level_3 IN (\'乐山\')'): Request {
  return {
    query,
    permissionFilter,
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
});
