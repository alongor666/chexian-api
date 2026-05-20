/**
 * 地理风险热力图 — 阈值常量、严重度判定与洞察生成器
 *
 * 阈值约定（⚠️ 待业务校准 — 行业经验粗估，建议上线后用真实数据回标）：
 *   - 异地出险率 ≥ 40% → 异常（bad）
 *   - 异地出险率 ≥ 25% → 关注（warn）
 *   - Top 3 车牌归属地占总赔案 ≥ 50% → 关注（风险源头集中）
 *   - 最新季度同比频度恶化 ≥ 15% → 关注
 *   - 单省案均 / 全国案均 ≥ 1.6 → 异常（沿用 Tab 1 topOrg 套路）
 *   - 单省案均 / 全国案均 ≥ 1.2 → 关注
 *
 * 字段约束（与后端 SQL claims-detail.ts 一致）：
 *   - `province` / `city` 字面形如 "510000四川省" / "510100成都市"（adcode 前缀 + 名称）
 *   - `plate_city` 字面直接是城市名（无 adcode 前缀）
 *
 * 修改阈值时必须同步更新本文件顶部注释 + insights.test.ts 阈值边界用例。
 */
import { formatCount, formatPercent } from '@/shared/utils/formatters';
import type { Severity } from '../shared/severity';
import type {
  FrequencyYoyRow,
  GeoAccidentRow,
  GeoComparisonRow,
  GeoInsight,
  GeoPlateRow,
} from './types';

export const GEO_THRESHOLDS = {
  /** 异地出险率 ≥ % → 异常 */
  crossRegionPctBad: 40,
  /** 异地出险率 ≥ % → 关注 */
  crossRegionPctWarn: 25,
  /** Top 3 车牌归属地占总赔案 ≥ % → 关注 */
  topPlateSharePctWarn: 50,
  /** 最新季度同比频度恶化 ≥ % → 关注 */
  yoyDeterioratePctWarn: 15,
  /** 单省案均 / 全国案均 ≥ → 异常 */
  topProvinceRatioBad: 1.6,
  /** 单省案均 / 全国案均 ≥ → 关注 */
  topProvinceRatioWarn: 1.2,
} as const;

/** 异地出险率严重度（主洞察）*/
export function crossRegionSeverity(pct: number | undefined | null): Severity {
  if (pct == null || pct < 0) return 'neutral';
  if (pct >= GEO_THRESHOLDS.crossRegionPctBad) return 'bad';
  if (pct >= GEO_THRESHOLDS.crossRegionPctWarn) return 'warn';
  return 'good';
}

/** 单省案均 / 全国案均 比值严重度 */
export function topProvinceSeverity(ratio: number): Severity {
  if (ratio <= 0) return 'neutral';
  if (ratio >= GEO_THRESHOLDS.topProvinceRatioBad) return 'bad';
  if (ratio >= GEO_THRESHOLDS.topProvinceRatioWarn) return 'warn';
  return 'good';
}

/** 从 "510000四川省" 提取省份名称（去 adcode 前缀）*/
export function extractProvinceName(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/^\d+/, '');
}

/**
 * Top 3 车牌归属地集中度
 * 返回前 3 地的占比合计（按件数）+ 三个地名
 */
export function topPlateConcentration(plates: GeoPlateRow[]): {
  sharePct: number;
  topNames: string[];
  topCases: number;
  totalCases: number;
} {
  const sorted = [...plates].sort((a, b) => (b.cases ?? 0) - (a.cases ?? 0));
  const top3 = sorted.slice(0, 3);
  const topCases = top3.reduce((s, p) => s + (p.cases ?? 0), 0);
  const totalCases = plates.reduce((s, p) => s + (p.cases ?? 0), 0);
  const sharePct = totalCases > 0 ? (topCases / totalCases) * 100 : 0;
  const topNames = top3.map(p => p.plate_city ?? '').filter(Boolean);
  return { sharePct, topNames, topCases, totalCases };
}

/**
 * 最新季度同比频度恶化幅度
 * yoyRows 已按 (year, quarter) 升序排列；需要找最新季度的同季度上一年对比
 * 返回值 > 0 表示恶化（频度上升），< 0 表示改善
 */
export function frequencyYoyDeterioration(yoyRows: FrequencyYoyRow[]): {
  latestFreq: number;
  yoyPct: number;
  latestQuarterLabel: string;
} | null {
  if (yoyRows.length < 2) return null;
  // 最新季度 = 最后一行
  const latest = yoyRows[yoyRows.length - 1];
  if (latest.year == null || latest.quarter == null) return null;
  // 找上一年同季度
  const prevYearSameQuarter = yoyRows.find(
    r => r.year === latest.year! - 1 && r.quarter === latest.quarter,
  );
  if (!prevYearSameQuarter) return null;
  const prev = prevYearSameQuarter.freq_per_1000 ?? 0;
  const curr = latest.freq_per_1000 ?? 0;
  if (prev <= 0) return null;
  const yoyPct = ((curr - prev) / prev) * 100;
  return {
    latestFreq: curr,
    yoyPct,
    latestQuarterLabel: `${latest.year}Q${latest.quarter}`,
  };
}

/**
 * 按省份聚合 geoAccident，找案均最高的省 + 与全国均值比值。
 *
 * 关键设计（修 codex review #411）：
 *
 *   P1 (单侧赔案场景)：不再依赖 GeoComparisonRow.cross_region_avg_reserve /
 *      local_avg_reserve 算全国均值 — 单侧（全本地或全异地）那一侧的 AVG 为 NULL，
 *      会让"案均最高省份"误降级。改为从 accidents 自身一次扫描算全国均值，
 *      与省级聚合同源，永远自洽。
 *
 *   P2 (量化误差)：用 `avg_reserve * cases`（保精度的城市级原始数据）累加，
 *      而非 `reserve_wan * 10000`。后者在 SQL 中已四舍五入到整数万，低额城市
 *      可能被量化为 0，导致省级案均系统性低估。
 */
export function topProvinceAvgClaim(accidents: GeoAccidentRow[]): {
  provinceName: string;
  provinceAvg: number;
  ratio: number;
  cases: number;
  overallAvg: number;
} | null {
  if (accidents.length === 0) return null;

  // 同一次扫描：累加省级聚合 + 全国总和
  const agg = new Map<string, { cases: number; totalReserve: number }>();
  let nationalCases = 0;
  let nationalReserve = 0;
  for (const r of accidents) {
    const name = extractProvinceName(r.province);
    const cases = r.cases ?? 0;
    // 用 avg_reserve（保精度的元）× cases 算城市原始总金额；
    // fallback 到 reserve_wan * 10000（量化的万元）兼容旧 fixtures，但生产数据应总有 avg_reserve
    const cityReserve =
      r.avg_reserve != null
        ? r.avg_reserve * cases
        : (r.reserve_wan ?? 0) * 10000;

    nationalCases += cases;
    nationalReserve += cityReserve;

    if (!name) continue;
    const prev = agg.get(name) ?? { cases: 0, totalReserve: 0 };
    prev.cases += cases;
    prev.totalReserve += cityReserve;
    agg.set(name, prev);
  }

  if (nationalCases <= 0) return null;
  const overallAvg = nationalReserve / nationalCases;
  if (overallAvg <= 0) return null;

  // 找案均最高省份（必须有件数 > 0）
  let best: { name: string; avg: number; cases: number } | null = null;
  for (const [name, v] of agg.entries()) {
    if (v.cases <= 0) continue;
    const avg = v.totalReserve / v.cases;
    if (best === null || avg > best.avg) {
      best = { name, avg, cases: v.cases };
    }
  }
  if (!best) return null;

  return {
    provinceName: best.name,
    provinceAvg: best.avg,
    ratio: best.avg / overallAvg,
    cases: best.cases,
    overallAvg,
  };
}

/**
 * 生成 4 张地理洞察卡（卡片始终是 4 张，保持 grid 视觉稳定）。
 *
 * 顺序：
 *   1. 异地出险率（主洞察 — 用户决策的核心信号）
 *   2. 风险源头集中度
 *   3. 季度同比频度恶化
 *   4. 案均最高省份
 *
 * 数据缺失时返回 neutral severity + 降级文案，不抛错。
 */
export function deriveGeoInsights(
  comparison: GeoComparisonRow | undefined | null,
  plates: GeoPlateRow[],
  yoyRows: FrequencyYoyRow[],
  accidents: GeoAccidentRow[],
): GeoInsight[] {
  const items: GeoInsight[] = [];

  // 1. 异地出险率（主洞察）
  const crossPct = comparison?.cross_region_pct ?? null;
  const crossCases = comparison?.cross_region_cases ?? 0;
  const totalCases = comparison?.total_cases ?? 0;
  const crossSev = crossRegionSeverity(crossPct);
  items.push({
    id: 'cross-region',
    severity: crossSev,
    iconKey: 'alert',
    title:
      crossSev === 'bad'
        ? '异地出险率显著偏高'
        : crossSev === 'warn'
          ? '异地出险率偏高'
          : crossSev === 'good'
            ? '异地出险率正常'
            : '异地出险率暂无数据',
    body:
      crossPct == null
        ? '本期暂无对比数据。'
        : `${formatCount(crossCases)} 件异地出险，占总赔案 ${formatPercent(crossPct)}（共 ${formatCount(totalCases)} 件）。`,
    metricValue: crossPct == null ? '—' : formatPercent(crossPct).replace('%', ''),
    metricLabel: '% 异地',
  });

  // 2. 风险源头集中度
  const concentration = topPlateConcentration(plates);
  const concentrationSev: Severity =
    plates.length === 0
      ? 'neutral'
      : concentration.sharePct >= GEO_THRESHOLDS.topPlateSharePctWarn
        ? 'warn'
        : 'good';
  items.push({
    id: 'plate-concentration',
    severity: concentrationSev,
    iconKey: 'pin',
    title:
      concentrationSev === 'warn'
        ? '风险源头集中度高'
        : concentrationSev === 'good'
          ? '风险源头分散'
          : '风险源头暂无数据',
    body:
      plates.length === 0
        ? '本期暂无车牌归属地数据。'
        : `前 3 车牌归属地（${concentration.topNames.join(' / ')}）共 ${formatCount(concentration.topCases)} 件，占总赔案 ${formatPercent(concentration.sharePct)}。`,
    metricValue: formatPercent(concentration.sharePct).replace('%', ''),
    metricLabel: '% Top 3 占比',
  });

  // 3. 季度同比频度恶化
  const yoy = frequencyYoyDeterioration(yoyRows);
  const yoySev: Severity =
    yoy == null
      ? 'neutral'
      : yoy.yoyPct >= GEO_THRESHOLDS.yoyDeterioratePctWarn
        ? 'warn'
        : yoy.yoyPct <= -GEO_THRESHOLDS.yoyDeterioratePctWarn
          ? 'good'
          : 'good';
  items.push({
    id: 'frequency-trend',
    severity: yoySev,
    iconKey: 'trend',
    title:
      yoy == null
        ? '同比数据不足'
        : yoy.yoyPct >= GEO_THRESHOLDS.yoyDeterioratePctWarn
          ? '出险频度同比恶化'
          : yoy.yoyPct <= -GEO_THRESHOLDS.yoyDeterioratePctWarn
            ? '出险频度同比改善'
            : '出险频度同比平稳',
    body:
      yoy == null
        ? '至少需要两年同季度数据，当前不足。'
        : `${yoy.latestQuarterLabel} 出险频度 ${yoy.latestFreq.toFixed(2)}‰，同比 ${yoy.yoyPct >= 0 ? '+' : ''}${yoy.yoyPct.toFixed(1)}%。`,
    metricValue: yoy == null ? '—' : `${yoy.yoyPct >= 0 ? '+' : ''}${yoy.yoyPct.toFixed(1)}`,
    metricLabel: '% 同比',
  });

  // 4. 案均最高省份 — 全国均值从 accidents 自身算，不再依赖 comparison.avg_*
  // 解决 codex P1：单侧赔案场景（cross 或 local 一侧为 NULL）下也能正确判定
  const topProv = topProvinceAvgClaim(accidents);
  const topProvSev = topProv ? topProvinceSeverity(topProv.ratio) : 'neutral';
  items.push({
    id: 'top-province',
    severity: topProvSev,
    iconKey: 'building',
    title: topProv ? `${topProv.provinceName} 案均偏高` : '案均最高省份暂无数据',
    body:
      topProv == null
        ? '本期暂无省级出险数据。'
        : `${topProv.provinceName} ${formatCount(topProv.cases)} 件赔案，案均 ${formatCount(topProv.provinceAvg)} 元，是全国均值的 ${topProv.ratio.toFixed(2)} 倍。`,
    metricValue: topProv == null ? '—' : formatCount(topProv.provinceAvg),
    metricLabel: '元 / 件',
  });

  return items;
}
