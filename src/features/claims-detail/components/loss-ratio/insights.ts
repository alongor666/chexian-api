/**
 * 赔付率发展三角形 — 阈值常量 + 规则驱动洞察生成器
 *
 * 来源：原 `utils/devInsightRules.ts`（v3 规则机制）迁移升级，输出形态适配
 * `shared/InsightCard`（severity + iconKey + metricValue/metricLabel + kind）。
 * 业务阈值与原版完全一致，只调整输出结构。
 *
 * cohort 同源（codex review 防御）：所有指标值（loss_ratio_pct / incident_rate_pct /
 * avg_claim / coverage_pct）均来自同一条 SQL `generateLossRatioDevelopmentQuery`，
 * 横向"同期对比"是不同 cohort_year 间的比较，分子分母均出自同一 SQL 的同一
 * `policies` CTE，cohort 严格自洽 — 不会踩 PR #411 Tab 2 的跨 SQL ratio 坑。
 *
 * 阈值修改时必须同步更新本文件顶部注释 + insights.test.ts 阈值边界用例。
 */
import type { CohortData, LossRatioInsight, LossRatioMetric } from './types';

export const LOSS_RATIO_THRESHOLDS = {
  /** 赔付率 > % → 倒挂（severity: bad, iconKey: alert） */
  lrInverted: 100,
  /** 赔付率 > % → 偏高（severity: bad, iconKey: flame） */
  lrHigh: 70,
  /** 出险率 > % → 超红线（severity: bad, iconKey: alert） */
  irHigh: 70,
  /** 出险率 > % → 偏高（severity: warn, iconKey: flame） */
  irModerate: 50,
  /** 头尾年份指标 delta（pp）绝对值 ≥ → 趋势洞察 */
  trendDeltaPp: 15,
  /** 案均赔款单月 / 年内均值 ≥ 倍 → 异常尖峰 */
  anomalyMultiplier: 3,
  /** 同期对比 delta（pp）绝对值 ≥ → compare note */
  compareDeltaPp: 15,
  /** 案均赔款头尾年份增长率（%）绝对值 ≥ → 趋势洞察 */
  avgClaimGrowthPct: 40,
  /** 案均赔款同期对比（%）绝对值 ≥ → compare note */
  avgClaimComparePct: 30,
  /** maxDev ≥ → 视为成熟 cohort，可纳入阈值告警 */
  minDevForAlert: 6,
} as const;

const getVal = (
  cohorts: Record<number, CohortData>,
  yr: number,
  m: number,
  key: keyof CohortData['months'][number],
): number | null => {
  const v = cohorts[yr]?.months[m]?.[key];
  return v != null ? Number(v) : null;
};

const getLatestVal = (
  cohorts: Record<number, CohortData>,
  yr: number,
  key: keyof CohortData['months'][number],
): number | null => {
  const maxM = cohorts[yr]?.maxDev ?? 0;
  return maxM > 0 ? getVal(cohorts, yr, maxM, key) : null;
};

const fmtPct = (v: number): string => v.toFixed(1);
const fmtMoney = (v: number): string => Math.round(v).toLocaleString();
const sign = (v: number): string => (v > 0 ? '+' : '');
const fmtDev = (m: number): string => `第${m}月`;

// ═══════════════════════════════════════════════════
// 赔付率洞察
// ═══════════════════════════════════════════════════
function lossRatioInsights(
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
): LossRatioInsight[] {
  const items: LossRatioInsight[] = [];

  // 阈值告警（合并同类项）
  if (matureYears.length > 0) {
    const inverted: { yr: number; v: number }[] = [];
    const high: { yr: number; v: number }[] = [];
    for (const yr of matureYears) {
      const lr = getLatestVal(cohorts, yr, 'loss_ratio_pct');
      if (lr == null) continue;
      if (lr > LOSS_RATIO_THRESHOLDS.lrInverted) inverted.push({ yr, v: lr });
      else if (lr > LOSS_RATIO_THRESHOLDS.lrHigh) high.push({ yr, v: lr });
    }
    if (inverted.length > 0) {
      const max = inverted.reduce((a, b) => (a.v > b.v ? a : b));
      const detail = inverted.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        id: `lr-inverted-${inverted.map(x => x.yr).join('-')}`,
        kind: 'card',
        severity: 'bad',
        iconKey: 'alert',
        title:
          inverted.length === 1
            ? `${inverted[0].yr}年赔付率倒挂`
            : `连续${inverted.length}年赔付率倒挂`,
        body: `${detail}，均超过 ${LOSS_RATIO_THRESHOLDS.lrInverted}%，承保亏损严重。`,
        metricValue: fmtPct(max.v),
        metricLabel: `% 最高·${max.yr}年`,
      });
    }
    if (high.length > 0) {
      const max = high.reduce((a, b) => (a.v > b.v ? a : b));
      const detail = high.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        id: `lr-high-${high.map(x => x.yr).join('-')}`,
        kind: 'card',
        severity: 'bad',
        iconKey: 'flame',
        title: '赔付率偏高',
        body: `${detail}，超过 ${LOSS_RATIO_THRESHOLDS.lrHigh}% 警戒线。`,
        metricValue: fmtPct(max.v),
        metricLabel: `% 最高·${max.yr}年`,
      });
    }
  }

  // 趋势（头尾年份）
  if (matureYears.length >= 2) {
    const first = matureYears[0];
    const last = matureYears[matureYears.length - 1];
    const lrF = getLatestVal(cohorts, first, 'loss_ratio_pct');
    const lrL = getLatestVal(cohorts, last, 'loss_ratio_pct');
    if (lrF != null && lrL != null) {
      const delta = lrL - lrF;
      const span = last - first;
      if (Math.abs(delta) >= LOSS_RATIO_THRESHOLDS.trendDeltaPp) {
        const worse = delta > 0;
        items.push({
          id: `lr-trend-${first}-${last}`,
          kind: 'card',
          severity: worse ? 'warn' : 'good',
          iconKey: worse ? 'trendUp' : 'trendDown',
          title: `赔付率${worse ? '持续恶化' : '持续改善'}`,
          body: `${first}→${last}年：${fmtPct(lrF)}%→${fmtPct(lrL)}%，年均${sign(delta / span)}${fmtPct(delta / span)}pp。`,
          metricValue: `${sign(delta)}${fmtPct(delta)}`,
          metricLabel: `pp 累计变化`,
        });
      } else if (lrF > LOSS_RATIO_THRESHOLDS.lrHigh && lrL > LOSS_RATIO_THRESHOLDS.lrHigh) {
        const allVals = matureYears
          .map(yr => getLatestVal(cohorts, yr, 'loss_ratio_pct'))
          .filter((v): v is number => v != null);
        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        items.push({
          id: `lr-shock-${first}-${last}`,
          kind: 'card',
          severity: 'warn',
          iconKey: 'shockwave',
          title: '赔付率高位震荡',
          body: `${first}→${last}年在 ${fmtPct(min)}%~${fmtPct(max)}% 区间波动，未见改善趋势。`,
          metricValue: fmtPct(max - min),
          metricLabel: `pp 波幅`,
        });
      }
    }
  }

  // 同期对比（早期 cohort vs 成熟 cohort 同月）
  appendCompare(items, cohorts, matureYears, earlyYears, 'loss_ratio_pct', '赔付率', '%', true);

  return items;
}

// ═══════════════════════════════════════════════════
// 出险率洞察
// ═══════════════════════════════════════════════════
function incidentRateInsights(
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
): LossRatioInsight[] {
  const items: LossRatioInsight[] = [];

  if (matureYears.length > 0) {
    const high: { yr: number; v: number }[] = [];
    const moderate: { yr: number; v: number }[] = [];
    for (const yr of matureYears) {
      const ir = getLatestVal(cohorts, yr, 'incident_rate_pct');
      if (ir == null) continue;
      if (ir > LOSS_RATIO_THRESHOLDS.irHigh) high.push({ yr, v: ir });
      else if (ir > LOSS_RATIO_THRESHOLDS.irModerate) moderate.push({ yr, v: ir });
    }
    if (high.length > 0) {
      const max = high.reduce((a, b) => (a.v > b.v ? a : b));
      const detail = high.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        id: `ir-high-${high.map(x => x.yr).join('-')}`,
        kind: 'card',
        severity: 'bad',
        iconKey: 'alert',
        title: '出险率超红线',
        body: `${detail}，远超 ${LOSS_RATIO_THRESHOLDS.irHigh}% 警戒线，风险敞口大。`,
        metricValue: fmtPct(max.v),
        metricLabel: `% 最高·${max.yr}年`,
      });
    }
    if (moderate.length > 0) {
      const max = moderate.reduce((a, b) => (a.v > b.v ? a : b));
      const detail = moderate.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        id: `ir-mod-${moderate.map(x => x.yr).join('-')}`,
        kind: 'card',
        severity: 'warn',
        iconKey: 'flame',
        title: '出险率偏高',
        body: `${detail}，超过 ${LOSS_RATIO_THRESHOLDS.irModerate}% 关注线。`,
        metricValue: fmtPct(max.v),
        metricLabel: `% 最高·${max.yr}年`,
      });
    }
  }

  if (matureYears.length >= 2) {
    const first = matureYears[0];
    const last = matureYears[matureYears.length - 1];
    const irF = getLatestVal(cohorts, first, 'incident_rate_pct');
    const irL = getLatestVal(cohorts, last, 'incident_rate_pct');
    if (irF != null && irL != null) {
      const delta = irL - irF;
      if (Math.abs(delta) >= LOSS_RATIO_THRESHOLDS.trendDeltaPp) {
        const worse = delta > 0;
        items.push({
          id: `ir-trend-${first}-${last}`,
          kind: 'card',
          severity: worse ? 'warn' : 'good',
          iconKey: worse ? 'trendUp' : 'trendDown',
          title: `出险率${worse ? '持续走高' : '持续回落'}`,
          body: `${first}→${last}年：${fmtPct(irF)}%→${fmtPct(irL)}%。`,
          metricValue: `${sign(delta)}${fmtPct(delta)}`,
          metricLabel: `pp 累计变化`,
        });
      } else if (
        irF > LOSS_RATIO_THRESHOLDS.irModerate &&
        irL > LOSS_RATIO_THRESHOLDS.irModerate
      ) {
        const allVals = matureYears
          .map(yr => getLatestVal(cohorts, yr, 'incident_rate_pct'))
          .filter((v): v is number => v != null);
        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        items.push({
          id: `ir-shock-${first}-${last}`,
          kind: 'card',
          severity: 'warn',
          iconKey: 'shockwave',
          title: '出险率高位震荡',
          body: `${first}→${last}年在 ${fmtPct(min)}%~${fmtPct(max)}% 区间波动，未见改善。`,
          metricValue: fmtPct(max - min),
          metricLabel: `pp 波幅`,
        });
      }
    }
  }

  appendCompare(items, cohorts, matureYears, earlyYears, 'incident_rate_pct', '出险率', '%', true);

  return items;
}

// ═══════════════════════════════════════════════════
// 案均赔款洞察
// ═══════════════════════════════════════════════════
function avgClaimInsights(
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
  sorted: number[],
): LossRatioInsight[] {
  const items: LossRatioInsight[] = [];

  // 趋势（头尾年份）
  if (matureYears.length >= 2) {
    const first = matureYears[0];
    const last = matureYears[matureYears.length - 1];
    const acF = getLatestVal(cohorts, first, 'avg_claim');
    const acL = getLatestVal(cohorts, last, 'avg_claim');
    if (acF != null && acL != null && acF > 0) {
      const growthPct = ((acL - acF) / acF) * 100;
      if (Math.abs(growthPct) >= LOSS_RATIO_THRESHOLDS.avgClaimGrowthPct) {
        const worse = growthPct > 0;
        items.push({
          id: `ac-trend-${first}-${last}`,
          kind: 'card',
          severity: worse ? 'warn' : 'good',
          iconKey: worse ? 'trendUp' : 'trendDown',
          title: `案均赔款${worse ? '逐年攀升' : '逐年下降'}`,
          body: `${first}→${last}年：${fmtMoney(acF)}→${fmtMoney(acL)}元，${worse ? '大额案件占比可能上升' : '理赔管控见效'}。`,
          metricValue: `${sign(growthPct)}${fmtPct(growthPct)}`,
          metricLabel: `% 累计变化`,
        });
      }
    }
  }

  // 异常尖峰
  for (const yr of sorted) {
    const maxM = cohorts[yr]?.maxDev ?? 0;
    if (maxM < 3) continue;
    const vals: { m: number; v: number }[] = [];
    for (let m = 1; m <= maxM; m++) {
      const v = getVal(cohorts, yr, m, 'avg_claim');
      if (v != null) vals.push({ m, v });
    }
    if (vals.length < 3) continue;
    const mean = vals.reduce((s, x) => s + x.v, 0) / vals.length;
    const peak = vals.reduce((best, x) => (x.v > best.v ? x : best), vals[0]);
    if (mean > 0 && peak.v > mean * LOSS_RATIO_THRESHOLDS.anomalyMultiplier) {
      items.push({
        id: `ac-spike-${yr}-${peak.m}`,
        kind: 'card',
        severity: 'warn',
        iconKey: 'zap',
        title: `${yr}年${fmtDev(peak.m)}案均异常尖峰`,
        body: `案均 ${fmtMoney(peak.v)} 元，可能有大额赔案集中立案，建议核查报案样本。`,
        metricValue: (peak.v / mean).toFixed(1),
        metricLabel: `× 年内均值`,
      });
    }
  }

  // 同期对比（案均用百分比差异）
  if (earlyYears.length > 0 && matureYears.length > 0) {
    const latestEarly = earlyYears[earlyYears.length - 1];
    const compareM = cohorts[latestEarly]?.maxDev ?? 0;
    if (compareM >= 1) {
      const prev = [...matureYears].reverse().find(yr => (cohorts[yr]?.maxDev ?? 0) >= compareM);
      if (prev != null) {
        const acNow = getVal(cohorts, latestEarly, compareM, 'avg_claim');
        const acPrev = getVal(cohorts, prev, compareM, 'avg_claim');
        if (acNow != null && acPrev != null && acPrev > 0) {
          const pct = ((acNow - acPrev) / acPrev) * 100;
          if (Math.abs(pct) >= LOSS_RATIO_THRESHOLDS.avgClaimComparePct) {
            items.push({
              id: `ac-compare-${latestEarly}-${prev}-${compareM}`,
              kind: 'note',
              severity: 'neutral',
              iconKey: 'compare',
              title: `${fmtDev(compareM)}同期对比：${latestEarly} vs ${prev}`,
              body: `${latestEarly}年 ${fmtMoney(acNow)} 元 vs ${prev}年 ${fmtMoney(acPrev)} 元。早期发展月波动大，仅供参考。`,
              metricValue: `${sign(pct)}${fmtPct(pct)}`,
              metricLabel: `% 差异`,
            });
          }
        }
      }
    }
  }

  return items;
}

// ═══════════════════════════════════════════════════
// 同期对比 — 百分点差异指标（赔付率 / 出险率）
// ═══════════════════════════════════════════════════
function appendCompare(
  items: LossRatioInsight[],
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
  key: keyof CohortData['months'][number],
  label: string,
  unit: string,
  isPp: boolean,
): void {
  if (earlyYears.length === 0 || matureYears.length === 0) return;
  const latestEarly = earlyYears[earlyYears.length - 1];
  const compareM = cohorts[latestEarly]?.maxDev ?? 0;
  if (compareM < 1) return;
  // 选 prev cohort：要求 maxDev >= compareM（必须发展到对应窗口，否则比值无意义）
  const prev = [...matureYears].reverse().find(yr => (cohorts[yr]?.maxDev ?? 0) >= compareM);
  if (prev == null) return;
  const vNow = getVal(cohorts, latestEarly, compareM, key);
  const vPrev = getVal(cohorts, prev, compareM, key);
  if (vNow == null || vPrev == null) return;
  const delta = vNow - vPrev;
  if (Math.abs(delta) < LOSS_RATIO_THRESHOLDS.compareDeltaPp) return;
  const deltaStr = isPp
    ? `${sign(delta)}${fmtPct(delta)}pp`
    : `${sign(delta)}${fmtPct(delta)}${unit}`;
  items.push({
    id: `${String(key)}-compare-${latestEarly}-${prev}-${compareM}`,
    kind: 'note',
    severity: 'neutral',
    iconKey: 'compare',
    title: `${label}·${fmtDev(compareM)}同期对比：${latestEarly} vs ${prev}`,
    body: `${latestEarly}年 ${fmtPct(vNow)}${unit} vs ${prev}年 ${fmtPct(vPrev)}${unit}（${deltaStr}）。早期发展月波动大，仅供参考。`,
    metricValue: `${sign(delta)}${fmtPct(delta)}`,
    metricLabel: isPp ? `pp 差异` : `${unit} 差异`,
  });
}

// ═══════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════
export function deriveLossRatioInsights(
  cohorts: Record<number, CohortData>,
  activeYears: number[],
  metric: LossRatioMetric,
): LossRatioInsight[] {
  const sorted = [...activeYears].sort((a, b) => a - b);
  const matureYears = sorted.filter(
    yr => (cohorts[yr]?.maxDev ?? 0) >= LOSS_RATIO_THRESHOLDS.minDevForAlert,
  );
  const earlyYears = sorted.filter(yr => {
    const m = cohorts[yr]?.maxDev ?? 0;
    return m > 0 && m < LOSS_RATIO_THRESHOLDS.minDevForAlert;
  });

  let items: LossRatioInsight[];
  switch (metric) {
    case 'loss_ratio_pct':
      items = lossRatioInsights(cohorts, matureYears, earlyYears);
      break;
    case 'incident_rate_pct':
      items = incidentRateInsights(cohorts, matureYears, earlyYears);
      break;
    case 'avg_claim':
      items = avgClaimInsights(cohorts, matureYears, earlyYears, sorted);
      break;
  }

  // 数据不足提示（所有指标共用，作为 note）
  for (const yr of earlyYears) {
    const maxM = cohorts[yr]?.maxDev ?? 0;
    items.push({
      id: `early-${yr}`,
      kind: 'note',
      severity: 'neutral',
      iconKey: 'info',
      title: `${yr}年仅${fmtDev(maxM)}`,
      body: '早期发展月数据波动大，暂不纳入趋势评价。',
      metricValue: `M${maxM}`,
      metricLabel: `最新发展月`,
    });
  }

  // 排序：card 在前（按 severity bad → warn → good → neutral 排），note 在后
  const KIND_ORDER = { card: 0, note: 1 };
  const SEV_ORDER = { bad: 0, warn: 1, good: 2, neutral: 3 };
  return items.sort((a, b) => {
    const dk = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (dk !== 0) return dk;
    return SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
  });
}
