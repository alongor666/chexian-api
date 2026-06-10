/**
 * 巡检报告子客户端（ApiClient 神类拆分 Phase 2 · patrol 域 · 残渣域归并）
 *
 * 挂载点：apiClient.patrol.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 *
 * 判据：一个域只有在 ≥2 个相关端点时才独立成命名空间。patrol 域含 2 个端点
 *   （report / narrative），故从基类残渣中抽出独立成域。
 *
 * 2 个端点均为按 domain 拼路径的 /query/ GET。逐字符保留原 client.ts 里
 * 「`/query/${QUERY_ROUTES.PATROL}/${domain}` + request」模板以确保线缆签名零漂移：
 * URL/verb/param/body/auth/dedupe 完全不变。
 *   - report    ← getPatrolReport（/query/${QUERY_ROUTES.PATROL}/${domain}）
 *   - narrative ← getPatrolNarrative（/query/${QUERY_ROUTES.PATROL}/${domain}/narrative）
 */

import { QUERY_ROUTES } from './routes';
import type { ApiTransport } from './client-core';

export class PatrolApi {
  constructor(private readonly t: ApiTransport) {}

  /** 巡检报告 - 结构化结果 */
  report(domain: string) {
    return this.t.request<{ report: any; domain: string; source: string }>(`/query/${QUERY_ROUTES.PATROL}/${domain}`);
  }

  /** 巡检报告 - AI 叙事 */
  narrative(domain: string) {
    return this.t.request<{ content: string; generatedAt: string | null; domain: string }>(`/query/${QUERY_ROUTES.PATROL}/${domain}/narrative`);
  }
}
