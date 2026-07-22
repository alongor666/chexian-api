import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error.js';
import { rejectUnknownRegisteredQueryParams } from '../query-param-contract.js';

function invoke(path: string, query: Record<string, unknown>): unknown {
  const next = vi.fn();
  rejectUnknownRegisteredQueryParams(
    { path, query } as unknown as Request,
    {} as Response,
    next as unknown as NextFunction,
  );
  return next.mock.calls[0]?.[0];
}

describe('registered query parameter contract middleware', () => {
  it('allows common, route-specific, RLS and non-semantic parameters', () => {
    expect(invoke('/trend', {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      granularity: 'week',
      targetBranch: 'SC',
      cacheBust: '123',
    })).toBeUndefined();
  });

  it('rejects unknown names without echoing their values', () => {
    const error = invoke('/trend', { startDtae: 'secret-value' });
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(400);
    expect((error as Error).message).toContain('startDtae');
    expect((error as Error).message).not.toContain('secret-value');
  });

  it('keeps all claims-detail filters consumed by the handler legal', () => {
    expect(invoke('/claims-detail/cause-analysis', {
      insuranceType: '商业险',
      enterpriseCar: 'false',
      fuelCategory: '新能源',
      targetBranch: 'SC',
    })).toBeUndefined();
    expect(invoke('/claims-detail/heatmap', {
      insuranceType: '商业险',
      enterpriseCar: 'false',
      fuelCategory: '新能源',
    })).toBeUndefined();
  });

  it('does not claim coverage for unregistered routes', () => {
    expect(invoke('/experimental-not-registered', { any: 'value' })).toBeUndefined();
  });
});
