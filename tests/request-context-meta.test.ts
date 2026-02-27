import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  buildRequestContext,
  getRequestContext,
  getServerTimingValue,
  markRequestCacheHit,
  recordQueryMetric,
  runWithRequestContext,
} from '../server/src/utils/request-context';
import { buildResponseMeta } from '../server/src/utils/api-meta';

function mockRequest(query: Record<string, string>): Request {
  return {
    originalUrl: '/api/query/cross-sell-summary',
    path: '/api/query/cross-sell-summary',
    query,
  } as unknown as Request;
}

describe('request-context + api-meta', () => {
  it('buildRequestContext should generate stable query hash for same params in different order', () => {
    const a = buildRequestContext(mockRequest({ startDate: '2026-01-01', endDate: '2026-01-31' }));
    const b = buildRequestContext(mockRequest({ endDate: '2026-01-31', startDate: '2026-01-01' }));

    expect(a.routeKey).toBe('/api/query/cross-sell-summary');
    expect(a.queryHash).toBe(b.queryHash);
  });

  it('records sql metrics and exposes api response meta', () => {
    const ctx = buildRequestContext(mockRequest({ dateField: 'policy_date' }));
    const setHeader = vi.fn();
    const res = { setHeader } as unknown as Response;

    runWithRequestContext(ctx, () => {
      recordQueryMetric('SELECT 1', 12, false);
      recordQueryMetric('SELECT 2', 3, true);

      const runtimeCtx = getRequestContext();
      expect(runtimeCtx?.sqlTimeMs).toBe(15);
      expect(runtimeCtx?.cacheHit).toBe(true);
      expect(runtimeCtx?.queryCount).toBe(2);

      const serverTiming = getServerTimingValue();
      expect(serverTiming).toContain('db;dur=15');

      const meta = buildResponseMeta(res);
      expect(meta.requestId).toBe(runtimeCtx?.requestId);
      expect(meta.cacheHit).toBe(true);
      expect(meta.serverTiming).toContain('db;dur=15');
      expect(typeof meta.dataVersion).toBe('string');
    });

    expect(setHeader).toHaveBeenCalledWith('Server-Timing', expect.stringContaining('db;dur=15'));
  });

  it('supports route-level cache hit mark without sql metrics', () => {
    const ctx = buildRequestContext(mockRequest({ granularity: 'monthly' }));
    runWithRequestContext(ctx, () => {
      markRequestCacheHit();
      const meta = buildResponseMeta();
      expect(meta.cacheHit).toBe(true);
    });
  });
});
