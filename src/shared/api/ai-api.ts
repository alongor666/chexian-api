/**
 * AI 子客户端（ApiClient 神类拆分 Phase 2 · ai 域）
 *
 * 挂载点：apiClient.ai.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 *
 * POST 端点（2 个）：
 *   analyzeTrend(params)       → POST ai/trend-analysis
 *   detectRequirement(params)  → POST ai/detect-requirement
 *
 * GET 端点（2 个）：
 *   capabilities()             → GET  ai/capabilities
 *   quickSuggestions()         → GET  ai/quick-suggestions
 */

import { AI_ROUTES } from './routes';
import type { ApiTransport } from './client-core';
import type { DetectRequirementResponse, CapabilityInfo } from './types';

export class AiApi {
  constructor(private readonly t: ApiTransport) {}

  /**
   * AI 分析机构推介率趋势（后端读取 API Key，无需前端传）
   */
  analyzeTrend(params: {
    rows: Array<{ date: string; auto_count: number; driver_count: number; rate: number; avg_premium: number }>;
    org: string;
    coverage: string;
  }): Promise<{ success: boolean; analysis: string; error?: string }> {
    return this.t.request(`/${AI_ROUTES.TREND_ANALYSIS}`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * AI 智能需求识别
   */
  detectRequirement(params: {
    message: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<DetectRequirementResponse> {
    return this.t.request(`/${AI_ROUTES.DETECT_REQUIREMENT}`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * 获取能力注册表
   */
  capabilities(): Promise<{ success: boolean; data: CapabilityInfo[] }> {
    return this.t.request(`/${AI_ROUTES.CAPABILITIES}`);
  }

  /**
   * 获取首页快捷建议
   */
  quickSuggestions(): Promise<{ success: boolean; data: Array<{ text: string; capabilityId: string }> }> {
    return this.t.request(`/${AI_ROUTES.QUICK_SUGGESTIONS}`);
  }
}
