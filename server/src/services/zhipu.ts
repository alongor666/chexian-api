/**
 * 智谱 AI 服务
 * Zhipu AI Service
 *
 * 调用智谱 GLM 模型生成 SQL
 * 使用 Node.js crypto 进行 JWT 签名
 */

import crypto from 'crypto';
import { maskApiKey, safeLog } from '../utils/security.js';

// 智谱 API 端点
const ZHIPU_API_BASE = 'https://open.bigmodel.cn/api/paas/v4';

// 默认模型
const DEFAULT_MODEL = 'glm-4.7-flash';

/**
 * 配置接口
 */
export interface ZhipuConfig {
  apiKey: string;
  model?: string;
}

/**
 * AI SQL 生成结果
 */
export interface AISqlResult {
  success: boolean;
  sql: string;
  explanation?: string;
  error?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * 对话消息
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 智谱 API 响应
 */
interface ZhipuResponse {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    message: string;
    code: string;
  };
}

/**
 * Base64URL 编码
 */
function base64UrlEncode(data: Buffer | string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data) : data;
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 生成智谱 API 的 JWT Token
 * API Key 格式: {id}.{secret}
 */
function generateJwtToken(apiKey: string, expSeconds: number = 3600): string {
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

  // 生成 HMAC-SHA256 签名
  const signatureInput = `${headerB64}.${payloadB64}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signatureInput);
  const signature = base64UrlEncode(hmac.digest());

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * 提取 SQL 代码块
 */
function extractSqlFromResponse(response: string): string {
  // 尝试提取 ```sql ... ``` 代码块
  const sqlBlockMatch = response.match(/```sql\s*([\s\S]*?)```/i);
  if (sqlBlockMatch) {
    return sqlBlockMatch[1].trim();
  }

  // 尝试提取 ``` ... ``` 代码块
  const codeBlockMatch = response.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 如果没有代码块，检查是否整个响应就是 SQL
  const trimmed = response.trim();
  if (trimmed.toUpperCase().startsWith('SELECT') || trimmed.toUpperCase().startsWith('WITH')) {
    return trimmed;
  }

  return trimmed;
}

/**
 * 车险 SQL 生成系统提示（精简版）
 */
const SYSTEM_PROMPT = `你是车险SQL生成器。只输出SQL，无需解释。

## 可用视图

1. **PolicyFact** - 保单明细（保费、件数、续保等）
2. **SalesmanPlanFact** - 业务员保费计划

## 表结构 PolicyFact

### 维度字段
- org_level_3 机构 | salesman_name 业务员
- customer_category 客户类别 [非营业个人客车|摩托车|非营业货车|营业货车等]
- insurance_type 险类 [交强险|商业保险]
- coverage_combination 险别组合 [单交|交三|主全]
- policy_date 签单日期 | insurance_start_date 起保日期
- tonnage_segment 吨位段 (仅营业货车)

### 布尔字段
- is_renewal 续保 | is_renewable 可续 | is_new_car 新车 | is_nev 新能源

### 度量字段
- premium 保费(SUM) | policy_no 保单号(仅COUNT DISTINCT)
- commercial_pricing_factor 自主系数(AVG，仅商业险)

## 强制规则

1. **隐私保护**：policy_no 只能在 COUNT/COUNT DISTINCT 内使用
2. 必须包含聚合函数(SUM/COUNT/AVG等)
3. 别名用中文如"总保费"
4. 默认LIMIT 1000

## 示例

Q: 各机构保费排名
A:
SELECT org_level_3 AS "机构",
  SUM(premium) AS "总保费",
  COUNT(DISTINCT policy_no) AS "件数"
FROM PolicyFact
GROUP BY org_level_3
ORDER BY "总保费" DESC
LIMIT 1000

Q: 业务员保费Top20
A:
SELECT salesman_name AS "业务员",
  org_level_3 AS "机构",
  SUM(premium) AS "总保费"
FROM PolicyFact
GROUP BY salesman_name, org_level_3
ORDER BY "总保费" DESC
LIMIT 20

现在根据用户查询生成SQL:`;

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
      error: '请配置智谱 API Key',
    };
  }

  // 验证 API Key 格式（不记录实际值）
  const parts = apiKey.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    safeLog('warn', 'Zhipu', 'Invalid API Key format', { apiKey: maskApiKey(apiKey) });
    return {
      success: false,
      sql: '',
      error: 'API Key 格式无效，应为 {id}.{secret}',
    };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: query },
  ];

  try {
    // 生成 JWT Token
    const token = generateJwtToken(apiKey);

    const response = await fetch(`${ZHIPU_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // 使用安全日志（不输出可能包含敏感信息的详细错误）
      safeLog('error', 'Zhipu', `API Error: ${response.status}`, {
        // 不记录 errorText，可能包含敏感信息
      });

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
          error: `API 错误: ${response.status}`,
        };
      }
    }

    const data = await response.json() as ZhipuResponse;

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
    // 使用安全日志（不暴露详细错误堆栈）
    const errorMsg = error instanceof Error ? error.message : '请求失败';
    safeLog('error', 'Zhipu', `Request Error: ${errorMsg}`);
    return {
      success: false,
      sql: '',
      error: errorMsg,
    };
  }
}

/**
 * 机构推介率趋势分析结果
 */
export interface TrendAnalysisResult {
  success: boolean;
  analysis: string;
  error?: string;
}

/**
 * 调用智谱 AI 分析机构推介率趋势
 */
export async function analyzeOrgTrendWithZhipu(
  rows: Array<{ date: string; auto_count: number; driver_count: number; rate: number; avg_premium: number }>,
  context: { org: string; coverage: string },
  config: ZhipuConfig
): Promise<TrendAnalysisResult> {
  const { apiKey, model = DEFAULT_MODEL } = config;

  if (!apiKey) {
    return { success: false, analysis: '', error: '未配置智谱 API Key' };
  }

  const parts = apiKey.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { success: false, analysis: '', error: 'API Key 格式无效' };
  }

  const dataStr = rows
    .map(r => `${r.date} 车险${r.auto_count}件 驾意${r.driver_count}件 推介率${r.rate}% 件均保费${r.avg_premium}元`)
    .join('\n');

  const systemPrompt = `你是车险业务分析专家。请根据机构最近每日推介率和件均保费数据，输出两段式趋势分析（总字数220字以内）。
硬性格式要求：
1) 第一段只讲“推介率”；
2) 第二段只讲“件均保费”。
每一段都必须包含：近30天均值、近7天均值、连续下降天数、最高值（含日期）、最低值（含日期）。
可补充一句可执行建议，但不要写标题、不要编号、不要Markdown。`;

  const userMsg = `机构：${context.org}，险种：${context.coverage}\n数据（日期 车险件数 驾意件数 推介率 件均保费）：\n${dataStr}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMsg },
  ];

  try {
    const token = generateJwtToken(apiKey);
    const response = await fetch(`${ZHIPU_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 420 }),
    });

    if (!response.ok) {
      return { success: false, analysis: '', error: `API 错误: ${response.status}` };
    }

    const data = await response.json() as ZhipuResponse;
    if (data.error) {
      return { success: false, analysis: '', error: data.error.message };
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { success: false, analysis: '', error: '模型返回内容为空' };
    }

    return { success: true, analysis: content };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '请求失败';
    safeLog('error', 'Zhipu', `TrendAnalysis Error: ${msg}`);
    return { success: false, analysis: '', error: msg };
  }
}

/**
 * 验证 API Key 是否有效
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const parts = apiKey.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return false;
    }

    const token = generateJwtToken(apiKey);

    const response = await fetch(`${ZHIPU_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
