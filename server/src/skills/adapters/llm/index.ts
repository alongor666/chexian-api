/**
 * LLM Adapter 入口 — 阶段 3
 *
 * 默认 provider 选择策略：
 * 1. 测试环境（NODE_ENV=test）→ MockLLMProvider
 * 2. 显式 LLM_NARRATIVE_PROVIDER=mock → MockLLMProvider
 * 3. ZHIPU_API_KEY 已配置且格式合法 → ZhipuNarrativeProvider
 * 4. 其他 → MockLLMProvider（降级）
 *
 * 调用方法（路由层）：
 *   const provider = getDefaultLlmProvider();
 *   const { text } = await provider.generateNarrative({ systemPrompt, userContent });
 */

import { aiEnv } from '../../../config/env.js';
import { MockLLMProvider } from './mock-provider.js';
import { ZhipuNarrativeProvider } from './zhipu-provider.js';
import type { LLMAdapter } from './types.js';

let cached: LLMAdapter | null = null;

/** 强制清空缓存（测试用） */
export function resetLlmProviderCache(): void {
  cached = null;
}

export function getDefaultLlmProvider(): LLMAdapter {
  if (cached) return cached;

  const explicit = process.env.LLM_NARRATIVE_PROVIDER;
  if (explicit === 'mock' || process.env.NODE_ENV === 'test') {
    cached = new MockLLMProvider();
    return cached;
  }

  const apiKey = aiEnv.ZHIPU_API_KEY;
  if (apiKey && apiKey.split('.').length === 2) {
    cached = new ZhipuNarrativeProvider({ apiKey });
    return cached;
  }

  cached = new MockLLMProvider();
  return cached;
}

export { MockLLMProvider, ZhipuNarrativeProvider };
export * from './types.js';
export { inspectForSql, blockedFallbackText } from './sql-guard.js';

/** 报告叙述固定 system prompt（CLAUDE.md §10 红线：禁止 SQL） */
export const NARRATIVE_SYSTEM_PROMPT = `你是车险经营报告解读助手，任务是基于已有的确定性数据生成简短中文叙述。

【硬性约束 — 违反任何一条都视为严重错误】
1. 禁止输出任何 SQL 代码、SELECT/WITH 等关键字、表名（PolicyFact 等）或字段名
2. 禁止编造数字。所有数字必须来自用户输入的「数据摘要」原文
3. 禁止做"利润/盈亏/承保利润"判断，本系统不计算这些指标
4. 禁止输出"建议直接修改/删除/调整"的强动作，只能输出"建议关注/复核/进一步分析"
5. 输出长度 ≤ 300 字，纯中文段落，不要 markdown 标题

【你的任务】
读取用户提供的数据摘要（已经过确定性聚合），生成 1-2 段中文叙述：
- 第 1 段：用 1-2 句话点出本期经营整体面（赔付率、风险分布）
- 第 2 段（可选）：指出 1-2 个值得关注的高风险分组或趋势

直接输出叙述文本，不要前缀如"以下是叙述："，不要 markdown 标题。`;
