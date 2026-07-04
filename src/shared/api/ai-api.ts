/**
 * AI 子客户端（ApiClient 神类拆分 Phase 2 · ai 域）
 *
 * 挂载点：apiClient.ai.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 *
 * POST 端点（1 个）：
 *   detectRequirement(params)  → POST ai/detect-requirement
 *
 * GET 端点（2 个）：
 *   capabilities()             → GET  ai/capabilities
 *   quickSuggestions()         → GET  ai/quick-suggestions
 *
 * 注：analyzeTrend（POST ai/trend-analysis）已于 BACKLOG 2026-06-09-claude-44f2ca 移除——
 * 前端唯一调用方 CrossSellOrgTrendChart 在 commit 5a759d10（2026-03-10）改用客户端「程序解读」，
 * 之后无任何组件调用该方法（PR #547 评审确认零调用点）。后端 /api/ai/trend-analysis 路由保留
 * （未发现前端外的消费方，但保守起见不删，避免误伤可能的直接 curl/未来接入）。
 */

import { AI_ROUTES } from './routes';
import type { ApiTransport } from './client-core';
import type { DetectRequirementResponse, CapabilityInfo } from './types';

export class AiApi {
  constructor(private readonly t: ApiTransport) {}

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
