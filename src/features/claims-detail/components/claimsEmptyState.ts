/**
 * claims-detail KPI 空态判据 — 多省接入「前端空态保护」纯函数层（ADR G8 / Day-1 SOP §5 推广）。
 *
 * 背景：山西等新分公司数据装载中 / 缺数据时，赔付热力图端点返回空数组或全零聚合行。原守卫
 * `periods.length === 0` 只挡「无时间桶」，挡不住「有时间桶但所有规模锚为 0」→ 静默渲染零矩阵，
 * 业务方误判「真实零赔案」。本判据让 panel 改渲染 EmptyState「装载中」而非静默零。
 *
 * 范围说明（仅热力图，其余 panel 刻意不动）：
 * - PendingClaimsPanel：刻意「0 件未决正常态」（codex P2 #2，无未决≠装载中，是「全已决」真实经营态），加守卫会回归。
 * - GeoRiskPanel：totalCases=0 时已渲染「本期暂无赔案数据」叙事，非静默零；加守卫会误伤真实零赔案的窄筛选。
 * - LossRatioDevelopmentPanel：已有 `activeYears.length === 0` 空态框架。
 *
 * 入参刻意用最小结构类型（仅取规模锚字段），与 panel 内部 Row 类型解耦、便于纯函数单测。
 *
 * ⚠️ 行为契约：纯函数，无渲染 / 无副作用；判据改动须保证 claimsEmptyState.test.ts 全绿。
 */

const toNum = (value: number | null | undefined): number => Number(value ?? 0);

/** 赔付热力图行规模锚（已赚保费 / 赔款 / 件数任一 > 0 即有业务量）。 */
type HeatmapScaleRow = {
  earned_premium_wan?: number | null;
  claim_count?: number | null;
  total_claims_wan?: number | null;
};

/**
 * 赔付热力图空态：无数据行，或所有行的已赚保费 / 已报告赔款 / 已报告件数全 ≤ 0。
 * 任一行任一规模锚 > 0 即有业务量（即便赔付率 / 出险率等占比缺失，也按有数据渲染）。
 */
export function isClaimsHeatmapEmpty(rows: readonly HeatmapScaleRow[] | undefined): boolean {
  if (!rows || rows.length === 0) return true;
  return !rows.some(
    (r) => toNum(r.earned_premium_wan) > 0 || toNum(r.claim_count) > 0 || toNum(r.total_claims_wan) > 0,
  );
}
