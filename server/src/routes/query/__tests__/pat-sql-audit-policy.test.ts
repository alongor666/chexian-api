/**
 * enforcePatSqlPolicy — 单元测试
 *
 * 安全审查 M5（backlog uid=2026-07-12-claude-4b93ea）：GET /api/query/sql 对 PAT 的
 * 暴露面收窄。readonlyMiddleware 只挡非 GET，PAT 仍可自由调用该 SQL 直通端点（仍受
 * RLS 约束）。本函数用 PAT_SQL_POLICY 三态（allow/audit/deny）收口：
 *   - 非 PAT（会话 JWT）调用：零行为变更，任何策略下都不受影响（回归用例）
 *   - PAT + 'allow'：放行，不打重点审计
 *   - PAT + 'audit'（默认档，兼容 cx sql CLI / MCP 现状）：放行 + 打一条重点审计 console.warn
 *   - PAT + 'deny'：403 拒绝（仅当运维显式收紧时使用，会破坏 cx sql CLI）
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request } from 'express';
import { AppError } from '../../../middleware/error.js';
import { enforcePatSqlPolicy } from '../sql-passthrough.js';

function makeReq(opts: {
  pat?: { tokenId: string; name: string };
  user?: { username: string; role: string };
}): Request {
  return { pat: opts.pat, user: opts.user } as unknown as Request;
}

const ctx = { sql: "SELECT COUNT(*) FROM PolicyFact WHERE 1=1", referencedDomains: ['NewEnergyClaims'] };

describe('enforcePatSqlPolicy（PAT_SQL_POLICY 三态收口）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('非 PAT（会话 JWT）调用：任意策略下都不受影响，不抛错不打审计（回归用例）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = makeReq({ user: { username: 'org_user_a', role: 'org_user' } });

    for (const policy of ['allow', 'audit', 'deny'] as const) {
      expect(() => enforcePatSqlPolicy(req, ctx, policy)).not.toThrow();
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("PAT + 'allow'：放行，不打重点审计", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = makeReq({
      pat: { tokenId: 'ABCD1234', name: 'ci-pat' },
      user: { username: 'svc-account', role: 'org_user' },
    });
    expect(() => enforcePatSqlPolicy(req, ctx, 'allow')).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("PAT + 'audit'（默认档）：放行 + 打一条重点审计，含 tokenId/sql 摘要/命中派生域", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = makeReq({
      pat: { tokenId: 'ABCD1234', name: 'ci-pat' },
      user: { username: 'svc-account', role: 'org_user' },
    });
    expect(() => enforcePatSqlPolicy(req, ctx, 'audit')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const [line] = warnSpy.mock.calls[0];
    const parsed = JSON.parse(line as string);
    expect(parsed.tag).toBe('pat-sql-audit');
    expect(parsed.tokenId).toBe('ABCD1234');
    expect(parsed.tokenName).toBe('ci-pat');
    expect(parsed.username).toBe('svc-account');
    expect(parsed.sqlLength).toBe(ctx.sql.length);
    expect(parsed.sqlPreview).toContain('PolicyFact');
    expect(parsed.referencedDomains).toEqual(['NewEnergyClaims']);
  });

  it("PAT + 'deny'：403 拒绝，携带可读错误信息", () => {
    const req = makeReq({
      pat: { tokenId: 'ABCD1234', name: 'ci-pat' },
      user: { username: 'svc-account', role: 'org_user' },
    });
    try {
      enforcePatSqlPolicy(req, ctx, 'deny');
      expect.unreachable('应抛出 AppError(403)');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).message).toContain('PAT_SQL_POLICY');
    }
  });

  it('policy 参数缺省时读取 authEnv.PAT_SQL_POLICY（默认档 audit，不抛错）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = makeReq({
      pat: { tokenId: 'ABCD1234', name: 'ci-pat' },
      user: { username: 'svc-account', role: 'org_user' },
    });
    expect(() => enforcePatSqlPolicy(req, ctx)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
