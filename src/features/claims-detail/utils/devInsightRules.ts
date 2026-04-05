/**
 * 赔付率发展三角形 — 规则驱动洞察引擎 v3
 *
 * 按当前选中指标（赔付率/出险率/案均）生成对应洞察，
 * 切换指标时文字跟随变化。
 */

export interface DevInsightItem {
  icon: string;
  type: 'warning' | 'danger' | 'trend' | 'anomaly' | 'compare' | 'info';
  title: string;
  description: string;
}

export type MetricKey = 'loss_ratio_pct' | 'incident_rate_pct' | 'avg_claim';

interface CohortData {
  policyCount: number;
  premiumWan: number;
  maxDev: number;
  months: Record<number, Record<string, any>>;
}

/** 阈值配置 */
const TH = {
  lrInverted: 100,
  lrHigh: 70,
  irHigh: 70,
  irModerate: 50,
  trendDeltaPp: 15,
  anomalyMultiplier: 3,
  compareDeltaPp: 15,
  avgClaimGrowthPct: 40,
  avgClaimComparePct: 30,
  minDevForAlert: 6,
};

const TYPE_ORDER: Record<DevInsightItem['type'], number> = {
  warning: 0, danger: 1, trend: 2, anomaly: 3, compare: 4, info: 5,
};

const getVal = (
  cohorts: Record<number, CohortData>, yr: number, m: number, key: string,
): number | null => {
  const v = cohorts[yr]?.months[m]?.[key];
  return v != null ? Number(v) : null;
};

const getLatestVal = (
  cohorts: Record<number, CohortData>, yr: number, key: string,
): number | null => {
  const maxM = cohorts[yr]?.maxDev ?? 0;
  return maxM > 0 ? getVal(cohorts, yr, maxM, key) : null;
};

const fmtPct = (v: number): string => v.toFixed(1);
const fmtMoney = (v: number): string => Math.round(v).toLocaleString();
const sign = (v: number): string => (v > 0 ? '+' : '');
/** 发展月中文：第N月 */
const fmtDev = (m: number): string => `第${m}月`;

// ─── 赔付率洞察 ───
function lossRatioInsights(
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
): DevInsightItem[] {
  const items: DevInsightItem[] = [];

  // 阈值告警（合并同类项）
  if (matureYears.length > 0) {
    const inverted: { yr: number; v: number }[] = [];
    const high: { yr: number; v: number }[] = [];
    for (const yr of matureYears) {
      const lr = getLatestVal(cohorts, yr, 'loss_ratio_pct');
      if (lr == null) continue;
      if (lr > TH.lrInverted) inverted.push({ yr, v: lr });
      else if (lr > TH.lrHigh) high.push({ yr, v: lr });
    }
    if (inverted.length > 0) {
      const detail = inverted.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        icon: '⚠️', type: 'warning',
        title: inverted.length === 1 ? `${inverted[0].yr}年赔付率倒挂` : `连续${inverted.length}年赔付率倒挂`,
        description: `${detail}，均超过100%，承保亏损严重。`,
      });
    }
    if (high.length > 0) {
      const detail = high.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        icon: '🔴', type: 'danger',
        title: '赔付率偏高',
        description: `${detail}，超过 ${TH.lrHigh}% 警戒线。`,
      });
    }
  }

  // 趋势
  if (matureYears.length >= 2) {
    const first = matureYears[0], last = matureYears[matureYears.length - 1];
    const lrF = getLatestVal(cohorts, first, 'loss_ratio_pct');
    const lrL = getLatestVal(cohorts, last, 'loss_ratio_pct');
    if (lrF != null && lrL != null) {
      const delta = lrL - lrF;
      const span = last - first;
      if (Math.abs(delta) >= TH.trendDeltaPp) {
        const dir = delta > 0 ? '持续恶化' : '持续改善';
        items.push({
          icon: delta > 0 ? '📈' : '📉', type: 'trend',
          title: `赔付率${dir}`,
          description: `${first}→${last}年：${fmtPct(lrF)}%→${fmtPct(lrL)}%（${sign(delta)}${fmtPct(delta)}pp），年均${sign(delta / span)}${fmtPct(delta / span)}pp。`,
        });
      } else if (lrF > TH.lrHigh && lrL > TH.lrHigh) {
        const allVals = matureYears.map(yr => getLatestVal(cohorts, yr, 'loss_ratio_pct')).filter((v): v is number => v != null);
        items.push({
          icon: '⚠️', type: 'trend',
          title: '赔付率高位震荡',
          description: `${first}→${last}年赔付率在 ${fmtPct(Math.min(...allVals))}%~${fmtPct(Math.max(...allVals))}% 区间波动，未见改善趋势。`,
        });
      }
    }
  }

  // 同期对比
  appendCompare(items, cohorts, matureYears, earlyYears, 'loss_ratio_pct', '赔付率', '%', true);

  return items;
}

// ─── 出险率洞察 ───
function incidentRateInsights(
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
): DevInsightItem[] {
  const items: DevInsightItem[] = [];

  // 阈值告警
  if (matureYears.length > 0) {
    const high: { yr: number; v: number }[] = [];
    const moderate: { yr: number; v: number }[] = [];
    for (const yr of matureYears) {
      const ir = getLatestVal(cohorts, yr, 'incident_rate_pct');
      if (ir == null) continue;
      if (ir > TH.irHigh) high.push({ yr, v: ir });
      else if (ir > TH.irModerate) moderate.push({ yr, v: ir });
    }
    if (high.length > 0) {
      const detail = high.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        icon: '🔴', type: 'danger',
        title: '出险率超红线',
        description: `${detail}，远超 ${TH.irHigh}% 警戒线，风险敞口大。`,
      });
    }
    if (moderate.length > 0) {
      const detail = moderate.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        icon: '⚠️', type: 'warning',
        title: '出险率偏高',
        description: `${detail}，超过 ${TH.irModerate}% 关注线。`,
      });
    }
  }

  // 趋势
  if (matureYears.length >= 2) {
    const first = matureYears[0], last = matureYears[matureYears.length - 1];
    const irF = getLatestVal(cohorts, first, 'incident_rate_pct');
    const irL = getLatestVal(cohorts, last, 'incident_rate_pct');
    if (irF != null && irL != null) {
      const delta = irL - irF;
      if (Math.abs(delta) >= TH.trendDeltaPp) {
        items.push({
          icon: delta > 0 ? '📈' : '📉', type: 'trend',
          title: `出险率${delta > 0 ? '持续走高' : '持续回落'}`,
          description: `${first}→${last}年：${fmtPct(irF)}%→${fmtPct(irL)}%（${sign(delta)}${fmtPct(delta)}pp）。`,
        });
      } else if (irF > TH.irModerate && irL > TH.irModerate) {
        const allVals = matureYears.map(yr => getLatestVal(cohorts, yr, 'incident_rate_pct')).filter((v): v is number => v != null);
        items.push({
          icon: '⚠️', type: 'trend',
          title: '出险率高位震荡',
          description: `${first}→${last}年出险率在 ${fmtPct(Math.min(...allVals))}%~${fmtPct(Math.max(...allVals))}% 区间波动，未见改善。`,
        });
      }
    }
  }

  // 同期对比
  appendCompare(items, cohorts, matureYears, earlyYears, 'incident_rate_pct', '出险率', '%', true);

  return items;
}

// ─── 案均赔款洞察 ───
function avgClaimInsights(
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
  sorted: number[],
): DevInsightItem[] {
  const items: DevInsightItem[] = [];

  // 趋势
  if (matureYears.length >= 2) {
    const first = matureYears[0], last = matureYears[matureYears.length - 1];
    const acF = getLatestVal(cohorts, first, 'avg_claim');
    const acL = getLatestVal(cohorts, last, 'avg_claim');
    if (acF != null && acL != null && acF > 0) {
      const growthPct = ((acL - acF) / acF) * 100;
      if (Math.abs(growthPct) >= TH.avgClaimGrowthPct) {
        items.push({
          icon: growthPct > 0 ? '🔴' : '🟢', type: 'trend',
          title: `案均赔款${growthPct > 0 ? '逐年攀升' : '逐年下降'}`,
          description: `${first}→${last}年：${fmtMoney(acF)}→${fmtMoney(acL)}元（${sign(growthPct)}${fmtPct(growthPct)}%），${growthPct > 0 ? '大额案件占比可能上升' : '理赔管控见效'}。`,
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
    if (mean > 0 && peak.v > mean * TH.anomalyMultiplier) {
      items.push({
        icon: '⚡', type: 'anomaly',
        title: `${yr}年${fmtDev(peak.m)}案均异常尖峰`,
        description: `案均 ${fmtMoney(peak.v)} 元，是该年均值（${fmtMoney(mean)}元）的 ${(peak.v / mean).toFixed(1)} 倍，可能有大额赔案集中立案。`,
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
          if (Math.abs(pct) >= TH.avgClaimComparePct) {
            items.push({
              icon: '📊', type: 'compare',
              title: `${fmtDev(compareM)}同期对比：${latestEarly} vs ${prev}`,
              description: `${latestEarly}年${fmtDev(compareM)}案均 ${fmtMoney(acNow)} 元，${prev}年同期 ${fmtMoney(acPrev)} 元（${sign(pct)}${fmtPct(pct)}%）。早期发展月波动大，仅供参考。`,
            });
          }
        }
      }
    }
  }

  return items;
}

// ─── 公共：同期对比（百分点差异指标）───
function appendCompare(
  items: DevInsightItem[],
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
  key: string,
  label: string,
  unit: string,
  isPp: boolean,
): void {
  if (earlyYears.length === 0 || matureYears.length === 0) return;
  const latestEarly = earlyYears[earlyYears.length - 1];
  const compareM = cohorts[latestEarly]?.maxDev ?? 0;
  if (compareM < 1) return;
  const prev = [...matureYears].reverse().find(yr => (cohorts[yr]?.maxDev ?? 0) >= compareM);
  if (prev == null) return;
  const vNow = getVal(cohorts, latestEarly, compareM, key);
  const vPrev = getVal(cohorts, prev, compareM, key);
  if (vNow == null || vPrev == null) return;
  const delta = vNow - vPrev;
  if (Math.abs(delta) < TH.compareDeltaPp) return;
  const deltaStr = isPp ? `${sign(delta)}${fmtPct(delta)}pp` : `${sign(delta)}${fmtPct(delta)}${unit}`;
  items.push({
    icon: '📊', type: 'compare',
    title: `${fmtDev(compareM)}同期对比：${latestEarly} vs ${prev}`,
    description: `${latestEarly}年${fmtDev(compareM)}${label} ${fmtPct(vNow)}${unit}，${prev}年同期 ${fmtPct(vPrev)}${unit}（${deltaStr}）。早期发展月波动大，仅供参考。`,
  });
}

// ─── 主入口 ───
export function generateDevInsights(
  cohorts: Record<number, CohortData>,
  activeYears: number[],
  metric: MetricKey,
): DevInsightItem[] {
  const sorted = [...activeYears].sort((a, b) => a - b);
  const matureYears = sorted.filter(yr => (cohorts[yr]?.maxDev ?? 0) >= TH.minDevForAlert);
  const earlyYears = sorted.filter(yr => {
    const m = cohorts[yr]?.maxDev ?? 0;
    return m > 0 && m < TH.minDevForAlert;
  });

  let items: DevInsightItem[];
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

  // 数据不足提示（所有指标共用）
  for (const yr of earlyYears) {
    const maxM = cohorts[yr]?.maxDev ?? 0;
    items.push({
      icon: 'ℹ️', type: 'info',
      title: `${yr}年仅${fmtDev(maxM)}`,
      description: '早期发展月数据波动大，暂不纳入趋势评价。',
    });
  }

  return items.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
}
