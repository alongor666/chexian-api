/**
 * 审计路径契约测试（AUDITED_PATHS）
 *
 * 锁定「agent 大模型/诊断入口必须落审计日志」这条契约，防止后人误删前缀导致：
 * 就绪门禁（readyForLlm）的前置条件「生产审计日志能看到 agent 调用记录」与实际审计覆盖脱节。
 *
 * 2026-06-10 harness 对标实测发现：唯一的大模型入口 /api/agent/explain 原先不在 AUDITED_PATHS 中，
 * 该入口的大模型调用不会写审计日志——门禁条件与审计覆盖自相矛盾。本测试固化修复。
 */

import { describe, it, expect } from 'vitest';
import { AUDITED_PATHS } from '../../server/src/middleware/audit';

// 复刻 auditMiddleware 内部的命中逻辑（AUDITED_PATHS.some(p => url.startsWith(p))）
const isAudited = (url: string): boolean => AUDITED_PATHS.some((p) => url.startsWith(p));

describe('审计路径契约（AUDITED_PATHS）', () => {
  it('覆盖所有 agent 大模型/诊断入口前缀', () => {
    expect(AUDITED_PATHS).toContain('/api/agent/diagnosis');
    expect(AUDITED_PATHS).toContain('/api/agent/forecast');
    // explain 是大模型解释层唯一入口，必须审计（就绪门禁前置）
    expect(AUDITED_PATHS).toContain('/api/agent/explain');
  });

  it('explain 的真实子路径会被审计中间件命中', () => {
    expect(isAudited('/api/agent/explain/diagnosis')).toBe(true);
  });

  it('既有诊断/预测子路径仍被命中（无回归）', () => {
    expect(isAudited('/api/agent/diagnosis/cost-indicators')).toBe(true);
    expect(isAudited('/api/agent/forecast/profit-scenario')).toBe(true);
    expect(isAudited('/api/query/kpi')).toBe(true);
  });

  it('非审计路径不被命中（防止过度审计回归）', () => {
    expect(isAudited('/api/auth/login')).toBe(false);
    expect(isAudited('/health')).toBe(false);
  });
});
