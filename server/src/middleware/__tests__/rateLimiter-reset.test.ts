/**
 * 找回/重置独立限流桶单测（全员密码闭环 · 阶段二，2026-07-11）
 *
 * 锁定语义：
 *   1. resetPasswordLimiter：非本地 IP 第 6 次请求 → 429（5/min/IP 独立桶）
 *   2. resetInitLimiter：仅 intent=reset 计数；普通登录取配置（无 intent）不受限
 *   3. 三级基线（100/5/200）不在本文件动——只新增独立桶（security-config 红线）
 *
 * 测试层级：直接调用 express-rate-limit 中间件（mock req/res，避开 localhost 默认跳过）。
 */

import { describe, it, expect } from 'vitest';
import { resetPasswordLimiter, resetInitLimiter } from '../rateLimiter.js';

interface FakeRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, unknown>;
}

function makeRes(): FakeRes & Record<string, unknown> {
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k: string, v: unknown) { res.headers[k] = v; },
    getHeader(k: string) { return res.headers[k]; },
    removeHeader(k: string) { delete res.headers[k]; },
    append(k: string, v: unknown) { res.headers[k] = v; },
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; },
    send(b: unknown) { res.body = b; },
    end() {},
    on() {},
  };
  return res;
}

function makeReq(ip: string, query: Record<string, string> = {}) {
  return {
    ip,
    query,
    headers: {},
    connection: { remoteAddress: ip },
    app: { get: () => undefined },
  } as never;
}

/** 调一次限流中间件，返回是否放行（next 被调）与响应状态 */
async function invoke(limiter: (req: never, res: never, next: () => void) => void, req: never, res: FakeRes) {
  let passed = false;
  await new Promise<void>((resolve) => {
    // express-rate-limit 内部异步；next / handler 任一先到即结束
    const originalJson = (res as any).json.bind(res);
    (res as any).json = (b: unknown) => { originalJson(b); resolve(); };
    limiter(req, res as never, () => { passed = true; resolve(); });
  });
  return passed;
}

describe('resetPasswordLimiter（5/min/IP 独立桶）', () => {
  it('第 6 次请求 429，响应体为统一限流信封', async () => {
    const ip = '203.0.113.101';
    for (let i = 1; i <= 5; i++) {
      const res = makeRes();
      const passed = await invoke(resetPasswordLimiter as never, makeReq(ip), res);
      expect(passed, `第 ${i} 次应放行`).toBe(true);
    }
    const res6 = makeRes();
    const passed6 = await invoke(resetPasswordLimiter as never, makeReq(ip), res6);
    expect(passed6).toBe(false);
    expect(res6.statusCode).toBe(429);
    expect((res6.body as any).success).toBe(false);
    expect((res6.body as any).error.statusCode).toBe(429);
    expect((res6.body as any).error.message).toContain('重置尝试次数过多');
  });

  it('分桶按 IP：另一 IP 不受已限流 IP 影响', async () => {
    const res = makeRes();
    const passed = await invoke(resetPasswordLimiter as never, makeReq('203.0.113.102'), res);
    expect(passed).toBe(true);
  });
});

describe('resetInitLimiter（找回发起入口，仅 intent=reset 计数）', () => {
  it('intent=reset 第 6 次 429；普通登录取配置（无 intent）恒放行', async () => {
    const ip = '203.0.113.103';
    for (let i = 1; i <= 5; i++) {
      const res = makeRes();
      const passed = await invoke(resetInitLimiter as never, makeReq(ip, { intent: 'reset' }), res);
      expect(passed, `第 ${i} 次应放行`).toBe(true);
    }
    const res6 = makeRes();
    const passed6 = await invoke(resetInitLimiter as never, makeReq(ip, { intent: 'reset' }), res6);
    expect(passed6).toBe(false);
    expect(res6.statusCode).toBe(429);
    expect((res6.body as any).error.message).toContain('找回请求过于频繁');

    // 同 IP 的登录取配置（无 intent）不受影响：skip 分支放行
    const resLogin = makeRes();
    const passedLogin = await invoke(resetInitLimiter as never, makeReq(ip), resLogin);
    expect(passedLogin).toBe(true);
  });
});
