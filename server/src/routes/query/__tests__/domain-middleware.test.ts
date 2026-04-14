/**
 * createDomainMiddleware — 单元测试
 *
 * 测试集中式惰性域加载中间件工厂的行为：
 * - bootstrapper 未初始化时直接调用 next()
 * - 所有域加载成功时调用 next()
 * - 域加载超时（statusCode=503）时将错误传给 next(err)
 * - 域加载失败（通用错误）时将错误传给 next(err)
 *
 * 通过 vi.mock 阻断 shared.ts 传递链中对 DuckDB 原生模块的加载。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction } from 'express';

// ── mock DuckDB 相关模块，防止原生 .node addon 加载 ──
vi.mock('../../../services/duckdb.js', () => ({
  duckdbService: {},
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
vi.mock('../../../utils/sql-sanitizer.js', () => ({
  isValidDateFormat: vi.fn(),
  sanitizeTableName: vi.fn(),
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
  asyncHandler: (fn: any) => fn,
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('../../../types/data.js', () => ({}));

// bootstrapper-registry mock 控制点（每个测试可覆盖）
vi.mock('../../../services/bootstrapper-registry.js', () => ({
  getBootstrapper: vi.fn(() => null),
  registerBootstrapper: vi.fn(),
}));

import { createDomainMiddleware } from '../shared.js';
import { getBootstrapper } from '../../../services/bootstrapper-registry.js';

// 最简 Request/Response stub（createDomainMiddleware 不使用 req/res）
const mockReq = {} as Request;
const mockRes = {} as Response;

describe('createDomainMiddleware — 惰性域加载中间件工厂', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // DM-01: bootstrapper 未初始化时直接 next()，不抛错
  it('DM-01: bootstrapper 为 null 时直接调用 next()，不阻塞', async () => {
    (getBootstrapper as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const next = vi.fn() as unknown as NextFunction;
    const middleware = createDomainMiddleware('SomeDomain');

    await middleware(mockReq as any, mockRes as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(); // next() with no args
  });

  // DM-02: 所有域加载成功时调用 next()
  it('DM-02: 所有域加载成功时调用 next()，无错误参数', async () => {
    const mockBootstrapper = {
      ensureDomainLoaded: vi.fn().mockResolvedValue(undefined),
    };
    (getBootstrapper as ReturnType<typeof vi.fn>).mockReturnValue(mockBootstrapper);

    const next = vi.fn() as unknown as NextFunction;
    const middleware = createDomainMiddleware('DomainA', 'DomainB');

    await middleware(mockReq as any, mockRes as any, next);

    expect(mockBootstrapper.ensureDomainLoaded).toHaveBeenCalledTimes(2);
    expect(mockBootstrapper.ensureDomainLoaded).toHaveBeenCalledWith('DomainA');
    expect(mockBootstrapper.ensureDomainLoaded).toHaveBeenCalledWith('DomainB');
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(); // next() with no args
  });

  // DM-03: ensureDomainLoaded 抛出 statusCode=503（超时）时将 err 传给 next
  it('DM-03: 域加载超时（503）时将错误传给 next(err)', async () => {
    const timeoutErr = Object.assign(
      new Error('Domain ClaimsDetail loading timeout (15000ms)'),
      { statusCode: 503 }
    );
    const mockBootstrapper = {
      ensureDomainLoaded: vi.fn().mockRejectedValue(timeoutErr),
    };
    (getBootstrapper as ReturnType<typeof vi.fn>).mockReturnValue(mockBootstrapper);

    const next = vi.fn() as unknown as NextFunction;
    const middleware = createDomainMiddleware('ClaimsDetail');

    await middleware(mockReq as any, mockRes as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(timeoutErr);
    const passedErr = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(passedErr.statusCode).toBe(503);
  });

  // DM-04: ensureDomainLoaded 抛出通用错误时将 err 传给 next
  it('DM-04: 域加载失败（通用错误）时将错误传给 next(err)', async () => {
    const genericErr = new Error('Parquet loading failed: file not found');
    const mockBootstrapper = {
      ensureDomainLoaded: vi.fn().mockRejectedValue(genericErr),
    };
    (getBootstrapper as ReturnType<typeof vi.fn>).mockReturnValue(mockBootstrapper);

    const next = vi.fn() as unknown as NextFunction;
    const middleware = createDomainMiddleware('BrandDim');

    await middleware(mockReq as any, mockRes as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(genericErr);
  });
});
