import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../../../services/duckdb.js', () => ({
  duckdbService: { query: queryMock },
  DERIVED_RELATIONS: new Set(),
}));

import salesTeamPerformanceRouter, { salesTeamPerformanceQuerySchema } from '../sales-team-performance.js';
import { errorHandler } from '../../../middleware/error.js';
import { registerBootstrapper } from '../../../services/bootstrapper-registry.js';

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  registerBootstrapper(null as any);
  const app = express();
  app.use((req, _res, next) => {
    req.user = { role: 'branch_admin' } as any;
    next();
  });
  app.use(salesTeamPerformanceRouter);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('sales-team-performance handler 行为', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => registerBootstrapper(null as any));

  it('Zod 契约接受目录枚举并拒绝非法维度、自然日和 limit', () => {
    expect(salesTeamPerformanceQuerySchema.safeParse({ dimension: 'team', limit: '10' }).success).toBe(true);
    expect(salesTeamPerformanceQuerySchema.safeParse({ dimension: '机构' }).success).toBe(false);
    expect(salesTeamPerformanceQuerySchema.safeParse({ start: '2026-02-30' }).success).toBe(false);
    expect(salesTeamPerformanceQuerySchema.safeParse({ limit: '3.5' }).success).toBe(false);
  });

  it('执行明细+合计两次查询，规范化 BigInt 并支持 ETag 304', async () => {
    queryMock
      .mockResolvedValueOnce([{
        dim_value: '甲',
        sales_team_row_count: 2n,
        received_premium: 300,
        standard_premium: 360,
      }])
      .mockResolvedValueOnce([{
        sales_team_row_count: 2n,
        received_premium: 300,
        standard_premium: 360,
        latest_confirm_date: '2026-06-02',
      }]);

    await withServer(async (baseUrl) => {
      const url = `${baseUrl}/sales-team-performance?dimension=salesman&start=2026-06-01&end=2026-06-02&limit=10`;
      const first = await fetch(url);
      expect(first.status).toBe(200);
      const etag = first.headers.get('etag');
      expect(etag).toBeTruthy();
      const body = await first.json() as any;
      expect(body.data.rows[0]).toMatchObject({ sales_team_row_count: 2, standard_premium: 360 });
      expect(body.data.total).toMatchObject({ sales_team_row_count: 2, latest_confirm_date: '2026-06-02' });
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(queryMock.mock.calls[0]?.[0]).toContain("DATE '2026-06-01'");
      expect(queryMock.mock.calls[0]?.[0]).toContain('LIMIT 10');

      const conditional = await fetch(url, { headers: { 'If-None-Match': etag! } });
      expect(conditional.status).toBe(304);
      expect(queryMock).toHaveBeenCalledTimes(2);
    });
  });

  it('不可能的自然日稳定返回中文 400，且不查询 DuckDB', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sales-team-performance?start=2026-02-30`);
      expect(response.status).toBe(400);
      const body = await response.json() as any;
      expect(body.error.message).toContain('开始日期');
      expect(queryMock).not.toHaveBeenCalled();
    });
  });
});
