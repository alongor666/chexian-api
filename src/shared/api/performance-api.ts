/**
 * 业绩分析子客户端（ApiClient 神类拆分 Phase 2 · performance 域）
 *
 * 挂载点：apiClient.performance.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 * 6 个端点均为纯 /query/ GET：drilldown/bundle 经 drilldownGet（带 drillPath
 * 序列化），其余 summary/trend/orgHeatmap/topSalesman 经 queryGet 收口
 * （替代原 client.ts 里「buildQueryString + request」模板）。
 *
 * 注：原 client.ts 方法的丰富内联返回类型在此**逐字段保留**（不降级为 any），
 *    故对调用方零类型回退。
 */

import { QUERY_ROUTES } from './routes';
import type { ApiTransport } from './client-core';
import type { PerformanceBundleResponse } from './types';

export class PerformanceApi {
  constructor(private readonly t: ApiTransport) {}

  /** 业绩分析 - 险别组合业绩环比 */
  summary(params?: Record<string, string>): Promise<{
    rows: Array<{
      coverage_combination: string;
      row_label: string;
      row_level: number;
      expand_key: string | null;
      premium: number;
      auto_count: number;
      avg_premium: number;
      plan_premium: number | null;
      achievement_rate: number | null;
      growth_rate: number | null;
      nev_rate: number;
      renewal_rate: number;
      transfer_business_rate: number;
      new_car_rate: number;
      transfer_rate: number;
    }>;
  }> {
    return this.t.queryGet(QUERY_ROUTES.PERFORMANCE_SUMMARY, params);
  }

  /** 业绩分析 - 车险保费/件数走势 */
  trend(params?: Record<string, string>): Promise<{
    rows: Array<{
      time_period: string;
      line_key: string;
      line_label: string;
      line_order: number;
      premium: number;
      auto_count: number;
    }>;
  }> {
    return this.t.queryGet(QUERY_ROUTES.PERFORMANCE_TREND, params);
  }

  /** 业绩分析 - 下钻数据 */
  drilldown(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<{
    summary: Record<string, unknown> | null;
    rows: Array<Record<string, unknown>>;
    drillPath: Array<{ dimension: string; value: string }>;
    groupBy: string | null;
  }> {
    return this.t.drilldownGet(QUERY_ROUTES.PERFORMANCE_DRILLDOWN, params);
  }

  /** 业绩分析 - 三级机构 15 周期热力图 */
  orgHeatmap(params?: Record<string, string>): Promise<{
    rows: Array<{
      org_level_3: string;
      policy_date: string;
      premium: number;
      plan_premium: number | null;
      prev_mom_premium: number;
      prev_yoy_premium: number;
      achievement_rate: number | null;
      mom_growth_rate: number | null;
      yoy_growth_rate: number | null;
    }>;
  }> {
    return this.t.queryGet(QUERY_ROUTES.PERFORMANCE_ORG_HEATMAP, params);
  }

  /** 业绩分析 - TOP20 业务员 */
  topSalesman(params?: Record<string, string>): Promise<{
    rows: Array<{
      dimension_name: string;
      premium: number;
      auto_count: number;
      plan_premium: number | null;
      achievement_rate: number | null;
      growth_rate: number | null;
      nev_rate: number;
      renewal_rate: number;
      transfer_business_rate: number;
      new_car_rate: number;
      transfer_rate: number;
      quadrant?: string;
    }>;
  }> {
    return this.t.queryGet(QUERY_ROUTES.PERFORMANCE_TOP_SALESMAN, params);
  }

  /** 业绩分析聚合（summary + trend + drilldown + topSalesman，下钻） */
  bundle(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<PerformanceBundleResponse> {
    return this.t.drilldownGet<PerformanceBundleResponse>(QUERY_ROUTES.PERFORMANCE_BUNDLE, params);
  }
}
