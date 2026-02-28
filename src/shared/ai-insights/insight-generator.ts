/**
 * AI 洞察生成器
 *
 * 调用智谱 GLM API 生成数据洞察
 * 复用现有的 JWT 认证和 API 调用逻辑
 */

import type { Insight, InsightAnalysisResult, RenewalDataContext, InsightConfig } from './types';
import { getPromptByType } from './prompts';
import { formatContextForAI } from './context-builder';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('InsightGenerator');

// ---- 内联 API Key 配置读取（原依赖已删除的 sql-query/aiSql/configStore）----
const STORAGE_KEY = 'zhipu_sql_config';

interface StoredConfig {
  apiKey: string;
  model: string;
}

/**
 * 读取存储的 AI API Key 配置
 * 优先级：localStorage > 环境变量 > 空
 */
function getStoredConfig(): StoredConfig {
  const envKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ZHIPU_API_KEY) || '';
  const envModel = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ZHIPU_MODEL) || 'glm-4-flash';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // configStore 使用 XOR+Base64 混淆，但 key 仍可直接使用
      return {
        apiKey: parsed.apiKey || envKey,
        model: parsed.model || envModel,
      };
    }
  } catch { /* ignore */ }
  return { apiKey: envKey, model: envModel };
}

/**
 * API 端点说明：
 * - 标准 API 端点 (paas/v4): 支持 CORS，免费模型可直接使用
 * - Coding 套餐端点 (coding/paas/v4): 需要订阅 Coding 套餐
 *
 * 本项目使用标准 API 端点 + 免费模型（glm-4.7-flash）
 */
const ZHIPU_API_BASE = 'https://open.bigmodel.cn/api/paas/v4';

// AI 洞察默认使用最新免费模型 GLM-4.7-Flash（2026年1月发布，替代 GLM-4.5-Flash）
const INSIGHT_DEFAULT_MODEL = 'glm-4.7-flash';

/**
 * 检查 crypto.subtle 是否可用
 * 在非安全上下文（HTTP + 非 localhost）下不可用
 */
function isCryptoSubtleAvailable(): boolean {
  return typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.subtle.importKey === 'function';
}

/**
 * Base64URL 编码（JWT 标准格式）
 */
function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 使用 Web Crypto API 生成 HMAC-SHA256 签名
 */
async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const signatureArray = new Uint8Array(signature);

  let binary = '';
  signatureArray.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return base64UrlEncode(binary);
}

/**
 * 获取 API 认证 Token
 * - 安全上下文（HTTPS/localhost）：使用 JWT 签名
 * - 非安全上下文（HTTP 局域网）：直接使用 API Key
 */
async function getAuthToken(apiKey: string): Promise<string> {
  // 非安全上下文，直接使用 API Key
  if (!isCryptoSubtleAvailable()) {
    logger.warn('crypto.subtle 不可用，使用 API Key 直接认证');
    return apiKey;
  }

  // 安全上下文，生成 JWT
  return generateJwtToken(apiKey);
}

/**
 * 生成智谱 API 的 JWT Token
 */
async function generateJwtToken(apiKey: string, expSeconds: number = 3600): Promise<string> {
  const parts = apiKey.split('.');
  if (parts.length !== 2) {
    throw new Error('无效的 API Key 格式，应为 {id}.{secret}');
  }

  const [id, secret] = parts;
  const now = Date.now();

  const header = {
    alg: 'HS256',
    sign_type: 'SIGN',
  };

  const payload = {
    api_key: id,
    exp: now + expSeconds * 1000,
    timestamp: now,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));

  const signatureInput = `${headerB64}.${payloadB64}`;
  const signature = await hmacSha256(secret, signatureInput);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * 解析 AI 响应中的洞察 JSON
 */
function parseInsights(content: string): Insight[] {
  try {
    // 尝试提取 JSON 数组
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn('[InsightGenerator] 未找到 JSON 数组');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      logger.warn('[InsightGenerator] 解析结果不是数组');
      return [];
    }

    // 验证并标准化每条洞察
    return parsed.map((item, index) => ({
      id: `insight-${Date.now()}-${index}`,
      type: validateInsightType(item.type) || 'action',
      title: String(item.title || '未知洞察'),
      description: String(item.description || ''),
      priority: validatePriority(item.priority) || 'medium',
      metric: item.metric
        ? {
          name: String(item.metric.name || ''),
          value: item.metric.value ?? '',
          benchmark: item.metric.benchmark,
          delta: item.metric.delta,
        }
        : undefined,
      affectedEntities: Array.isArray(item.affectedEntities)
        ? item.affectedEntities.map(String)
        : undefined,
    }));
  } catch (error) {
    logger.error('[InsightGenerator] JSON 解析失败:', error);
    return [];
  }
}

/**
 * 验证洞察类型
 */
function validateInsightType(type: unknown): 'warning' | 'opportunity' | 'highlight' | 'trend' | 'action' | null {
  const validTypes = ['warning', 'opportunity', 'highlight', 'trend', 'action'];
  return validTypes.includes(type as string) ? (type as 'warning' | 'opportunity' | 'highlight' | 'trend' | 'action') : null;
}

/**
 * 验证优先级
 */
function validatePriority(priority: unknown): 'high' | 'medium' | 'low' | null {
  const validPriorities = ['high', 'medium', 'low'];
  return validPriorities.includes(priority as string) ? (priority as 'high' | 'medium' | 'low') : null;
}

/**
 * 生成洞察
 *
 * @param context - 数据上下文
 * @param config - 可选配置
 * @param signal - 可选的 AbortSignal 用于取消请求
 * @returns 洞察分析结果
 */
export async function generateInsights(
  context: RenewalDataContext,
  config?: InsightConfig,
  signal?: AbortSignal
): Promise<InsightAnalysisResult> {
  const startTime = Date.now();

  // 获取 API 配置
  const storedConfig = getStoredConfig();

  logger.debug('配置信息', {
    model: INSIGHT_DEFAULT_MODEL,
    hasApiKey: !!storedConfig.apiKey,
    note: '使用标准 API + 免费模型',
  });

  if (!storedConfig.apiKey) {
    return {
      success: false,
      insights: [],
      error: '请先配置智谱 API Key（在 SQL 查询页面的 AI 设置中配置）',
    };
  }

  // 构建消息
  const systemPrompt = getPromptByType(context.type);
  const userContent = formatContextForAI(context);

  logger.debug('请求内容', {
    systemPromptLength: systemPrompt.length,
    userContentLength: userContent.length,
    top20Count: context.top20Salesmen.length,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  try {
    // 获取认证 Token（安全上下文用 JWT，非安全上下文用 API Key）
    const token = await getAuthToken(storedConfig.apiKey);

    // AI 洞察使用最新免费模型 GLM-4.7-Flash
    const insightModel = INSIGHT_DEFAULT_MODEL;

    const requestBody = {
      model: insightModel,
      messages,
      temperature: 0.3,
      max_tokens: 4096, // GLM-4.7-Flash 输出限制
    };

    logger.debug('发送请求', { url: `${ZHIPU_API_BASE}/chat/completions`, model: insightModel });

    // 调用 API
    const response = await fetch(`${ZHIPU_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    logger.debug('响应状态', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('API 错误响应', { status: response.status, body: errorText });

      try {
        const errorJson = JSON.parse(errorText);
        return {
          success: false,
          insights: [],
          error: errorJson.error?.message || `API 错误: ${response.status}`,
        };
      } catch {
        return {
          success: false,
          insights: [],
          error: `API 错误: ${response.status}`,
        };
      }
    }

    const data = await response.json();
    logger.debug('API 响应数据', {
      hasChoices: !!data.choices,
      choicesLength: data.choices?.length,
      firstChoice: data.choices?.[0],
      usage: data.usage,
      // 打印完整响应以便调试
      fullResponse: JSON.stringify(data).slice(0, 500),
    });

    if (data.error) {
      logger.error('API 返回错误', data.error);
      return {
        success: false,
        insights: [],
        error: data.error.message,
      };
    }

    const message = data.choices?.[0]?.message;
    // 智谱某些模型会返回 reasoning_content（推理内容）和 content（最终输出）
    // 如果 content 为空但有 reasoning_content，尝试从 reasoning_content 提取 JSON
    let content = message?.content;
    const reasoningContent = message?.reasoning_content;
    const finishReason = data.choices?.[0]?.finish_reason;

    logger.debug('提取内容', {
      hasContent: !!content,
      contentLength: content?.length,
      hasReasoningContent: !!reasoningContent,
      reasoningContentLength: reasoningContent?.length,
      finishReason,
      contentPreview: content?.slice(0, 200),
    });

    // 如果被截断且 content 为空，尝试从 reasoning_content 提取
    if (!content && reasoningContent) {
      logger.warn('content 为空，尝试从 reasoning_content 提取 JSON');
      // 尝试从推理内容中提取 JSON 数组
      const jsonMatch = reasoningContent.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        content = jsonMatch[0];
        logger.debug('从 reasoning_content 提取到 JSON', { length: content.length });
      }
    }

    if (!content) {
      // 检查是否因为 token 限制被截断
      if (finishReason === 'length') {
        logger.error('输出被截断（token 限制）', {
          finishReason,
          hasReasoningContent: !!reasoningContent,
        });
        return {
          success: false,
          insights: [],
          error: '模型输出被截断，推理过程过长。请稍后重试。',
        };
      }

      logger.error('模型返回内容为空', {
        choices: data.choices,
        message: message,
      });
      return {
        success: false,
        insights: [],
        error: '模型返回内容为空',
      };
    }

    // 解析洞察
    const insights = parseInsights(content);

    // 按优先级排序
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // 限制数量
    const maxInsights = config?.maxInsights ?? 5;
    const limitedInsights = insights.slice(0, maxInsights);

    return {
      success: true,
      insights: limitedInsights,
      tokens: data.usage
        ? {
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
          total: data.usage.total_tokens,
        }
        : undefined,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        insights: [],
        error: '请求已取消',
      };
    }

    logger.error('[InsightGenerator] Request Error:', error);
    return {
      success: false,
      insights: [],
      error: error instanceof Error ? error.message : '请求失败',
    };
  }
}

/**
 * 检查是否已配置 API Key
 */
export function isInsightConfigured(): boolean {
  const config = getStoredConfig();
  return !!config.apiKey;
}
