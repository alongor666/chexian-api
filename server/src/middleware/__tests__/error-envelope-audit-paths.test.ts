/**
 * 错误信封统一 + 审计路径覆盖 防回归测试
 *
 * 背景（BACKLOG 2026-07-03-claude-77f992 / 2026-07-03-claude-fe282e）：
 * - 限流器 429 响应体的 error 曾是裸字符串，偏离全局 errorHandler 的统一信封
 *   { success:false, error:{ message, statusCode } }，前端 client-core 按
 *   data.error?.message 解析得 undefined，用户只见兜底文案"请求失败"。
 * - copilot/workflows/skills/discover 四路由前缀曾不在 AUDITED_PATHS，
 *   触发工作流/执行技能等敏感操作不落审计日志。
 */
import { describe, it, expect } from 'vitest';
import { rateLimitBody } from '../rateLimiter.js';
import { AUDITED_PATHS } from '../audit.js';

describe('rateLimitBody 统一信封', () => {
  it('error 是 { message, statusCode:429 } 对象而非裸字符串', () => {
    const body = rateLimitBody('请求过于频繁，请 1 分钟后再试');
    expect(body.success).toBe(false);
    expect(body.error).toEqual({ message: '请求过于频繁，请 1 分钟后再试', statusCode: 429 });
    // 前端 client-core 的解析路径：data.error?.message 必须拿到真实文案
    expect(body.error.message).toBe('请求过于频繁，请 1 分钟后再试');
  });

  it('retryAfter 保留在顶层（与 Retry-After 响应头语义一致，默认 60 秒）', () => {
    expect(rateLimitBody('x').retryAfter).toBe(60);
    expect(rateLimitBody('x', 120).retryAfter).toBe(120);
  });
});

describe('AUDITED_PATHS 敏感路由覆盖', () => {
  it.each(['/api/copilot', '/api/workflows', '/api/skills', '/api/discover'])(
    '%s 在审计清单中（敏感操作必须落审计日志）',
    (prefix) => {
      expect(AUDITED_PATHS).toContain(prefix);
    },
  );

  it('原有审计前缀不回退', () => {
    for (const p of ['/api/query', '/api/data', '/api/agent/diagnosis', '/api/agent/forecast', '/api/agent/explain']) {
      expect(AUDITED_PATHS).toContain(p);
    }
  });
});
