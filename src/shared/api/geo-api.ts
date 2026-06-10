/**
 * 承保地理分布子客户端（ApiClient 神类拆分 Phase 2 · geo 域 · 残渣域归并）
 *
 * 挂载点：apiClient.geo.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 *
 * 判据：一个域只有在 ≥2 个相关端点时才独立成命名空间。geo 域含 2 个端点
 *   （province / city），故从基类残渣中抽出独立成域。
 *
 * 2 个端点均为纯 /query/ GET。逐字符保留原 client.ts 里「buildQueryString + request」
 * 模板以确保线缆签名零漂移：URL/verb/param/body/auth/dedupe 完全不变。
 *   - province ← getPolicyGeoProvince（QUERY_ROUTES.POLICY_GEO.PROVINCE）
 *   - city     ← getPolicyGeoCity（QUERY_ROUTES.POLICY_GEO.CITY）
 */

import { QUERY_ROUTES } from './routes';
import type { ApiTransport } from './client-core';

export class GeoApi {
  constructor(private readonly t: ApiTransport) {}

  /** 承保地理分布 - 省级 */
  province(params?: Record<string, string>): Promise<any[]> {
    const query = this.t.buildQueryString(params);
    return this.t.request<any[]>(`/query/${QUERY_ROUTES.POLICY_GEO.PROVINCE}${query ? `?${query}` : ''}`);
  }

  /** 承保地理分布 - 城市级 */
  city(params?: Record<string, string>): Promise<any[]> {
    const query = this.t.buildQueryString(params);
    return this.t.request<any[]>(`/query/${QUERY_ROUTES.POLICY_GEO.CITY}${query ? `?${query}` : ''}`);
  }
}
