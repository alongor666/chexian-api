/**
 * 智谱 API 客户端
 *
 * 调用智谱 GLM 模型生成 SQL
 * 使用 JWT Token 认证
 */

import type { ZhipuConfig, ZhipuResponse, ChatMessage, AISqlResult } from './types';
import { DEFAULT_MODEL } from './types';
import { SYSTEM_PROMPT, extractSqlFromResponse } from './systemPrompt';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('ZhipuClient');

// 标准 API 端点（支持 CORS，免费模型可用）
// 注意：Coding 套餐端点 (/api/coding/paas/v4) 需要订阅，标准端点免费模型可直接使用
const ZHIPU_API_BASE = 'https://open.bigmodel.cn/api/paas/v4';

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

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const signatureArray = new Uint8Array(signature);

  // 转换为 base64url
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
    logger.warn('[ZhipuClient] crypto.subtle 不可用，使用 API Key 直接认证');
    return apiKey;
  }

  // 安全上下文，生成 JWT
  return generateJwtToken(apiKey);
}

/**
 * 生成智谱 API 的 JWT Token
 *
 * API Key 格式: {id}.{secret}
 * JWT Header: {"alg": "HS256", "sign_type": "SIGN"}
 * JWT Payload: {api_key, exp, timestamp} (毫秒时间戳)
 */
async function generateJwtToken(apiKey: string, expSeconds: number = 3600): Promise<string> {
  const parts = apiKey.split('.');
  if (parts.length !== 2) {
    throw new Error('无效的 API Key 格式，应为 {id}.{secret}');
  }

  const [id, secret] = parts;
  const now = Date.now();

  // JWT Header
  const header = {
    alg: 'HS256',
    sign_type: 'SIGN',
  };

  // JWT Payload (时间戳单位：毫秒)
  const payload = {
    api_key: id,
    exp: now + expSeconds * 1000,
    timestamp: now,
  };

  // 编码 header 和 payload
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));

  // 生成签名
  const signatureInput = `${headerB64}.${payloadB64}`;
  const signature = await hmacSha256(secret, signatureInput);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * 调用智谱 API 生成 SQL
 */
export async function generateSqlWithZhipu(
  query: string,
  config: ZhipuConfig
): Promise<AISqlResult> {
  const { apiKey, model = DEFAULT_MODEL } = config;

  if (!apiKey) {
    return {
      success: false,
      sql: '',
      error: '请先配置智谱 API Key',
    };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: query },
  ];

  try {
    // 获取认证 Token（安全上下文用 JWT，非安全上下文用 API Key）
    const token = await getAuthToken(apiKey);

    const response = await fetch(`${ZHIPU_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1, // 低温度，确保输出稳定
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[ZhipuClient] API Error:', response.status, errorText);

      // 解析错误信息
      try {
        const errorJson = JSON.parse(errorText);
        return {
          success: false,
          sql: '',
          error: errorJson.error?.message || `API 错误: ${response.status}`,
        };
      } catch {
        return {
          success: false,
          sql: '',
          error: `API 错误: ${response.status} - ${errorText}`,
        };
      }
    }

    const data: ZhipuResponse = await response.json();

    if (data.error) {
      return {
        success: false,
        sql: '',
        error: data.error.message,
      };
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return {
        success: false,
        sql: '',
        error: '模型返回内容为空',
      };
    }

    // 提取 SQL
    const sql = extractSqlFromResponse(content);

    return {
      success: true,
      sql,
      tokens: data.usage
        ? {
            prompt: data.usage.prompt_tokens,
            completion: data.usage.completion_tokens,
            total: data.usage.total_tokens,
          }
        : undefined,
    };
  } catch (error) {
    logger.error('[ZhipuClient] Request Error:', error);
    return {
      success: false,
      sql: '',
      error: error instanceof Error ? error.message : '请求失败',
    };
  }
}

/**
 * 验证 API Key 是否有效
 * @param apiKey API Key
 * @param model 使用的模型（使用用户选择的模型验证）
 */
export async function validateApiKey(apiKey: string, model?: string): Promise<boolean> {
  try {
    // 先验证 API Key 格式
    const parts = apiKey.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      logger.error('[ZhipuClient] Invalid API Key format, expected {id}.{secret}');
      return false;
    }

    // 获取认证 Token
    const token = await getAuthToken(apiKey);

    const response = await fetch(`${ZHIPU_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[ZhipuClient] Validation failed:', response.status, errorText);
    }

    return response.ok;
  } catch (error) {
    logger.error('[ZhipuClient] Validation error:', error);
    return false;
  }
}
