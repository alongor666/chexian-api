/**
 * AI 需求识别服务
 *
 * 接收用户自然语言输入，通过 LLM 匹配已有能力或生成澄清问题。
 * 复用现有 OpenRouter / Zhipu 降级策略。
 */

import { safeLog } from '../utils/security.js';
import { getCapabilitySummaryForAI, capabilities, type Capability } from '../config/capability-registry.js';

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const ZHIPU_API_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_TIMEOUT_MS = 10000;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DetectRequirementRequest {
  message: string;
  conversationHistory?: ChatMessage[];
}

export interface DetectRequirementResponse {
  type: 'match' | 'clarify' | 'no_match';
  capabilities?: Capability[];
  followUp?: string;
  options?: string[];
  suggestion?: string;
  source?: string;
}

/**
 * 构建意图识别的 System Prompt
 */
function buildSystemPrompt(): string {
  const capSummary = getCapabilitySummaryForAI();

  return `你是车险数据分析平台的智能助手。你的任务是理解用户需求，匹配到平台已有的分析能力。

## 平台已有能力
${capSummary}

## 你的任务
分析用户输入，返回 **严格 JSON**（不要包含 markdown 代码块标记）。

### 情况一：能匹配到已有能力
返回:
{"type":"match","capabilityIds":["dashboard","premium-report"],"reason":"简短说明匹配理由"}

### 情况二：意图模糊，需要追问
返回:
{"type":"clarify","followUp":"您想查看哪方面的数据？","options":["保费和业绩总览","各机构排名对比","续保和增长趋势"]}

### 情况三：完全不属于已有能力
返回:
{"type":"no_match","suggestion":"简要描述用户的需求，便于开发者理解"}

## 规则
1. 尽量匹配已有能力，能模糊匹配就不要判定为 no_match
2. 一次可以匹配多个相关能力（最多 3 个）
3. 追问时提供 2-4 个选项供用户选择
4. 回复纯 JSON，不要加任何额外文字`;
}

/**
 * 通过 OpenRouter 调用 LLM
 */
async function callOpenRouter(
  messages: ChatMessage[],
  apiKey: string,
  models: string[],
  timeoutMs: number
): Promise<{ success: boolean; content?: string; model?: string; error?: string }> {
  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 500 }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const data = (await response.json()) as Record<string, unknown>;
      const choices = data?.choices as Array<{ message?: { content?: string } }> | undefined;
      const content = choices?.[0]?.message?.content?.trim();
      if (content) return { success: true, content, model };
    } catch {
      clearTimeout(timeoutId);
    }
  }
  return { success: false, error: 'OpenRouter 全部模型失败' };
}

/**
 * 通过 Zhipu 调用 LLM（兜底）
 */
async function callZhipu(
  messages: ChatMessage[],
  apiKey: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ success: boolean; content?: string; error?: string }> {
  // 复用 zhipu.ts 的 JWT 生成逻辑
  const parts = apiKey.split('.');
  if (parts.length !== 2) return { success: false, error: 'Zhipu API Key 格式无效' };

  const [id, secret] = parts;
  const now = Date.now();
  const { createHmac } = await import('crypto');

  function b64url(data: string | Buffer): string {
    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const header = b64url(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' }));
  const payload = b64url(JSON.stringify({ api_key: id, exp: now + 3600000, timestamp: now }));
  const signature = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  const token = `${header}.${payload}.${signature}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ZHIPU_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: 'glm-4.7-flash', messages, temperature: 0.3, max_tokens: 500 }),
      signal: controller.signal,
    });

    if (!response.ok) return { success: false, error: `Zhipu API 错误: ${response.status}` };

    const data = (await response.json()) as Record<string, unknown>;
    const zhipuChoices = data?.choices as Array<{ message?: { content?: string } }> | undefined;
    const content = zhipuChoices?.[0]?.message?.content?.trim();
    if (content) return { success: true, content };
    return { success: false, error: '模型返回内容为空' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '请求失败' };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseLLMResponse(raw: string): DetectRequirementResponse {
  // 尝试提取 JSON（可能被 markdown 代码块包裹）
  let jsonStr = raw;
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);

    if (parsed.type === 'match' && Array.isArray(parsed.capabilityIds)) {
      const matched = parsed.capabilityIds
        .map((id: string) => capabilities.find((c) => c.id === id))
        .filter(Boolean) as Capability[];

      if (matched.length > 0) {
        return { type: 'match', capabilities: matched };
      }
      // IDs 无效则 fallback 为 no_match
      return { type: 'no_match', suggestion: parsed.reason || '未能匹配到已有功能' };
    }

    if (parsed.type === 'clarify') {
      return {
        type: 'clarify',
        followUp: parsed.followUp || '请问您想查看哪方面的数据？',
        options: Array.isArray(parsed.options) ? parsed.options.slice(0, 4) : undefined,
      };
    }

    if (parsed.type === 'no_match') {
      return {
        type: 'no_match',
        suggestion: parsed.suggestion || '该功能暂未上线',
      };
    }

    return { type: 'no_match', suggestion: '未能理解您的需求，请换个说法试试' };
  } catch {
    safeLog('warn', 'RequirementDetector', 'Failed to parse LLM response', { raw: raw.substring(0, 200) });
    return { type: 'no_match', suggestion: '服务异常，请稍后重试' };
  }
}

/**
 * 检测用户需求，匹配已有能力
 */
export async function detectRequirement(
  request: DetectRequirementRequest
): Promise<DetectRequirementResponse> {
  const systemPrompt = buildSystemPrompt();
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  // 追加对话历史
  if (request.conversationHistory) {
    for (const msg of request.conversationHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push(msg);
      }
    }
  }

  messages.push({ role: 'user', content: request.message });

  const timeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  // 1. 尝试 OpenRouter
  const openRouterApiKey = process.env.OPENROUTER_API_KEY || '';
  const openRouterModels = (process.env.AI_PRIMARY_MODEL || process.env.OPENROUTER_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (openRouterApiKey && openRouterModels.length > 0) {
    const result = await callOpenRouter(messages, openRouterApiKey, openRouterModels, timeoutMs);
    if (result.success && result.content) {
      const response = parseLLMResponse(result.content);
      response.source = `openrouter:${result.model}`;
      return response;
    }
  }

  // 2. 兜底 Zhipu
  const zhipuApiKey = process.env.ZHIPU_API_KEY || process.env.VITE_ZHIPU_API_KEY || '';
  if (zhipuApiKey) {
    const result = await callZhipu(messages, zhipuApiKey, timeoutMs);
    if (result.success && result.content) {
      const response = parseLLMResponse(result.content);
      response.source = 'zhipu';
      return response;
    }
  }

  return {
    type: 'no_match',
    suggestion: '当前 AI 服务不可用，请使用左侧菜单直接访问功能',
    source: 'fallback',
  };
}
