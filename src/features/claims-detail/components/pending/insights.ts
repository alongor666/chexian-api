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
 *   - 超过 30 天账龄占未决 ≥ 50% → 关注
 *   - 人伤金额占未决总金额 ≥ 25% → 关注（按金额比，非件数比）
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
  /** 超过 30 天账龄占未决件数 ≥ % → 关注 */
  agingMidSharePctWarn: 50,
  /** 人伤金额占未决总金额 ≥ % → 关注 */
  injurySharePctWarn: 25,
} as const;

/**
 * 已知账龄分桶白名单 — 必须严格等于后端 SQL `generatePendingAgingQuery`
 * (server/src/sql/claims-detail.ts:165) 的 CASE 输出字符串。
 *
 * ⚠️ RED LINE：字面值用半角连字符 "-"，不是波浪号 "~"。如果后端 SQL 改了
 * 分桶字面，必须同步本常量 + insights.test.ts，否则 isAgingMidBucket /
 * isAgingOverdueBucket 会全部返回 false，洞察归类全部失效（codex P2 #1）。
 */
export const AGING_BUCKETS = {
  /** 0-30 天分桶（不算逾期）*/
  fresh: '0-30天',
  /** 31-90 天分桶（关注高亮）*/
  mid: '31-90天',
  /** 91-180 天分桶 */
  long: '91-180天',
  /** 181-365 天分桶 */
  veryLong: '181-365天',
  /** 365 天+ 分桶 */
  ancient: '365天+',
} as const;

/** 全部已知分桶字面（用于识别"未知桶"）*/
const KNOWN_BUCKETS: readonly string[] = Object.values(AGING_BUCKETS);

/** 31-90 天分桶（关注高亮）*/
export function isAgingMidBucket(bucket: string | undefined): boolean {
  return bucket === AGING_BUCKETS.mid;
}

/**
 * 超过 30 天的分桶 — 用于"账龄结构需关注"占比分子。
 *
 * 严格白名单匹配：只承认 mid / long / veryLong / ancient 四个已知桶。
 * 未知字面（包括后端格式漂移产生的新桶名）→ 返回 false，宁可漏告警，
 * 也不要把所有未识别桶都误判为"逾期"，造成虚假 100% 滞留警报。
 */
export function isAgingOverdueBucket(bucket: string | undefined): boolean {
  if (bucket === undefined) return false;
  if (!KNOWN_BUCKETS.includes(bucket)) return false;
  return bucket !== AGING_BUCKETS.fresh;
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

  // 3. 人伤占比 — 严重度按"金额比"判定（与 jsdoc 阈值口径一致）。
  // 单件高额人伤 + 多件低额非人伤的场景下，件数比可能不到 25% 但金额比已超 25%，
  // 此时应该告警；反之件数 ≥ 25% 但金额 < 25% 时反而属于低额轻伤，不告警（codex P2 #3）。
  const injuryCases = pending?.injury_cases ?? 0;
  const injuryReserveShare =
    pending?.reserve_wan && pending.reserve_wan > 0
      ? ((pending.injury_reserve_wan ?? 0) / pending.reserve_wan) * 100
      : 0;
  const injurySev: Severity =
    injuryReserveShare >= THRESHOLDS.injurySharePctWarn ? 'warn' : 'good';
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
