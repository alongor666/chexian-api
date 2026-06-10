/**
 * 保费分析子客户端（ApiClient 神类拆分 Phase 2 · premium 域 · 残渣域归并）
 *
 * 挂载点：apiClient.premium.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 *
 * 判据：一个域只有在 ≥2 个相关端点时才独立成命名空间。premium 域含 3 个端点
 *   （report / plan / achievement），故从基类残渣中抽出独立成域。
 *
 * 3 个端点均为纯 /query/ GET。逐字符保留原 client.ts 里「buildQueryString + request」
 * 模板（未改走 queryGet）以确保线缆签名零漂移：URL/verb/param/body/auth/dedupe 完全不变。
 *   - report      ← getPremiumReport（QUERY_ROUTES.PREMIUM_REPORT）
 *   - plan        ← getPremiumPlan（QUERY_ROUTES.PREMIUM_PLAN）
 *   - achievement ← getPlanAchievement（QUERY_ROUTES.PLAN_ACHIEVEMENT；含 resp.data ?? resp
 *                   解包 + 丰富的 params/返回类型，逐字保留）
 */

import { QUERY_ROUTES } from './routes';
import type { ApiTransport } from './client-core';

export class PremiumApi {
  constructor(private readonly t: ApiTransport) {}

  /**
   * 获取保费报表数据（机构汇总 / 业务员明细）
   */
  report(params?: Record<string, any>): Promise<any[]> {
    const query = this.t.buildQueryString(params);
    return this.t.request(`/query/${QUERY_ROUTES.PREMIUM_REPORT}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取保费达成下钻数据（六级下钻 + KPI + 达成率分布）
   */
  plan(params?: Record<string, any>): Promise<any> {
    const query = this.t.buildQueryString(params);
    return this.t.request(`/query/${QUERY_ROUTES.PREMIUM_PLAN}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取保费达成面板数据（合并端点：1 次请求返回 children + summary + distribution）
   *
   * 替代原来的 3 次 plan() 调用，性能提升 3x。
   * 返回结构：{ children: [...], summary: {...}, distribution: [...], meta: {...} }
   */
  async achievement(params?: {
    planYear?: number;
    level?: string;
    orgFilter?: string;
    teamFilter?: string;
    salesmanFilter?: string;
    customerCategoryFilter?: string;
    sortField?: string;
    sortOrder?: string;
  }): Promise<{
    children: any[];
    summary: any | null;
    distribution: any[];
    meta: { plan_year: number; level: string };
  }> {
    const query = this.t.buildQueryString(params);
    const resp = await this.t.request<{
      children: any[];
      summary: any | null;
      distribution: any[];
      meta: { plan_year: number; level: string };
      data?: {
        children: any[];
        summary: any | null;
        distribution: any[];
        meta: { plan_year: number; level: string };
      };
    }>(`/query/${QUERY_ROUTES.PLAN_ACHIEVEMENT}${query ? `?${query}` : ''}`);
    return resp.data ?? resp;
  }
}
