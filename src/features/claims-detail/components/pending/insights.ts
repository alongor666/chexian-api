/**
 * 未决赔案监控 — 阈值常量、严重度判定与洞察生成器
 *
 * 阈值已与业务方对齐 (2026-05-19)：
 *   - 未决案均 ≥ 已决案均 × 4.0  → 异常（bad）
 *   - 未决案均 ≥ 已决案均 × 2.0  → 关注（warn）
 *   - 单机构案均 ≥ 全省案均 × 1.6 → 异常（bad，单机构洞察）
 *   - 单机构案均 ≥ 全省案均 × 1.2 → 关注（warn，单机构洞察）
 *   - 单机构最长滞留 > 90 天      → 异常
 *   - 单机构最长滞留 > 30 天      → 关注
 *   - 31~90 天账龄占未决 ≥ 50%   → 关注
 *   - 人伤金额占比 ≥ 25%         → 关注
 *
 * 修改阈值时务必同步更新本文件顶部注释 + changelog。
 */
import { formatCount, formatPercent } from '@/shared/utils/formatters';
import type { AgingRow, Insight, OrgRow, OverviewRow, Severity } from './types';

export const THRESHOLDS = {
  /** 全省未决案均 / 已决案均 ≥ → 异常 */
  avgReserveRatioBad: 4.0,
  /** 全省未决案均 / 已决案均 ≥ → 关注 */
  avgReserveRatioWarn: 2.0,
  /** 单机构案均 / 全省未决案均 ≥ → 异常（用于 "案均最高机构" 洞察）*/
  topOrgRatioBad: 1.6,
  /** 单机构案均 / 全省未决案均 ≥ → 关注 */
  topOrgRatioWarn: 1.2,
  /** 单机构最长滞留 > → 异常 */
  maxStayDaysBad: 90,
  /** 单机构最长滞留 > → 关注 */
  maxStayDaysWarn: 30,
  /** 31~90 天账龄占未决件数 ≥ % → 关注 */
  agingMidSharePctWarn: 50,
  /** 人伤金额占未决总金额 ≥ % → 关注 */
  injurySharePctWarn: 25,
} as const;

/**
 * 已知账龄分桶白名单（与后端 SQL `claims-detail/pending-aging.ts` 对齐）。
 * 用于精确判定"超过 30 天"而不依赖脆弱正则。
 */
export const AGING_BUCKETS = {
  /** 0-30 天分桶（不算逾期）*/
  fresh: '0~30天',
  /** 31-90 天分桶（关注高亮）*/
  mid: '31~90天',
  /** 91-180 天分桶 */
  long: '91~180天',
  /** >180 天分桶 */
  veryLong: '>180天',
} as const;

/** 31~90 天分桶（关注高亮）*/
export function isAgingMidBucket(bucket: string | undefined): boolean {
  return bucket === AGING_BUCKETS.mid;
}

/** 超过 30 天的分桶（用于 "账龄结构需关注" 占比）*/
export function isAgingOverdueBucket(bucket: string | undefined): boolean {
  return bucket !== undefined && bucket !== AGING_BUCKETS.fresh;
}

export function severityForStayDays(days: number | undefined | null): Severity {
  if (days == null) return 'neutral';
  if (days > THRESHOLDS.maxStayDaysBad) return 'bad';
  if (days > THRESHOLDS.maxStayDaysWarn) return 'warn';
  return 'good';
}

export function overallSeverityFromRatio(ratio: number): Severity {
  if (ratio >= THRESHOLDS.avgReserveRatioBad) return 'bad';
  if (ratio >= THRESHOLDS.avgReserveRatioWarn) return 'warn';
  return 'good';
}

export function deriveInsights(
  pending: OverviewRow | undefined,
  settled: OverviewRow | undefined,
  orgs: OrgRow[],
  aging: AgingRow[],
): Insight[] {
  const items: Insight[] = [];

  // 1. 案均最高机构
  const topOrg = [...orgs].sort(
    (a, b) => (b.avg_reserve ?? 0) - (a.avg_reserve ?? 0),
  )[0];
  if (topOrg && topOrg.avg_reserve) {
    const orgAvg = topOrg.avg_reserve;
    const overallAvg = pending?.avg_reserve ?? 0;
    const ratio = overallAvg > 0 ? orgAvg / overallAvg : 0;
    const sev: Severity =
      ratio >= THRESHOLDS.topOrgRatioBad
        ? 'bad'
        : ratio >= THRESHOLDS.topOrgRatioWarn
          ? 'warn'
          : 'good';
    items.push({
      id: 'top-org',
      severity: sev,
      iconKey: 'alert',
      title: `${topOrg.org ?? '—'} 机构案均偏高`,
      body: `${formatCount(topOrg.cases ?? 0)} 件未决，案均 ${formatCount(orgAvg)} 元，最长滞留 ${topOrg.max_pending_days ?? '-'} 天。`,
      metricValue: formatCount(orgAvg),
      metricLabel: '元 / 件',
    });
  }

  // 2. 账龄结构
  const totalAgingCases = aging.reduce((s, a) => s + (a.cases ?? 0), 0);
  const overdueBuckets = aging.filter(a => isAgingOverdueBucket(a.aging_bucket));
  const overdueCases = overdueBuckets.reduce((s, a) => s + (a.cases ?? 0), 0);
  const overdueSharePct =
    totalAgingCases > 0 ? (overdueCases / totalAgingCases) * 100 : 0;
  const agingSev: Severity =
    overdueSharePct >= THRESHOLDS.agingMidSharePctWarn ? 'warn' : 'good';
  items.push({
    id: 'aging-structure',
    severity: agingSev,
    iconKey: 'clock',
    title:
      overdueSharePct >= THRESHOLDS.agingMidSharePctWarn
        ? '账龄结构需关注'
        : '账龄结构良好',
    body: `${formatCount(overdueCases)} 件账龄超过 30 天，占未决 ${formatPercent(overdueSharePct)}。`,
    metricValue: formatPercent(overdueSharePct).replace('%', ''),
    metricLabel: '% 滞留',
  });

  // 3. 人伤占比
  const injuryCases = pending?.injury_cases ?? 0;
  const totalCases = pending?.cases ?? 0;
  const injurySharePct = totalCases > 0 ? (injuryCases / totalCases) * 100 : 0;
  const injuryReserveShare =
    pending?.reserve_wan && pending.reserve_wan > 0
      ? ((pending.injury_reserve_wan ?? 0) / pending.reserve_wan) * 100
      : 0;
  const injurySev: Severity =
    injurySharePct >= THRESHOLDS.injurySharePctWarn ? 'warn' : 'good';
  items.push({
    id: 'injury-share',
    severity: injurySev,
    iconKey: 'activity',
    title: '人伤占比',
    body: `${formatCount(injuryCases)} 件人伤未决，立案 ${formatCount(pending?.injury_reserve_wan ?? 0)} 万，占总立案 ${formatPercent(injuryReserveShare)}。`,
    metricValue: formatCount(pending?.injury_reserve_wan ?? 0),
    metricLabel: '万元',
  });

  // 4. 已决节奏
  const settledCases = settled?.cases ?? 0;
  const settledAvg = settled?.avg_reserve ?? 0;
  items.push({
    id: 'settled-rhythm',
    severity: 'good',
    iconKey: 'check',
    title: '已决处理节奏',
    body: `已决 ${formatCount(settledCases)} 件，案均 ${formatCount(settledAvg)} 元，处置维持正常水平。`,
    metricValue: formatCount(settledCases),
    metricLabel: '件已决',
  });

  return items;
}

/**
 * 严重度 → 设计系统色映射
 */
export function severityToColor(s: Severity) {
  switch (s) {
    case 'bad':
      return {
        text: 'text-danger',
        bg: 'bg-danger-bg',
        border: 'border-danger-border',
        ring: 'bg-danger',
      };
    case 'warn':
      return {
        text: 'text-warning',
        bg: 'bg-warning-bg',
        border: 'border-warning-border',
        ring: 'bg-warning',
      };
    case 'good':
      return {
        text: 'text-success',
        bg: 'bg-success-bg',
        border: 'border-success-border',
        ring: 'bg-success',
      };
    default:
      return {
        text: 'text-neutral-400 dark:text-neutral-500',
        bg: 'bg-neutral-50 dark:bg-surface-2',
        border: 'border-neutral-200 dark:border-subtle',
        ring: 'bg-neutral-400',
      };
  }
}
