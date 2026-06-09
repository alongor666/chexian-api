/**
 * 车驾意交叉销售子客户端（ApiClient 神类拆分 Phase 2 · cross-sell 域）
 *
 * 挂载点：apiClient.crossSell.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 * 7 个端点均为纯 /query/ GET：analysis/bundle 经 drilldownGet（带 drillPath
 * 序列化），其余 timePeriod/trend/topSalesman/orgTrend/heatmap 经 queryGet
 * 收口（替代原 client.ts 里「buildQueryString + request」模板）。
 *
 * 注：原 client.ts 方法的丰富内联返回类型在此**逐字段保留**（不降级为 any），
 *    故对调用方零类型回退。
 */

import { QUERY_ROUTES } from './routes';
import type { ApiTransport } from './client-core';
import type { CrossSellBundleResponse } from './types';

export class CrossSellApi {
  constructor(private readonly t: ApiTransport) {}

  /** 车驾意推介率（下钻） */
  analysis(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.t.drilldownGet(QUERY_ROUTES.CROSS_SELL, params);
  }

  /** 车驾意推介率 - 时间维度汇总 */
  timePeriod(params?: Record<string, string>): Promise<{
    maxDate: string;
    rows: Array<{
      coverage_combination: string;
      day_auto_count: number;
      day_driver_count: number;
      day_premium: number;
      day_rate: number;
      day_avg_premium: number;
      week_auto_count: number;
      week_driver_count: number;
      week_premium: number;
      week_rate: number;
      week_avg_premium: number;
      month_auto_count: number;
      month_driver_count: number;
      month_premium: number;
      month_rate: number;
      month_avg_premium: number;
      quarter_auto_count: number;
      quarter_driver_count: number;
      quarter_premium: number;
      quarter_rate: number;
      quarter_avg_premium: number;
      year_auto_count: number;
      year_driver_count: number;
      year_premium: number;
      year_rate: number;
      year_avg_premium: number;
    }>;
  }> {
    return this.t.queryGet(QUERY_ROUTES.CROSS_SELL_SUMMARY, params);
  }

  /** 车驾意推介率走势（按日/周/月/季粒度） */
  trend(params?: Record<string, string>): Promise<{
    rows: Array<{
      time_period: string;
      coverage_combination: string;
      rate: number;
      avg_premium: number;
      auto_count: number;
    }>;
  }> {
    return this.t.queryGet(QUERY_ROUTES.CROSS_SELL_TREND, params);
  }

  /** 车驾意推介率 TOP20 业务员分析 */
  topSalesman(params?: Record<string, string>): Promise<{
    rows: Array<{
      salesman_name: string;
      org_level_3: string;
      driver_premium: number;
      auto_count: number;
      rate: number;
      avg_premium: number;
    }>;
  }> {
    return this.t.queryGet(QUERY_ROUTES.CROSS_SELL_TOP_SALESMAN, params);
  }

  /** 交叉销售聚合（summary + trend + drilldown + topSalesman，下钻） */
  bundle(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<CrossSellBundleResponse> {
    return this.t.drilldownGet<CrossSellBundleResponse>(QUERY_ROUTES.CROSS_SELL_BUNDLE, params);
  }

  /** 机构推介率走势（最近 14 天，叠加柱+折线） */
  orgTrend(params?: Record<string, string>): Promise<{
    rows: Array<{
      date: string;
      auto_count: number;
      driver_count: number;
      rate: number;
      avg_premium: number;
    }>;
  }> {
    return this.t.queryGet(QUERY_ROUTES.CROSS_SELL_ORG_TREND, params);
  }

  /** 交叉销售热力图（最近 14 个时段 × 所有三级机构） */
  heatmap(params?: Record<string, string>): Promise<{
    rows: Array<{
      date: string;
      org_level_3: string;
      auto_count: number;
      driver_count: number;
      driver_policy_count: number;
      driver_premium: number;
      penetration_base_premium: number;
      rate: number;
      penetration_rate: number | null;
      avg_premium: number;
      achievement_rate: number | null;
    }>;
  }> {
    return this.t.queryGet(QUERY_ROUTES.CROSS_SELL_HEATMAP, params);
  }
}
