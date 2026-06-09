/**
 * 维修资源子客户端（ApiClient 神类拆分 Phase 2 · repair 域）
 *
 * 挂载点：apiClient.repair.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 * v1（overview/detail/status/metadata）+ v2（city/channel/coopTier/scatter/
 * localResource/toPremium/diversionList/orphanShops），共 12 个端点，均为纯
 * /query/ GET，统一经 queryGet 收口。
 */

import { QUERY_ROUTES } from './routes';
import type { ApiTransport } from './client-core';

export class RepairApi {
  constructor(private readonly t: ApiTransport) {}

  // ── v1 ──
  overview(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.OVERVIEW, params);
  }

  detail(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.DETAIL, params);
  }

  status(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.STATUS, params);
  }

  metadata(): Promise<any> {
    return this.t.queryGet<any>(QUERY_ROUTES.REPAIR.METADATA);
  }

  // ── v2（2026-04-18 重设计）──
  city(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.CITY, params);
  }

  channel(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.CHANNEL, params);
  }

  coopTier(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.COOP_TIER, params);
  }

  scatter(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.SCATTER, params);
  }

  localResource(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.LOCAL_RESOURCE, params);
  }

  toPremium(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.TO_PREMIUM, params);
  }

  diversionList(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.DIVERSION_LIST, params);
  }

  orphanShops(params?: Record<string, string>): Promise<any[]> {
    return this.t.queryGet<any[]>(QUERY_ROUTES.REPAIR.ORPHAN_SHOPS, params);
  }
}
