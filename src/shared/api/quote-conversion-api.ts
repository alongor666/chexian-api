/**
 * 报价转化分析子客户端（ApiClient 神类拆分 Phase 2 · 首域打样）
 *
 * 挂载点：apiClient.quoteConversion.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 * 7 个端点均为纯 /query/ GET，统一经 queryGet 收口（替代原 client.ts 里
 * 「buildQueryString + request」模板）。
 */

import { QUERY_ROUTES } from './routes';
import type { ApiTransport } from './client-core';

export class QuoteConversionApi {
  constructor(private readonly t: ApiTransport) {}

  kpi(params?: Record<string, string>): Promise<any> {
    return this.t.queryGet<any>(QUERY_ROUTES.QUOTE_CONVERSION.KPI, params);
  }

  funnel(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.QUOTE_CONVERSION.FUNNEL, params);
  }

  drilldown(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.QUOTE_CONVERSION.DRILLDOWN, params);
  }

  heatmap(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.QUOTE_CONVERSION.HEATMAP, params);
  }

  price(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.QUOTE_CONVERSION.PRICE, params);
  }

  trend(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.QUOTE_CONVERSION.TREND, params);
  }

  ranking(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.QUOTE_CONVERSION.RANKING, params);
  }
}
