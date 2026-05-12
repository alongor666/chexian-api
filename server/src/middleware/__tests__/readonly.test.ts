/**
 * readonlyMiddleware 单元测试
 *
 * 不变量：req.pat 存在 + req.method 非 GET/HEAD → 403
 */
import { describe, it, expect, vi } from 'vitest';
import { readonlyMiddleware } from '../readonly.js';
import { AppError } from '../error.js';

type Req = { pat?: { tokenId: string; name: string }; method: string };

function run(req: Req): Error | undefined {
  const next = vi.fn();
  readonlyMiddleware(req as any, {} as any, next);
  const arg = next.mock.calls[0]?.[0];
  return arg instanceof Error ? arg : undefined;
}

describe('readonlyMiddleware', () => {
  it('PAT + POST → 403 AppError', () => {
    const err = run({ pat: { tokenId: 'AB12CD34', name: 'cli' }, method: 'POST' });
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).message).toMatch(/read-only/);
  });

  it('PAT + PUT → 403', () => {
    expect(run({ pat: { tokenId: 't', name: 'x' }, method: 'PUT' })).toBeInstanceOf(AppError);
  });

  it('PAT + DELETE → 403', () => {
    expect(run({ pat: { tokenId: 't', name: 'x' }, method: 'DELETE' })).toBeInstanceOf(AppError);
  });

  it('PAT + PATCH → 403', () => {
    expect(run({ pat: { tokenId: 't', name: 'x' }, method: 'PATCH' })).toBeInstanceOf(AppError);
  });

  it('PAT + GET → 通过', () => {
    expect(run({ pat: { tokenId: 't', name: 'x' }, method: 'GET' })).toBeUndefined();
  });

  it('PAT + HEAD → 通过（CDN/probe 友好）', () => {
    expect(run({ pat: { tokenId: 't', name: 'x' }, method: 'HEAD' })).toBeUndefined();
  });

  it('JWT（无 req.pat） + POST → 通过', () => {
    expect(run({ method: 'POST' })).toBeUndefined();
  });

  it('JWT + GET → 通过', () => {
    expect(run({ method: 'GET' })).toBeUndefined();
  });
});
