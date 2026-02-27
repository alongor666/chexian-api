/**
 * OpenRouter AI 服务
 * OpenRouter AI Service
 *
 * 用于趋势解读场景的多模型顺序降级调用。
 */

import { maskApiKey, safeLog } from '../utils/security.js';
import type { TrendAnalysisResult } from './zhipu.js';

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 8000;

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    code?: string;
  };
}

export interface OpenRouterTrendConfig {
  apiKey: string;
  models: string[];
  timeoutMs?: number;
}

export interface OpenRouterTrendResult extends TrendAnalysisResult {
  model?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function normalizeModels(models: string[]): string[] {
  return models
    .map((item) => item.trim())
    .filter(Boolean);
}

function getTrendMessages(
  rows: Array<{ date: string; auto_count: number; driver_count: number; rate: number }>,
  context: { org: string; coverage: string }
): OpenRouterMessage[] {
  const dataStr = rows
    .map((r) => `${r.date} 车险${r.auto_count}件 驾意${r.driver_count}件 推介率${r.rate}%`)
    .join('\n');

  const systemPrompt = `你是车险业务分析专家。请根据机构最近每日推介率数据，给出简洁的趋势分析（150字以内）。
分析要点：
1. 整体趋势方向（上升/下降/波动）
2. 近3天与前期对比
3. 异常日及可能原因
4. 一条具体行动建议
格式：纯文本，不用标题，不用序号，直接写分析结论。`;

  const userMsg = `机构：${context.org}，险种：${context.coverage}\n数据（日期 车险件数 驾意件数 推介率）：\n${dataStr}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMsg },
  ];
}

async function callOpenRouterModel(
  model: string,
  messages: OpenRouterMessage[],
  config: OpenRouterTrendConfig
): Promise<OpenRouterTrendResult> {
  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMsg = `OpenRouter API 错误: ${response.status}`;
      try {
        const errJson = JSON.parse(text) as OpenRouterResponse;
        if (errJson.error?.message) {
          errorMsg = errJson.error.message;
        }
      } catch {
        // ignore parse error
      }
      return { success: false, analysis: '', error: errorMsg, model };
    }

    const data = await response.json() as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { success: false, analysis: '', error: '模型返回内容为空', model };
    }

    return {
      success: true,
      analysis: content,
      model,
      usage: {
        prompt_tokens: Number(data.usage?.prompt_tokens ?? 0),
        completion_tokens: Number(data.usage?.completion_tokens ?? 0),
        total_tokens: Number(data.usage?.total_tokens ?? 0),
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '请求失败';
    return { success: false, analysis: '', error: msg, model };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 通过 OpenRouter 按模型顺序分析趋势（失败自动切下一个模型）
 */
export async function analyzeOrgTrendWithOpenRouter(
  rows: Array<{ date: string; auto_count: number; driver_count: number; rate: number }>,
  context: { org: string; coverage: string },
  config: OpenRouterTrendConfig
): Promise<OpenRouterTrendResult> {
  if (!config.apiKey) {
    return { success: false, analysis: '', error: '未配置 OpenRouter API Key' };
  }

  const models = normalizeModels(config.models);
  if (models.length === 0) {
    return { success: false, analysis: '', error: '未配置 OpenRouter 模型列表' };
  }

  safeLog('info', 'OpenRouter', 'Trend analysis start', {
    apiKey: maskApiKey(config.apiKey),
    modelCount: models.length,
  });

  const messages = getTrendMessages(rows, context);
  const errors: string[] = [];

  for (const model of models) {
    const result = await callOpenRouterModel(model, messages, config);
    if (result.success) {
      safeLog('info', 'OpenRouter', `Trend analysis success with model ${model}`, {
        usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
      return result;
    }
    errors.push(`${model}: ${result.error || 'unknown error'}`);
    safeLog('warn', 'OpenRouter', `Trend analysis failed with model ${model}`, {
      error: result.error || 'unknown error',
    });
  }

  return {
    success: false,
    analysis: '',
    error: `OpenRouter 全部模型失败: ${errors.join(' | ')}`,
  };
}
