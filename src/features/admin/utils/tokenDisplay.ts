/**
 * API Token 展示纯逻辑
 *
 * 从 ApiTokensPanel 提取的与 React 无关的纯函数，便于直接单测：
 * - fmtDate：ISO 时间 → 本地化展示串（空/异常兜底）
 * - maskTokenId：tokenId 脱敏（首 4…末 2）
 * - isExpired：Token 是否失效（已吊销或已过期）
 *
 * 行为与原组件内联实现逐字符一致。
 */

import type { ApiTokenInfo } from '../../../shared/api/client';

/** ISO 时间串 → zh-CN 本地化（24 小时制）；空值显示「—」，解析异常回退原串 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

/** tokenId 脱敏：长度 ≤6 原样返回，否则「首 4…末 2」 */
export function maskTokenId(id: string): string {
  if (id.length <= 6) return id;
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
}

/** Token 是否失效：已吊销视为失效，否则比较过期时间与当前时刻 */
export function isExpired(t: ApiTokenInfo): boolean {
  if (t.revokedAt) return true;
  return new Date(t.expiresAt).getTime() < Date.now();
}
