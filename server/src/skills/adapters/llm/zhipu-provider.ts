/**
 * Zhipu Narrative Provider — 阶段 3
 *
 * 复用 services/zhipu.ts 的 generateJwtToken（已 export），但完全独立的 system prompt：
 * 不携带任何 SQL schema 提示，专门用于"经营巡检报告叙述"。
 *
 * 红线：任何输出经过 sql-guard。命中 → blockedBySqlGuard=true，text 替换为占位符。
 */

import { generateJwtToken } from '../../../services/zhipu.js';
import { safeLog, maskApiKey } from '../../../utils/security.js';
import type { LLMAdapter, LLMNarrativeRequest, LLMNarrativeResponse } from './types.js';
import { LLMUnavailableError } from './types.js';
import { inspectForSql, blockedFallbackText } from './sql-guard.js';

const ZHIPU_API_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4.7-flash'; // CLAUDE.md §3 指定

interface ZhipuChatResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; code: string };
}

export interface ZhipuNarrativeProviderOptions {
  apiKey: string;
  model?: string;
  /** 用于单测 mock fetch */
  fetchImpl?: typeof fetch;
  /** 调用超时（毫秒），默认 15000 */
  timeoutMs?: number;
}

export class ZhipuNarrativeProvider implements LLMAdapter {
  readonly provider = 'zhipu';
  readonly enabled: boolean;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ZhipuNarrativeProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.enabled = Boolean(opts.apiKey && opts.apiKey.split('.').length === 2);
  }

  async generateNarrative(req: LLMNarrativeRequest): Promise<LLMNarrativeResponse> {
    if (!this.enabled) {
      throw new LLMUnavailableError('zhipu', 'apiKey missing or malformed');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const token = generateJwtToken(this.apiKey);
      const response = await this.fetchImpl(`${ZHIPU_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.userContent },
          ],
          temperature: req.temperature ?? 0.3,
          max_tokens: req.maxTokens ?? 512,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        safeLog('error', 'ZhipuNarrative', `API error ${response.status}`, { apiKey: maskApiKey(this.apiKey) });
        throw new LLMUnavailableError('zhipu', `HTTP ${response.status}`);
      }

      const data = (await response.json()) as ZhipuChatResponse;
      if (data.error) {
        throw new LLMUnavailableError('zhipu', data.error.message);
      }

      const content = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!content) {
        throw new LLMUnavailableError('zhipu', 'empty content');
      }

      const guard = inspectForSql(content);
      if (guard.blocked) {
        safeLog('warn', 'ZhipuNarrative', 'blocked by sql-guard', { matched: guard.matchedKeyword });
        return {
          text: blockedFallbackText(guard.matchedKeyword ?? 'unknown'),
          model: this.model,
          tokens: data.usage
            ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens, total: data.usage.total_tokens }
            : undefined,
          blockedBySqlGuard: true,
        };
      }

      return {
        text: content,
        model: this.model,
        tokens: data.usage
          ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens, total: data.usage.total_tokens }
          : undefined,
        blockedBySqlGuard: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
