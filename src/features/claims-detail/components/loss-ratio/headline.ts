/**
 * 赔付率发展三角形 — 叙事横幅 + 单 hero metric 派生
 *
 * 与 `insights.ts` 共享 cohort 数据源（前端 `cohorts` 聚合视图，来自同一条 SQL
 * `generateLossRatioDevelopmentQuery`）。横幅口径 = 当前最大年份 cohort 的 maxDev
 * 窗口指标，与上一可比 cohort 的同窗口比较 — 比较前严格筛选「prev.maxDev >=
 * currM」，避免拿"未发展到对应窗口"的 cohort 做比对（codex review 防御）。
 */
import { LOSS_RATIO_THRESHOLDS } from './insights';
import type {
  CohortData,
  HeadlineData,
  HeadlineHero,
  LossRatioMetric,
  Severity,
} from './types';

interface MetricMeta {
  unit: string;
  decimals: number;
  /** 横幅中向用户解释的指标名 */
  display: string;
}

const METRIC_META: Record<LossRatioMetric, MetricMeta> = {
  loss_ratio_pct: { unit: '%', decimals: 1, display: '满期赔付率' },
  incident_rate_pct: { unit: '%', decimals: 1, display: '满期出险率' },
  avg_claim: { unit: '元', decimals: 0, display: '案均立案金额' },
};

const TAG_LABEL: Record<Severity, string> = {
  bad: '异常',
  warn: '需关注',
  good: '正常',
  neutral: '暂无',
};

function fmtVal(v: number, decimals: number): string {
  return decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString();
}

function fmtDelta(delta: number, decimals: number, unit: '%' | 'pp' | '%倍'): string {
  const sign = delta > 0 ? '+' : '';
  const num = decimals > 0 ? delta.toFixed(decimals) : Math.round(delta).toLocaleString();
  return `${sign}${num}${unit}`;
}

/** 单指标值 + delta → severity */
function severityFor(
  metric: LossRatioMetric,
  currVal: number,
  delta: number | null,
  deltaPct: number | null,
): Severity {
  switch (metric) {
    case 'loss_ratio_pct':
      if (currVal > LOSS_RATIO_THRESHOLDS.lrInverted) return 'bad';
      if (currVal > LOSS_RATIO_THRESHOLDS.lrHigh) return 'bad';
      if (delta != null && delta >= LOSS_RATIO_THRESHOLDS.trendDeltaPp) return 'warn';
      if (delta != null && delta <= -LOSS_RATIO_THRESHOLDS.trendDeltaPp) return 'good';
      return 'good';

    case 'incident_rate_pct':
      if (currVal > LOSS_RATIO_THRESHOLDS.irHigh) return 'bad';
      if (currVal > LOSS_RATIO_THRESHOLDS.irModerate) return 'warn';
      if (delta != null && delta >= LOSS_RATIO_THRESHOLDS.trendDeltaPp) return 'warn';
      return 'good';

    case 'avg_claim':
      if (deltaPct != null && deltaPct >= LOSS_RATIO_THRESHOLDS.avgClaimComparePct) return 'warn';
      if (deltaPct != null && deltaPct <= -LOSS_RATIO_THRESHOLDS.avgClaimComparePct) return 'good';
      return 'neutral';
  }
}

/**
 * 推导叙事横幅 + 单 hero metric。
 *
 * 选 cohort 规则：
 *   1. currYr = activeYears 里有数据的最大年份
 *   2. prevYr = activeYears 中 yr < currYr 且 maxDev >= currM 的最大年份
 *      （保证 prev 已发展到与 curr 相同的发展月，比较口径对齐）
 *   3. 无 prev 时 hero.badge 留空，文案改为"暂无同期可比 cohort"
 *
 * 单 cohort 场景（如只勾选 2026）→ severity 仅来自绝对值阈值，delta 不参与。
 * 全部无数据 → hero=null（panel 显示骨架）。
 */
export function deriveHeadline(
  cohorts: Record<number, CohortData>,
  activeYears: number[],
  metric: LossRatioMetric,
): HeadlineData {
  const meta = METRIC_META[metric];
  const yearsWithData = activeYears
    .filter(yr => (cohorts[yr]?.maxDev ?? 0) > 0)
    .sort((a, b) => a - b);

  // 全部无数据
  if (yearsWithData.length === 0) {
    return {
      severity: 'neutral',
      tagLabel: TAG_LABEL.neutral,
      headline: '本期暂无赔付率发展数据',
      summary: '当前筛选条件下没有匹配的 cohort 数据，请调整筛选。',
      hero: null,
    };
  }

  const currYr = yearsWithData[yearsWithData.length - 1];
  const currCohort = cohorts[currYr];
  const currM = currCohort.maxDev;
  const currVal = currCohort.months[currM]?.[metric];

  if (currVal == null) {
    return {
      severity: 'neutral',
      tagLabel: TAG_LABEL.neutral,
      headline: `${currYr}年第${currM}月暂无 ${meta.display}`,
      summary: `共 ${currCohort.policyCount.toLocaleString()} 张保单 / ¥${currCohort.premiumWan.toLocaleString()} 万保费，但当前指标值缺失。`,
      hero: null,
    };
  }

  // 找可比 prev cohort（maxDev >= currM）
  const prevYr = yearsWithData
    .slice()
    .reverse()
    .find(yr => yr < currYr && (cohorts[yr]?.maxDev ?? 0) >= currM);
  const prevVal = prevYr != null ? cohorts[prevYr].months[currM]?.[metric] ?? null : null;

  let delta: number | null = null;
  let deltaPct: number | null = null;
  if (prevVal != null) {
    delta = currVal - prevVal;
    deltaPct = prevVal > 0 ? ((currVal - prevVal) / prevVal) * 100 : null;
  }

  const severity = severityFor(metric, currVal, delta, deltaPct);
  const currCoverage = currCohort.months[currM]?.coverage_pct;

  // 文案
  const valStr = fmtVal(currVal, meta.decimals);
  let headline: string;
  let badge: string | undefined;

  if (prevYr != null && prevVal != null && delta != null) {
    const worsenedFor: Record<LossRatioMetric, string> = {
      loss_ratio_pct: '恶化',
      incident_rate_pct: '走高',
      avg_claim: '上升',
    };
    const improvedFor: Record<LossRatioMetric, string> = {
      loss_ratio_pct: '改善',
      incident_rate_pct: '回落',
      avg_claim: '下降',
    };
    const dir = delta > 0 ? worsenedFor[metric] : improvedFor[metric];

    if (metric === 'avg_claim') {
      // 案均赔款必须用百分比表达涨幅 — 单位是「元」与 pp 无量纲冲突。
      // codex review #416 P2-1：prevVal=0 时（早期发展月 prev cohort 尚无赔案）
      // deltaPct=null，不能 fallback 到 pp 分支（会输出类似 "+5000.0pp" 的错误徽章）。
      // 此时省略 badge、headline 显式说明基期为零，避免误导。
      if (deltaPct != null) {
        headline = `${currYr}年第${currM}月${meta.display} ${valStr}${meta.unit}，较 ${prevYr}年同期${dir} ${fmtDelta(deltaPct, 1, '%')}`;
        badge = `${fmtDelta(deltaPct, 1, '%')} vs ${prevYr}`;
      } else {
        headline = `${currYr}年第${currM}月${meta.display} ${valStr}${meta.unit}（${prevYr}年同期基期为零，无法计算涨幅）`;
        badge = undefined;
      }
    } else {
      // loss_ratio_pct / incident_rate_pct 用百分点（pp）— 与原值同量纲，可加可减
      headline = `${currYr}年第${currM}月${meta.display} ${valStr}${meta.unit}，较 ${prevYr}年同期${dir} ${fmtDelta(Math.abs(delta), 1, 'pp')}`;
      badge = `${fmtDelta(delta, 1, 'pp')} vs ${prevYr}`;
    }
  } else {
    headline = `${currYr}年第${currM}月${meta.display} ${valStr}${meta.unit}（暂无同期可比 cohort）`;
  }

  const coverageStr =
    currCoverage != null && currCoverage < 99.9
      ? `，覆盖 ${currCoverage.toFixed(0)}% 保单`
      : '';
  const summary = `cohort 共 ${currCohort.policyCount.toLocaleString()} 张保单 / ¥${currCohort.premiumWan.toLocaleString()} 万保费${coverageStr}。`;

  const hero: HeadlineHero = {
    label: `${currYr} 第${currM}月 ${meta.display}`,
    value: valStr,
    unit: meta.unit,
    severity,
    badge,
  };

  return {
    severity,
    tagLabel: TAG_LABEL[severity],
    headline,
    summary,
    hero,
  };
}
