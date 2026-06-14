/**
 * requireBranchAdmin middleware — 单元测试
 *
 * BACKLOG 2026-06-11-claude-942414 / P0 紧急止血：
 *   customer-flow / quote-conversion / claims-detail / repair 四域
 *   退化为 admin-only，本 helper 是闸。
 *
 * 三件套覆盖：
 *   - admin role → next() 通过
 *   - 非 admin role → next(err403) 拒绝
 *   - 无 user → next(err401) 拒绝
 */
import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { requireBranchAdmin } from '../shared.js';
import { AppError } from '../../../middleware/error.js';

function makeReq(user?: { role: string }): Request {
  return { user } as unknown as Request;
}
function makeRes(): Response {
  return {} as Response;
}

describe('requireBranchAdmin', () => {
  it('branch_admin → 通过', () => {
    const next: NextFunction = vi.fn();
    requireBranchAdmin(makeReq({ role: 'branch_admin' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([]);
  });

  it('org_user → 403', () => {
    const next: NextFunction = vi.fn();
    requireBranchAdmin(makeReq({ role: 'org_user' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('telemarketing_user → 403', () => {
    const next: NextFunction = vi.fn();
    requireBranchAdmin(makeReq({ role: 'telemarketing_user' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it('无 user → 401', () => {
    const next: NextFunction = vi.fn();
    requireBranchAdmin(makeReq(undefined), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
  });
});
