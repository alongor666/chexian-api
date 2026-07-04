/**
 * claims-detail KPI 空态判据 — 多省接入「前端空态保护」纯函数层（ADR G8 / Day-1 SOP §5 推广）。
 *
 * 背景：山西等新分公司数据装载中 / 缺数据时，赔付热力图端点返回空数组或全零聚合行。原守卫
 * `periods.length === 0` 只挡「无时间桶」，挡不住「有时间桶但所有规模锚为 0」→ 静默渲染零矩阵，
 * 业务方误判「真实零赔案」。本判据让 panel 改渲染 EmptyState「装载中」而非静默零。
 *
 * 范围说明：
 * - PendingClaimsPanel：刻意「0 件未决正常态」（codex P2 #2，无未决≠装载中，是「全已决」真实经营态），加守卫会回归。
 * - GeoRiskPanel：完整空态守卫见 `isGeoRiskEmpty`（2026-06-25-claude-6a5aad follow-up 落地）。
 * - LossRatioDevelopmentPanel：已有 `activeYears.length === 0` 空态框架。
 *
 * 入参刻意用最小结构类型（仅取规模锚字段），与 panel 内部 Row 类型解耦、便于纯函数单测。
 *
 * ⚠️ 行为契约：纯函数，无渲染 / 无副作用；判据改动须保证 claimsEmptyState.test.ts 全绿。
 * 负数/NaN 规模锚：经 toNum 后「不 > 0」→ 视为空态。对计数锚（件数）合理；冲销类负保费/负赔款
 * 若未来出现，会被判空（保守，宁显「装载中」不显误导零），单测已锁该行为。
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

/**
 * GeoRiskPanel 地理风险规模锚。geoAccident/geoPlate 两端点均为 `GROUP BY city` 聚合，
 * 无匹配数据（SX 装载中 / 窄筛选无地理归属）时返回空数组 `[]`——与 geoComparison 不同：
 * geoComparison 的 SQL 是「无 GROUP BY 的单行聚合」（`COUNT(*)` 等），即便 base CTE 为空
 * 也恒返回 1 行（`total_cases: 0` 等），故不能单独作为「数据缺失」锚（会把「真实窄筛选零赔案」
 * 也误判为缺失）。真正的数据缺失信号 = geoAccident 与 geoPlate 两端点**同时**返回空数组——
 * 若真实业务是「有出险地记录、只是异地占比为 0」，二者中至少一个会非空。
 */
type GeoScaleRow = { cases?: number | null };

/**
 * 地理风险面板空态：出险地（geoAccident）与车牌归属地（geoPlate）两端点的规模行**同时**
 * 缺失或全零。任一端点存在有效行（cases > 0）即视为有数据，不判空态。
 *
 * 用途：区分「SX 等新分公司数据装载中」（两端点均无行）与「窄筛选下真实零赔案」
 * （geoComparison 仍可能返回 total_cases=0，但 accident/plate 明细行存在，如仅 1 笔本地案件
 * 无异地案件时 cross_region_cases=0 但 accident 行非空）。
 */
export function isGeoRiskEmpty(
  accidentRows: readonly GeoScaleRow[] | undefined,
  plateRows: readonly GeoScaleRow[] | undefined,
): boolean {
  const hasAccident = !!accidentRows && accidentRows.some((r) => toNum(r.cases) > 0);
  const hasPlate = !!plateRows && plateRows.some((r) => toNum(r.cases) > 0);
  return !hasAccident && !hasPlate;
}
