/**
 * 续保追踪 KPI 空态判据 — 多省接入「前端空态保护」纯函数层（ADR G8 / Day-1 SOP §5 推广）。
 *
 * 背景：山西等新分公司数据装载中 / 缺数据时，续保追踪端点返回空对象或全零聚合行（A/B/C 全 0）。
 * 页面原 `{data && ...}` 守卫识别不了「有 data 但无业务量」，会静默渲染 0 件应续 / 0.0% 续保率 →
 * 业务方误判「真实零续保」。本判据让页面改渲染 EmptyState「装载中」而非静默零。
 *
 * ⚠️ 行为契约：纯函数，无渲染 / 无副作用；判据改动须保证 renewalEmptyState.test.ts 全绿。
 */
import type { RenewalRow } from '../types';

const toNum = (value: number | null | undefined): number => Number(value ?? 0);

/**
 * 判断续保追踪是否「无业务量」（空态）。
 *
 * 规模锚 = 应续件数 A（续保业务的分母，最直接的「是否有续保盘」信号）。
 * 判据：整体应续 A ≤ 0 **且** 所有机构行应续 A 也都 ≤ 0 → 空态。
 * 任一 A > 0 即有业务量（即便续保率 / 报价率等占比缺失，也按有数据渲染）。
 *
 * 选 A 而非 C（已续）做锚：C=0 可能是「有应续但都没续」的真实经营结果（不是空态），
 * 而 A=0 才是「根本没有到期保单」= 装载中 / 缺数据。
 */
export function isRenewalEmpty(
  overall: RenewalRow | null | undefined,
  orgRows: readonly RenewalRow[] | undefined,
): boolean {
  if (!overall) return true;
  if (toNum(overall.A) > 0) return false;
  return !(orgRows ?? []).some((r) => toNum(r.A) > 0);
}
