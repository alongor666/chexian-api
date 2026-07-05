/**
 * 客户来源去向子客户端（ApiClient 神类拆分 Phase 2 · customer-flow 域）
 *
 * 挂载点：apiClient.customerFlow.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 * 4 个端点均为纯 /query/ GET，统一经 queryGet 收口（替代原 client.ts 里
 * 「buildQueryString + request」模板；metadata 无参亦经 queryGet，URL 等价）。
 * 注：后端 /customer-flow/inflow（转入来源）当前源已移除转入字段、前端页面未消费，
 * 故此处不再暴露 inflow() 死封装；后端路由保留服务 agent 诊断链。
 */

import { QUERY_ROUTES } from './routes';
import type { ApiTransport } from './client-core';

export class CustomerFlowApi {
  constructor(private readonly t: ApiTransport) {}

  /** 客户来源去向 - 汇总 */
  summary(params?: Record<string, string>): Promise<any> {
    return this.t.queryGet<any>(QUERY_ROUTES.CUSTOMER_FLOW.SUMMARY, params);
  }

  /** 客户来源去向 - 流出去向 */
  outflow(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CUSTOMER_FLOW.OUTFLOW, params);
  }

  /** 客户来源去向 - 走势 */
  trend(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.CUSTOMER_FLOW.TREND, params);
  }

  /** 客户来源去向 - 元数据（年份/总行数） */
  metadata(): Promise<any> {
    return this.t.queryGet<any>(QUERY_ROUTES.CUSTOMER_FLOW.METADATA);
  }
}
