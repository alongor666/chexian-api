/**
 * 费用率发展 — 规则驱动洞察引擎
 *
 * 按当前选中指标（费用率/件均费用/费用金额）生成对应洞察。
 */

export interface DevInsightItem {
  icon: string;
  type: 'warning' | 'danger' | 'trend' | 'compare' | 'info';
  title: string;
  description: string;
}

export type ExpenseMetricKey = 'expense_ratio_pct' | 'avg_fee_per_policy_yuan' | 'dev_fee_wan';

interface CohortData {
  policyCount: number;
  premiumWan: number;
  maxDev: number;
  months: Record<number, Record<string, any>>;
}

const TH = {
  erHigh: 20,
  erModerate: 16,
  trendDeltaPp: 3,
  compareDeltaPp: 5,
  avgFeeGrowthPct: 30,
  avgFeeComparePct: 20,
  minDevForAlert: 6,
};

const TYPE_ORDER: Record<DevInsightItem['type'], number> = {
  warning: 0, danger: 1, trend: 2, compare: 3, info: 4,
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
const fmtDev = (m: number): string => `第${m}月`;

// ─── 费用率洞察 ───
function expenseRatioInsights(
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
      const er = getLatestVal(cohorts, yr, 'expense_ratio_pct');
      if (er == null) continue;
      if (er > TH.erHigh) high.push({ yr, v: er });
      else if (er > TH.erModerate) moderate.push({ yr, v: er });
    }
    if (high.length > 0) {
      const detail = high.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        icon: '🔴', type: 'danger',
        title: '费用率偏高',
        description: `${detail}，超过 ${TH.erHigh}% 警戒线。`,
      });
    }
    if (moderate.length > 0) {
      const detail = moderate.map(x => `${x.yr}年 ${fmtPct(x.v)}%`).join('、');
      items.push({
        icon: '⚠️', type: 'warning',
        title: '费用率关注',
        description: `${detail}，超过 ${TH.erModerate}% 关注线。`,
      });
    }
  }

  // 趋势
  if (matureYears.length >= 2) {
    const first = matureYears[0], last = matureYears[matureYears.length - 1];
    const erF = getLatestVal(cohorts, first, 'expense_ratio_pct');
    const erL = getLatestVal(cohorts, last, 'expense_ratio_pct');
    if (erF != null && erL != null) {
      const delta = erL - erF;
      if (Math.abs(delta) >= TH.trendDeltaPp) {
        const dir = delta > 0 ? '持续走高' : '持续下降';
        items.push({
          icon: delta > 0 ? '📈' : '📉', type: 'trend',
          title: `费用率${dir}`,
          description: `${first}→${last}年：${fmtPct(erF)}%→${fmtPct(erL)}%（${sign(delta)}${fmtPct(delta)}pp）。`,
        });
      }
    }
  }

  // 同期对比
  appendCompare(items, cohorts, matureYears, earlyYears, 'expense_ratio_pct', '费用率', '%');

  return items;
}

// ─── 件均费用洞察 ───
function avgFeeInsights(
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
): DevInsightItem[] {
  const items: DevInsightItem[] = [];

  if (matureYears.length >= 2) {
    const first = matureYears[0], last = matureYears[matureYears.length - 1];
    const afF = getLatestVal(cohorts, first, 'avg_fee_per_policy_yuan');
    const afL = getLatestVal(cohorts, last, 'avg_fee_per_policy_yuan');
    if (afF != null && afL != null && afF > 0) {
      const growthPct = ((afL - afF) / afF) * 100;
      if (Math.abs(growthPct) >= TH.avgFeeGrowthPct) {
        items.push({
          icon: growthPct > 0 ? '📈' : '📉', type: 'trend',
          title: `件均费用${growthPct > 0 ? '逐年攀升' : '逐年下降'}`,
          description: `${first}→${last}年：${fmtMoney(afF)}→${fmtMoney(afL)}元（${sign(growthPct)}${fmtPct(growthPct)}%）。`,
        });
      }
    }
  }

  // 同期对比
  if (earlyYears.length > 0 && matureYears.length > 0) {
    const latestEarly = earlyYears[earlyYears.length - 1];
    const compareM = cohorts[latestEarly]?.maxDev ?? 0;
    if (compareM >= 1) {
      const prev = [...matureYears].reverse().find(yr => (cohorts[yr]?.maxDev ?? 0) >= compareM);
      if (prev != null) {
        const afNow = getVal(cohorts, latestEarly, compareM, 'avg_fee_per_policy_yuan');
        const afPrev = getVal(cohorts, prev, compareM, 'avg_fee_per_policy_yuan');
        if (afNow != null && afPrev != null && afPrev > 0) {
          const pct = ((afNow - afPrev) / afPrev) * 100;
          if (Math.abs(pct) >= TH.avgFeeComparePct) {
            items.push({
              icon: '📊', type: 'compare',
              title: `${fmtDev(compareM)}同期对比：${latestEarly} vs ${prev}`,
              description: `${latestEarly}年${fmtDev(compareM)}件均费用 ${fmtMoney(afNow)} 元，${prev}年同期 ${fmtMoney(afPrev)} 元（${sign(pct)}${fmtPct(pct)}%）。`,
            });
          }
        }
      }
    }
  }

  return items;
}

// ─── 费用金额洞察 ───
function feeAmountInsights(
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
): DevInsightItem[] {
  const items: DevInsightItem[] = [];

  if (matureYears.length >= 2) {
    const first = matureYears[0], last = matureYears[matureYears.length - 1];
    const faF = getLatestVal(cohorts, first, 'dev_fee_wan');
    const faL = getLatestVal(cohorts, last, 'dev_fee_wan');
    if (faF != null && faL != null && faF > 0) {
      const growthPct = ((faL - faF) / faF) * 100;
      if (Math.abs(growthPct) >= 20) {
        items.push({
          icon: growthPct > 0 ? '📈' : '📉', type: 'trend',
          title: `费用总额${growthPct > 0 ? '持续增长' : '持续下降'}`,
          description: `${first}→${last}年：${fmtPct(faF)}→${fmtPct(faL)}万元（${sign(growthPct)}${fmtPct(growthPct)}%）。`,
        });
      }
    }
  }

  // 同期对比
  appendCompare(items, cohorts, matureYears, earlyYears, 'dev_fee_wan', '费用金额', '万元');

  return items;
}

// ─── 公共：同期对比 ───
function appendCompare(
  items: DevInsightItem[],
  cohorts: Record<number, CohortData>,
  matureYears: number[],
  earlyYears: number[],
  key: string,
  label: string,
  unit: string,
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
  items.push({
    icon: '📊', type: 'compare',
    title: `${fmtDev(compareM)}同期对比：${latestEarly} vs ${prev}`,
    description: `${latestEarly}年${fmtDev(compareM)}${label} ${fmtPct(vNow)}${unit}，${prev}年同期 ${fmtPct(vPrev)}${unit}（${sign(delta)}${fmtPct(delta)}）。早期发展月波动大，仅供参考。`,
  });
}

// ─── 主入口 ───
export function generateExpenseDevInsights(
  cohorts: Record<number, CohortData>,
  activeYears: number[],
  metric: ExpenseMetricKey,
): DevInsightItem[] {
  const sorted = [...activeYears].sort((a, b) => a - b);
  const matureYears = sorted.filter(yr => (cohorts[yr]?.maxDev ?? 0) >= TH.minDevForAlert);
  const earlyYears = sorted.filter(yr => {
    const m = cohorts[yr]?.maxDev ?? 0;
    return m > 0 && m < TH.minDevForAlert;
  });

  let items: DevInsightItem[];
  switch (metric) {
    case 'expense_ratio_pct':
      items = expenseRatioInsights(cohorts, matureYears, earlyYears);
      break;
    case 'avg_fee_per_policy_yuan':
      items = avgFeeInsights(cohorts, matureYears, earlyYears);
      break;
    case 'dev_fee_wan':
      items = feeAmountInsights(cohorts, matureYears, earlyYears);
      break;
  }

  // 数据不足提示
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
