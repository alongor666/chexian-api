import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../../../services/duckdb.js', () => ({
  duckdbService: { query: queryMock },
  DERIVED_RELATIONS: new Set(),
}));

import salesTeamPerformanceRouter from '../sales-team-performance.js';

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
});
