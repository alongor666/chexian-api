/**
 * 报价转化 KPI 空态判据 — 多省接入「前端空态保护」纯函数层（ADR G8 / Day-1 SOP §5 推广）
 *
 * 背景：报价转化 KPI 端点返回 `data: data[0] ?? {}`（server query/quote-conversion.ts）。
 * 山西等新分公司数据装载中 / 缺数据时返回空对象 {} 或全零聚合行。组件原 `!data` 守卫无法
 * 识别空对象（{} 为 truthy），会静默渲染 0.0% 转化率 / 0 件报价 → 业务方误判「真实零报价」。
 *
 * ⚠️ 行为契约：纯函数，无渲染 / 无副作用；判据改动须保证 quoteKpiState.test.ts 全绿。
 */
import type { QuoteKpi } from '../types';

const toNum = (value: number | null | undefined): number => Number(value ?? 0);

/**
 * 判断报价转化 KPI 是否「无规模信号」（空态）。
 *
 * 判据：报价总量 / 承保件数 / 承保保费 三个规模指标全为 0（或缺失）即视为空。
 * 任一 > 0 即视为有数据（即便折扣率 / 转化率等占比缺失，也按有数据渲染）。
 *
 * 选这三项做锚：它们是「是否有报价业务量」最直接的信号，且 undefined / 空对象 {} 经 toNum
 * 全部归零，可一并覆盖「接口未返回 / 装载中」与「该范围真实无报价」两类空。
 */
export function isQuoteKpiEmpty(data: QuoteKpi | undefined): boolean {
  if (!data) return true;
  return (
    toNum(data.total_quotes) <= 0 &&
    toNum(data.total_insured) <= 0 &&
    toNum(data.insured_premium) <= 0
  );
}
