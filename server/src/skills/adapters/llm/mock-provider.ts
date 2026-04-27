/**
 * Mock LLM Provider — 测试与未配置 API Key 时的降级路径
 *
 * 输出固定模板，依赖 userContent 中的关键 metric 拼接，不调用任何外部服务。
 */

import type { LLMAdapter, LLMNarrativeRequest, LLMNarrativeResponse } from './types.js';
import { inspectForSql, blockedFallbackText } from './sql-guard.js';

export interface MockProviderOptions {
  /** 强制返回的文本（测试用），若不传则用模板生成 */
  fixedText?: string;
}

export class MockLLMProvider implements LLMAdapter {
  readonly provider = 'mock';
  readonly enabled = true;

  constructor(private readonly opts: MockProviderOptions = {}) {}

  async generateNarrative(req: LLMNarrativeRequest): Promise<LLMNarrativeResponse> {
    const text = this.opts.fixedText ?? this.buildTemplateNarrative(req);
    const guard = inspectForSql(text);
    if (guard.blocked) {
      return {
        text: blockedFallbackText(guard.matchedKeyword ?? 'unknown'),
        model: 'mock',
        blockedBySqlGuard: true,
      };
    }
    return {
      text,
      model: 'mock',
      blockedBySqlGuard: false,
    };
  }

  private buildTemplateNarrative(req: LLMNarrativeRequest): string {
    const head = req.userContent.slice(0, 80).replace(/\s+/g, ' ').trim();
    return `（mock 叙述）本期数据已通过模板报告呈现。摘要：${head}`;
  }
}
