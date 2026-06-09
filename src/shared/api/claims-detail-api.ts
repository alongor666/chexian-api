/**
 * 赔案明细子客户端（ApiClient 神类拆分 Phase 2 · claims-detail 域）
 *
 * 挂载点：apiClient.claimsDetail.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 * 11 个端点均为纯 /query/ GET，统一经 queryGet 收口（替代原 client.ts 里
 * 「buildQueryString + request」模板）。
 */

import { QUERY_ROUTES } from './routes';
import type { ApiTransport } from './client-core';

export class ClaimsDetailApi {
  constructor(private readonly t: ApiTransport) {}

  pendingOverview(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.PENDING_OVERVIEW, params);
  }

  pendingByOrg(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.PENDING_BY_ORG, params);
  }

  pendingAging(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.PENDING_AGING, params);
  }

  causeAnalysis(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.CAUSE_ANALYSIS, params);
  }

  geoAccident(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.GEO_ACCIDENT, params);
  }

  geoPlate(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.GEO_PLATE, params);
  }

  geoComparison(params?: Record<string, string>): Promise<any> {
    return this.t.queryGet<any>(QUERY_ROUTES.CLAIMS_DETAIL.GEO_COMPARISON, params);
  }

  claimCycle(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.CLAIM_CYCLE, params);
  }

  frequencyYoy(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.FREQUENCY_YOY, params);
  }

  lossRatioDev(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.LOSS_RATIO_DEV, params);
  }

  heatmap(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CLAIMS_DETAIL.HEATMAP, params);
  }
}
