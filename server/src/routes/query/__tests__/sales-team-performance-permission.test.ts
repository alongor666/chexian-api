import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { AddressInfo } from 'node:net';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../../../services/duckdb.js', () => ({
  duckdbService: { query: queryMock },
  DERIVED_RELATIONS: new Set(),
}));

import salesTeamPerformanceRouter from '../sales-team-performance.js';
import { errorHandler } from '../../../middleware/error.js';
import { registerBootstrapper } from '../../../services/bootstrapper-registry.js';

function endpointHandlers(): Array<(req: Request, res: Response, next: NextFunction) => unknown> {
  const layer = (salesTeamPerformanceRouter as any).stack.find(
    (candidate: any) =>
      candidate.route?.path === '/sales-team-performance' && candidate.route?.methods?.get,
  );
  if (!layer) throw new Error('GET /sales-team-performance 路由未找到');
  return layer.route.stack.map((entry: any) => entry.handle);
}

describe('sales-team-performance 路由权限附件', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => registerBootstrapper(null as any));

  it('org_user 在真实 GET 路由首个中间件收到 403，且 DuckDB 零调用', () => {
    const [permissionHandler] = endpointHandlers();
    const next = vi.fn();
    permissionHandler(
      { user: { role: 'org_user' } } as unknown as Request,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as { statusCode?: number } | undefined;
    expect(error?.statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('branch_admin 通过真实 GET 路由首个中间件', () => {
    const [permissionHandler] = endpointHandlers();
    const next = vi.fn();
    permissionHandler(
      { user: { role: 'branch_admin' } } as unknown as Request,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toEqual([]);
  });

  it('org_user 的完整 Router 请求在惰性加载前 403', async () => {
    const ensureDomainLoaded = vi.fn().mockResolvedValue(undefined);
    registerBootstrapper({ ensureDomainLoaded } as any);
    const app = express();
    app.use((req, _res, next) => {
      req.user = { role: 'org_user' } as any;
      next();
    });
    app.use(salesTeamPerformanceRouter);
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/sales-team-performance`);
      expect(response.status).toBe(403);
      expect(ensureDomainLoaded).not.toHaveBeenCalled();
      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
