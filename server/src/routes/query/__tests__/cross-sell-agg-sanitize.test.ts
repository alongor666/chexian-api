/**
 * Phase 0 止血：CrossSellDailyAgg 净化副本 — 单元测试
 * （筛选器联动治理计划 2026-06-10，BACKLOG 0f01e6）
 *
 * CrossSellDailyAgg 物化表不含 insurance_type / fuel_type / vehicle_model 列，
 * 共享 parser 按这些参数注入 WHERE 会触发 DuckDB Binder Error（HTTP 400）。
 *
 * 双向断言（评审 🔴1 指出的测试盲区）：
 * ① 净化后 parser 产出的 WHERE 不含 agg 表不存在的列（修 400）
 * ② 险类子句仍从原始 req.query 读取，COALESCE(compulsory_premium,0)>0 不被误伤
 *    （防"修好 400 换来一个测试抓不到的静默 bug"）
 * ③ sanitizeAggQuery 不修改入参对象（immutability 红线）
 *
 * 通过 vi.mock 阻断 shared.ts 传递链中对 DuckDB 原生模块的加载
 * （参 domain-middleware.test.ts 同款配方；filter-params / route-helpers 用真实实现）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';

// ── mock DuckDB 相关模块，防止原生 .node addon 加载 ──
vi.mock('../../../services/duckdb.js', () => ({
  duckdbService: {},
  DERIVED_RELATIONS: new Set(),
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../services/bootstrapper-registry.js', () => ({
  getBootstrapper: vi.fn(() => null),
  registerBootstrapper: vi.fn(),
}));

import { sanitizeAggQuery, buildCrossSellAggInsuranceClause } from '../cross-sell.js';
import { parseFiltersAndBuildWhere } from '../../../utils/route-helpers.js';

function mockReq(query: Record<string, string>): Request {
  return { query, permissionFilter: '1=1' } as unknown as Request;
}

describe('sanitizeAggQuery — CrossSellDailyAgg 不支持列的净化副本', () => {
  it('剥离 insuranceType（由 buildCrossSellAggInsuranceClause 处理），其余字段透传', () => {
    const out = sanitizeAggQuery({ insuranceType: 'true', startDate: '2026-01-01' } as Request['query']);
    expect(out.insuranceType).toBeUndefined();
    expect(out.startDate).toBe('2026-01-01');
  });

  it('不修改入参对象（immutability）', () => {
    const query = { insuranceType: 'true', fuelCategory: 'gas', vehicleQuickFilter: 'dump' } as Request['query'];
    sanitizeAggQuery(query);
    expect(query).toEqual({ insuranceType: 'true', fuelCategory: 'gas', vehicleQuickFilter: 'dump' });
  });

  it('gas/oil 防御性剥离且不做语义映射（评审 🔴2：禁止降级为 isNev=false）', () => {
    const gas = sanitizeAggQuery({ fuelCategory: 'gas' } as Request['query']);
    expect(gas.fuelCategory).toBeUndefined();
    expect(gas.isNev).toBeUndefined();
    const oil = sanitizeAggQuery({ fuelCategory: 'oil' } as Request['query']);
    expect(oil.fuelCategory).toBeUndefined();
    expect(oil.isNev).toBeUndefined();
  });

  it('electric 透传（parser 产出 is_nev = true，agg 有该列，与 SSOT 严格等价）', () => {
    expect(sanitizeAggQuery({ fuelCategory: 'electric' } as Request['query']).fuelCategory).toBe('electric');
  });

  it('dump/tractor/general 剥离（依赖 vehicle_model），home_car/truck_1t 透传', () => {
    for (const vqf of ['dump', 'tractor', 'general']) {
      expect(sanitizeAggQuery({ vehicleQuickFilter: vqf } as Request['query']).vehicleQuickFilter).toBeUndefined();
    }
    expect(sanitizeAggQuery({ vehicleQuickFilter: 'home_car' } as Request['query']).vehicleQuickFilter).toBe('home_car');
    expect(sanitizeAggQuery({ vehicleQuickFilter: 'truck_1t' } as Request['query']).vehicleQuickFilter).toBe('truck_1t');
  });
});

describe('净化副本 + 真实 parser 组合（防 Binder Error + 防险类静默失效）', () => {
  it('insuranceType=true：WHERE 不含 insurance_type =，险类子句仍生效（读原始 query）', () => {
    const req = mockReq({ insuranceType: 'true' });
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeAggQuery(req.query));
    expect(whereClause).not.toMatch(/insurance_type\s*=/);
    // 评审 🔴1：若先 delete req.query 再 parse，下面这条会拿到 '' → 静默失效
    expect(buildCrossSellAggInsuranceClause(req.query.insuranceType)).toBe('COALESCE(compulsory_premium, 0) > 0');
  });

  it('insuranceType=false：商业口径子句仍生效', () => {
    const req = mockReq({ insuranceType: 'false' });
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeAggQuery(req.query));
    expect(whereClause).not.toMatch(/insurance_type\s*=/);
    expect(buildCrossSellAggInsuranceClause(req.query.insuranceType)).toBe('COALESCE(commercial_premium, 0) > 0');
  });

  it('fuelCategory=gas：WHERE 不含 fuel_type，也不含降级的 is_nev', () => {
    const req = mockReq({ fuelCategory: 'gas' });
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeAggQuery(req.query));
    expect(whereClause).not.toContain('fuel_type');
    expect(whereClause).not.toContain('is_nev');
  });

  it('fuelCategory=electric：保留 is_nev = true', () => {
    const req = mockReq({ fuelCategory: 'electric' });
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeAggQuery(req.query));
    expect(whereClause).toContain('is_nev = true');
    expect(whereClause).not.toContain('fuel_type');
  });

  it('vehicleQuickFilter=dump：WHERE 不含 vehicle_model', () => {
    const req = mockReq({ vehicleQuickFilter: 'dump' });
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeAggQuery(req.query));
    expect(whereClause).not.toContain('vehicle_model');
  });

  it('vehicleQuickFilter=truck_1t：保留 customer_category + tonnage_segment 条件（agg 有列）', () => {
    const req = mockReq({ vehicleQuickFilter: 'truck_1t' });
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeAggQuery(req.query));
    expect(whereClause).toContain('customer_category');
    expect(whereClause).toContain('tonnage_segment');
  });

  it('未净化时 parser 注入 insurance_type =（坐实原 bug，防误删 sanitize 调用）', () => {
    const req = mockReq({ insuranceType: 'true' });
    const { whereClause } = parseFiltersAndBuildWhere(req);
    expect(whereClause).toMatch(/insurance_type\s*=/);
  });
});
