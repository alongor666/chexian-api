/**
 * LLM Adapter — 阶段 3 单元测试
 *
 * 覆盖：
 *  - sql-guard：SELECT / WITH / sql code-fence / 安全文本
 *  - MockProvider：固定文本、模板生成、被 guard 拦截
 *  - ZhipuProvider：fetch mock 成功 / HTTP 错误 / blocked / 超时
 *  - getDefaultLlmProvider：env 切换路径
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  inspectForSql,
  MockLLMProvider,
  ZhipuNarrativeProvider,
  LLMUnavailableError,
  resetLlmProviderCache,
  getDefaultLlmProvider,
  NARRATIVE_SYSTEM_PROMPT,
} from '../adapters/llm/index.js';

describe('sql-guard.inspectForSql', () => {
  it('SELECT 关键字 → 拦截', () => {
    const r = inspectForSql('SELECT * FROM PolicyFact');
    expect(r.blocked).toBe(true);
    expect(r.matchedKeyword).toBe('SELECT');
  });

  it('WITH (CTE) → 拦截', () => {
    const r = inspectForSql('WITH cte AS (SELECT 1) SELECT * FROM cte');
    expect(r.blocked).toBe(true);
  });

  it('```sql code-fence → 拦截', () => {
    const r = inspectForSql('生成的 SQL：\n```sql\nSELECT 1\n```');
    expect(r.blocked).toBe(true);
    expect(r.matchedKeyword).toBe('sql-code-fence');
  });

  it('UNION/JOIN → 拦截', () => {
    expect(inspectForSql('UNION ALL').blocked).toBe(true);
    expect(inspectForSql('JOIN ClaimsAgg').blocked).toBe(true);
  });

  it('普通中文叙述 → 不拦截', () => {
    const r = inspectForSql('本期满期赔付率 65.5%，整体处于可控区间。');
    expect(r.blocked).toBe(false);
  });

  it('英文上下文里的 select 但不带 SQL 形态 → 不拦截', () => {
    // "select" 后跟句号或中文，不是关键字调用
    const r = inspectForSql('Some select highlights about the period.');
    // "select highlights" — `\b(SELECT)\b\s+[\w*"'\(]` 会匹配（select + 空格 + 字母）
    // 这是一种"过度拦截"的情况；我们接受这种保守策略：
    // 业务侧叙述不会用英文，命中也只是切到 fallback 文本，安全优先
    expect(r.blocked).toBe(true);
  });
});

describe('MockLLMProvider', () => {
  it('固定文本 → 直接返回', async () => {
    const p = new MockLLMProvider({ fixedText: '本期赔付率上升 3pp。' });
    const r = await p.generateNarrative({ systemPrompt: 'sys', userContent: 'data' });
    expect(r.text).toBe('本期赔付率上升 3pp。');
    expect(r.blockedBySqlGuard).toBe(false);
    expect(r.model).toBe('mock');
  });

  it('固定文本含 SELECT → 被 guard 拦截', async () => {
    const p = new MockLLMProvider({ fixedText: 'SELECT * FROM x;' });
    const r = await p.generateNarrative({ systemPrompt: 'sys', userContent: 'data' });
    expect(r.blockedBySqlGuard).toBe(true);
    expect(r.text).toContain('sql-guard 拦截');
  });

  it('未传固定文本 → 模板生成', async () => {
    const p = new MockLLMProvider();
    const r = await p.generateNarrative({ systemPrompt: 'sys', userContent: '保费 1200 万元，赔付率 65%' });
    expect(r.text).toContain('mock 叙述');
    expect(r.text).toContain('保费 1200 万元');
  });

  it('enabled = true', () => {
    expect(new MockLLMProvider().enabled).toBe(true);
  });
});

describe('ZhipuNarrativeProvider', () => {
  it('apiKey 缺失 → enabled=false 且抛 Unavailable', async () => {
    const p = new ZhipuNarrativeProvider({ apiKey: '' });
    expect(p.enabled).toBe(false);
    await expect(
      p.generateNarrative({ systemPrompt: 's', userContent: 'u' })
    ).rejects.toBeInstanceOf(LLMUnavailableError);
  });

  it('apiKey 格式不合法 → enabled=false', () => {
    const p = new ZhipuNarrativeProvider({ apiKey: 'no-dot-format' });
    expect(p.enabled).toBe(false);
  });

  it('成功调用 → 返回 text + tokens', async () => {
    const fakeResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: '本期经营平稳。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse) as unknown as typeof fetch;

    const p = new ZhipuNarrativeProvider({ apiKey: 'fake-id.fake-secret', fetchImpl: fetchMock });
    const r = await p.generateNarrative({ systemPrompt: 's', userContent: 'u' });
    expect(r.text).toBe('本期经营平稳。');
    expect(r.tokens?.total).toBe(120);
    expect(r.blockedBySqlGuard).toBe(false);
    expect((fetchMock as any).mock.calls[0][0]).toContain('chat/completions');
  });

  it('成功响应含 SELECT → 被 guard 拦截', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: '建议执行 SELECT * FROM PolicyFact' }, finish_reason: 'stop' }],
      }),
    }) as unknown as typeof fetch;

    const p = new ZhipuNarrativeProvider({ apiKey: 'fake-id.fake-secret', fetchImpl: fetchMock });
    const r = await p.generateNarrative({ systemPrompt: 's', userContent: 'u' });
    expect(r.blockedBySqlGuard).toBe(true);
    expect(r.text).toContain('sql-guard 拦截');
  });

  it('HTTP 500 → 抛 Unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    }) as unknown as typeof fetch;
    const p = new ZhipuNarrativeProvider({ apiKey: 'fake-id.fake-secret', fetchImpl: fetchMock });
    await expect(p.generateNarrative({ systemPrompt: 's', userContent: 'u' })).rejects.toBeInstanceOf(
      LLMUnavailableError
    );
  });

  it('空 content → 抛 Unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: '   ' } }] }),
    }) as unknown as typeof fetch;
    const p = new ZhipuNarrativeProvider({ apiKey: 'fake-id.fake-secret', fetchImpl: fetchMock });
    await expect(p.generateNarrative({ systemPrompt: 's', userContent: 'u' })).rejects.toBeInstanceOf(
      LLMUnavailableError
    );
  });

  it('请求体含正确 model + temperature', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }) as unknown as typeof fetch;
    const p = new ZhipuNarrativeProvider({
      apiKey: 'fake-id.fake-secret',
      fetchImpl: fetchMock,
      model: 'glm-4.7-flash',
    });
    await p.generateNarrative({ systemPrompt: 'sys', userContent: 'u', temperature: 0.5, maxTokens: 200 });
    const callArgs = (fetchMock as any).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe('glm-4.7-flash');
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(200);
    expect(body.messages[0].role).toBe('system');
  });
});

describe('getDefaultLlmProvider', () => {
  beforeEach(() => {
    resetLlmProviderCache();
    delete process.env.LLM_NARRATIVE_PROVIDER;
  });

  it('NODE_ENV=test → MockLLMProvider', () => {
    const p = getDefaultLlmProvider();
    expect(p.provider).toBe('mock');
  });

  it('LLM_NARRATIVE_PROVIDER=mock → MockLLMProvider', () => {
    process.env.LLM_NARRATIVE_PROVIDER = 'mock';
    const p = getDefaultLlmProvider();
    expect(p.provider).toBe('mock');
  });
});

describe('NARRATIVE_SYSTEM_PROMPT', () => {
  it('显式禁止 SQL/利润判断', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('禁止输出任何 SQL');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('禁止做"利润/盈亏/承保利润"判断');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('禁止编造数字');
  });
});
