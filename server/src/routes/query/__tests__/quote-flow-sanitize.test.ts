/**
 * BACKLOG 8f71c0/96e597：报价转化页 + 客户来源页「列不存在：policy_date」修复 — 单元测试
 *
 * 根因：两路由直调 parseFiltersAndBuildWhere(req)，请求携带 startDate/endDate 时共享 parser
 * 按默认口径 policy_date 注入日期条件，而 QuoteConversion / CustomerFlow 视图均无该列
 * → DuckDB Binder Error → HTTP 400「列不存在：policy_date」（2026-06-27 山西 13 账号验证
 * harness 全路由附加 startDate/endDate 撞出；与省份无关，SC 带同参数同样报错）。
 *
 * 双向断言（对齐 cross-sell-agg-sanitize.test.ts 先例）：
 * ① 净化后 parser 产出的 WHERE 不含视图不存在的列（修 400）
 * ② 时间窗意图不静默丢弃：quote 域映射为 dateStart/dateEnd（quote_time 口径）、
 *    customer-flow 域强制 dateField=insurance_start_date（视图真实日期列）
 * ③ sanitize/构造函数不修改入参对象（immutability 红线）
 *
 * 通过 vi.mock 阻断 shared.ts 传递链中对 DuckDB 原生模块的加载
 * （与 cross-sell-agg-sanitize.test.ts 同款配方；filter-params / route-helpers 用真实实现）。
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
vi.mock('../../../utils/logger.js', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: stub, createLogger: () => stub };
});
vi.mock('../../../services/bootstrapper-registry.js', () => ({
  getBootstrapper: vi.fn(() => null),
  registerBootstrapper: vi.fn(),
}));

import { buildQuoteEffectiveQuery } from '../quote-conversion.js';
import { sanitizeFlowQuery } from '../customer-flow.js';
import { parseFiltersAndBuildWhere } from '../../../utils/route-helpers.js';

function mockReq(query: Record<string, string>, permissionFilter = '1=1'): Request {
  return { query, permissionFilter } as unknown as Request;
}

describe('buildQuoteEffectiveQuery — QuoteConversion 视图不支持参数的净化副本', () => {
  it('startDate/endDate 映射为 dateStart/dateEnd（quote_time 口径），并从共享副本剥离', () => {
    const { domainQuery, commonQuery } = buildQuoteEffectiveQuery({
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    } as Request['query']);
    expect(domainQuery.dateStart).toBe('2026-01-01');
    expect(domainQuery.dateEnd).toBe('2026-06-30');
    expect(commonQuery.startDate).toBeUndefined();
    expect(commonQuery.endDate).toBeUndefined();
    expect(commonQuery.dateField).toBeUndefined();
  });

  it('本域已有 dateStart/dateEnd 时优先，不被 startDate/endDate 覆盖', () => {
    const { domainQuery } = buildQuoteEffectiveQuery({
      startDate: '2026-01-01',
      dateStart: '2026-03-01',
    } as Request['query']);
    expect(domainQuery.dateStart).toBe('2026-03-01');
  });

  it('本域 dateStart 为空串时视同缺省，startDate 映射仍生效（防时间窗静默丢失）', () => {
    const { domainQuery } = buildQuoteEffectiveQuery({
      startDate: '2026-01-01',
      dateStart: '',
    } as Request['query']);
    expect(domainQuery.dateStart).toBe('2026-01-01');
  });

  it('startDate 为数组（重复参数）时不映射、仍从共享副本剥离（不产出 policy_date）', () => {
    const { domainQuery, commonQuery } = buildQuoteEffectiveQuery({
      startDate: ['2026-01-01', '2026-02-01'],
    } as unknown as Request['query']);
    expect(domainQuery.dateStart).toBeUndefined();
    expect(commonQuery.startDate).toBeUndefined();
  });

  it('剥离视图不存在列 / 类型不符的通用参数，保留支持的参数', () => {
    const { commonQuery } = buildQuoteEffectiveQuery({
      renewalModes: '自留',
      isRenewal: 'true',
      isNewCar: 'true',
      isRenewable: 'true',
      isCrossSell: 'true',
      isCommercialInsure: 'true',
      isNev: 'true',
      isTransfer: 'true',
      fuelCategory: 'electric',
      orgNames: '大同',
      customerCategories: '非营业个人客车',
      tonnageSegments: '2-9吨',
      insuranceGrades: 'A',
      salesmanNames: '张三',
    } as Request['query']);
    for (const gone of ['renewalModes', 'isRenewal', 'isNewCar', 'isRenewable', 'isCrossSell', 'isCommercialInsure', 'isNev', 'isTransfer', 'fuelCategory']) {
      expect(commonQuery[gone], gone).toBeUndefined();
    }
    expect(commonQuery.orgNames).toBe('大同');
    expect(commonQuery.customerCategories).toBe('非营业个人客车');
    expect(commonQuery.tonnageSegments).toBe('2-9吨');
    expect(commonQuery.insuranceGrades).toBe('A');
    expect(commonQuery.salesmanNames).toBe('张三');
  });

  it('vehicleQuickFilter：dump/tractor/general 剥离（依赖 vehicle_model），truck_1t/home_car 透传', () => {
    for (const vqf of ['dump', 'tractor', 'general']) {
      expect(buildQuoteEffectiveQuery({ vehicleQuickFilter: vqf } as Request['query']).commonQuery.vehicleQuickFilter).toBeUndefined();
    }
    expect(buildQuoteEffectiveQuery({ vehicleQuickFilter: 'truck_1t' } as Request['query']).commonQuery.vehicleQuickFilter).toBe('truck_1t');
    expect(buildQuoteEffectiveQuery({ vehicleQuickFilter: 'home_car' } as Request['query']).commonQuery.vehicleQuickFilter).toBe('home_car');
  });

  it('不修改入参对象（immutability）', () => {
    const query = { startDate: '2026-01-01', isNev: 'true' } as Request['query'];
    buildQuoteEffectiveQuery(query);
    expect(query).toEqual({ startDate: '2026-01-01', isNev: 'true' });
  });
});

describe('sanitizeFlowQuery — CustomerFlow 10 列视图不支持参数的净化副本', () => {
  it('保留 startDate/endDate，dateField 强制 insurance_start_date（含显式 policy_date 时）', () => {
    const out = sanitizeFlowQuery({
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      dateField: 'policy_date',
    } as Request['query']);
    expect(out.startDate).toBe('2026-01-01');
    expect(out.endDate).toBe('2026-06-30');
    expect(out.dateField).toBe('insurance_start_date');
  });

  it('无日期参数时不注入 dateField', () => {
    expect(sanitizeFlowQuery({ year: '2026' } as Request['query']).dateField).toBeUndefined();
  });

  it('剥离视图不存在列的维度参数，保留支持的参数', () => {
    const out = sanitizeFlowQuery({
      salesmanNames: '张三',
      salesmanName: '李四',
      renewalModes: '自留',
      tonnageSegments: '2-9吨',
      insuranceGrades: 'A',
      isRenewal: 'true',
      isNewCar: 'true',
      isTransfer: 'true',
      isNev: 'true',
      isRenewable: 'true',
      isCrossSell: 'true',
      isCommercialInsure: 'true',
      fuelCategory: 'electric',
      orgNames: '大同',
      customerCategories: '非营业个人客车',
      coverageCombinations: '主全',
      isTelemarketing: 'true',
      insuranceType: 'true',
    } as Request['query']);
    for (const gone of ['salesmanNames', 'salesmanName', 'renewalModes', 'tonnageSegments', 'insuranceGrades', 'isRenewal', 'isNewCar', 'isTransfer', 'isNev', 'isRenewable', 'isCrossSell', 'isCommercialInsure', 'fuelCategory']) {
      expect(out[gone], gone).toBeUndefined();
    }
    expect(out.orgNames).toBe('大同');
    expect(out.customerCategories).toBe('非营业个人客车');
    expect(out.coverageCombinations).toBe('主全');
    expect(out.isTelemarketing).toBe('true');
    expect(out.insuranceType).toBe('true');
  });

  it('vehicleQuickFilter：仅保留只用 customer_category 的取值', () => {
    for (const keep of ['home_car', 'motorcycle', 'rental']) {
      expect(sanitizeFlowQuery({ vehicleQuickFilter: keep } as Request['query']).vehicleQuickFilter).toBe(keep);
    }
    for (const gone of ['truck_1t', 'truck_2_9t', 'truck_1_2t', 'dump', 'tractor', 'general']) {
      expect(sanitizeFlowQuery({ vehicleQuickFilter: gone } as Request['query']).vehicleQuickFilter).toBeUndefined();
    }
  });

  it('不修改入参对象（immutability）', () => {
    const query = { startDate: '2026-01-01', salesmanNames: '张三' } as Request['query'];
    sanitizeFlowQuery(query);
    expect(query).toEqual({ startDate: '2026-01-01', salesmanNames: '张三' });
  });
});

describe('净化副本 + 真实 parser 组合（防 Binder Error 回归 — 原始事故场景）', () => {
  const HARNESS_QUERY = { startDate: '2026-01-01', endDate: '2026-06-30' };

  it('quote：startDate/endDate 不再产出 policy_date 条件（原 400 场景）', () => {
    const req = mockReq({ ...HARNESS_QUERY }, "branch_code = 'SX'");
    const { commonQuery } = buildQuoteEffectiveQuery(req.query);
    const { whereClause } = parseFiltersAndBuildWhere(req, commonQuery);
    expect(whereClause).not.toContain('policy_date');
    expect(whereClause).toContain("branch_code = 'SX'");
  });

  it('customer-flow：startDate/endDate 产出 insurance_start_date 窗口条件（原 400 场景）', () => {
    const req = mockReq({ ...HARNESS_QUERY }, "branch_code = 'SX'");
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeFlowQuery(req.query));
    expect(whereClause).not.toContain('policy_date');
    expect(whereClause).toContain('insurance_start_date');
    expect(whereClause).toContain("branch_code = 'SX'");
  });

  it('customer-flow：isNev/fuelCategory 不再产出 is_nev/fuel_type 条件', () => {
    const req = mockReq({ isNev: 'true', fuelCategory: 'gas' });
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeFlowQuery(req.query));
    expect(whereClause).not.toContain('is_nev');
    expect(whereClause).not.toContain('fuel_type');
  });

  it('quote：无通用参数时 whereClause 与净化前等价（SC 存量流量字节安全）', () => {
    const req = mockReq({});
    const before = parseFiltersAndBuildWhere(req).whereClause;
    const { commonQuery } = buildQuoteEffectiveQuery(req.query);
    const after = parseFiltersAndBuildWhere(req, commonQuery).whereClause;
    expect(after).toBe(before);
  });

  it('customer-flow：无通用参数时 whereClause 与净化前等价（SC 存量流量字节安全）', () => {
    const req = mockReq({ year: '2026' });
    const before = parseFiltersAndBuildWhere(req).whereClause;
    const after = parseFiltersAndBuildWhere(req, sanitizeFlowQuery(req.query)).whereClause;
    expect(after).toBe(before);
  });

  it('customer-flow：startDate 为数组（重复参数）时仍走 zod 校验报 400（与共享 parser 各路由既有行为一致）', () => {
    // 行为固定（code-reviewer 闸 MEDIUM）：sanitizeFlowQuery 不改动数组形态的 startDate，
    // commonFilterSchema z.string() 解析失败 → AppError(400)。quote 域则是映射跳过 + 剥离
    // （见上方数组用例）——两域对不合规输入的处置路径不同但均为受控行为。
    const req = { query: { startDate: ['2026-01-01', '2026-02-01'] }, permissionFilter: '1=1' } as unknown as Request;
    expect(() => parseFiltersAndBuildWhere(req, sanitizeFlowQuery(req.query))).toThrowError();
  });
});
