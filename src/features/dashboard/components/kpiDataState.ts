/**
 * KPI 空态判据 — 多省接入「前端空态保护」纯函数层（ADR G8 / Day-1 SOP §5）
 *
 * 背景：山西等新分公司账号首发当天，KPI 接口可能因数据尚在装载 / 缺数据而返回空对象 {}
 * 或全零规模。此时若静默渲染零值 KPI，业务方会误以为「真实零保费」。本模块提供判据，
 * 由 KpiSection 据此显式渲染「加载中 / 暂无数据」提示。
 *
 * ⚠️ 行为契约：纯函数，无渲染 / 无副作用；判据改动须保证 kpiDataState.test.ts 全绿。
 */
import type { KpiData } from '../hooks/useKpiData';

const toNum = (value: number | bigint | null | undefined): number =>
  typeof value === 'bigint' ? Number(value) : Number(value ?? 0);

/**
 * 判断 KPI 数据是否「无规模信号」（空态）。
 *
 * 判据：总保费 / 车险保费 / 保单件数 三个规模指标全为 0（或缺失）即视为空。
 * 任一 > 0 即视为有数据（即便部分占比 / 派生指标缺失，也按有数据渲染）。
 *
 * 选这三项做锚：它们是「是否有业务量」最直接的信号，且空对象 {} 经 toNum 全部归零，
 * 可一并覆盖「接口未返回 / 装载中」与「该范围真实无业务量」两类空。
 */
export function isKpiDataEmpty(kpis: KpiData): boolean {
  return (
    toNum(kpis.total_premium) <= 0 &&
    toNum(kpis.vehicle_premium) <= 0 &&
    toNum(kpis.policy_count) <= 0
  );
}
