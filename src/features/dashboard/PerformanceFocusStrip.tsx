/**
 * 今日焦点条（PerformanceFocusStrip）
 *
 * 异常优先的 4 块速览，让分公司经理 3 秒内看懂"今天该重点关注谁、关注什么"。
 *
 * 数据来源：复用 `usePerformanceBundle` 与 PerformanceAnalysisPanel 同源（React Query
 * queryKey 命中，仅触发 1 次 HTTP 请求）。从 bundle 中解析 4 个语义信号：
 *   1. 整体达成进度 — 优先取 bundle.drilldown.summary（含真实 plan_premium /
 *      achievement_rate）；后端 SQL summary.ts:151 写死了 summary.rows 的
 *      plan_premium=NULL / achievement_rate=NULL，不能从 summary.rows 取整体达成。
 *      drilldown.summary 不可用时回落到 summary 整体行的环比。
 *   2. 异常险别组合 — summary.rows 非整体行按 growth_rate 找最差（同理 achievement_rate 全 NULL）
 *   3. 落后下钻维度（drilldown.rows 中 achievement_rate 最低，机构/业务员视维度而定）
 *   4. 掉队业务员（topSalesman.rows 已按 ach 升序，取首位）
 *
 * Bundle 开关：与 PerformanceAnalysisPanel / PremiumDashboard / useCrossSellAnalysis
 * 统一遵守 ENABLE_BUNDLE_ROUTES（VITE_ENABLE_BUNDLE_ROUTES）。开关关闭时本组件不渲染，
 * 避免在 legacy 模式 503。
 *
 * 来源：Claude Design 视觉重做 2026-06-03（design-handoff/performance-analysis-20260603）。
 */
import React, { useMemo } from 'react';
import { usePerformanceBundle } from './hooks/usePerformanceBundle';
import type {
  PerformanceGrowthMode,
  PerformanceSegmentTag,
  PerformanceSummaryExpandDims,
  PerformanceTimePeriod,
} from './hooks/usePerformanceSummary';
import type { AdvancedFilterState } from '@/shared/types/data';
import { ENABLE_BUNDLE_ROUTES } from '@/shared/api/client';
import {
  cardStyles,
  colorClasses,
  fontStyles,
  numericStyles,
  cn,
} from '@/shared/styles';
import {
  formatPercent,
  formatPremiumWan,
  formatSalesmanName,
} from '@/shared/utils/formatters';

interface PerformanceFocusStripProps {
  filters: AdvancedFilterState;
  segmentTag: PerformanceSegmentTag;
  timePeriod: PerformanceTimePeriod;
  growthMode: PerformanceGrowthMode;
  expandDims: PerformanceSummaryExpandDims;
}

interface FocusTile {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  tone: string; // text color class
  dot: string; // 1.5x1.5 dot bg class
}

/**
 * 根据达成率给出语义色（同 acceptance §D8 阈值，与 DESIGN.md 11.4 业务阈值一致）
 * - <60: danger
 * - 60~80: warning
 * - 80~99: warning-dark（接近达标）
 * - ≥99: neutral（无异常 → 主文本色）
 */
function achTone(ach: number | null | undefined): { text: string; dot: string } {
  if (ach == null) return { text: colorClasses.text.neutral, dot: 'bg-neutral-400' };
  if (ach >= 99) return { text: colorClasses.text.neutralBlack, dot: 'bg-success' };
  if (ach >= 80) return { text: colorClasses.text.warningDark, dot: 'bg-warning' };
  if (ach >= 60) return { text: colorClasses.text.warning, dot: 'bg-warning' };
  return { text: colorClasses.text.danger, dot: 'bg-danger' };
}

/**
 * 取整体口径（达成率 / 环比 / 缺口）。
 *
 * 优先级：
 *   1. `bundle.drilldown.summary` — 后端 SQL drilldown.ts 显式计算 plan_premium /
 *      achievement_rate，是整体达成的唯一数据源。
 *   2. `bundle.summary.rows` 中 row_label='整体' 的环比 — 仅作为 drilldown.summary
 *      不可用时的回落（后端 summary.ts:151 写死 plan_premium=NULL，achievement_rate
 *      永远拿不到）。
 */
function extractOverall(
  drilldownSummary: Record<string, unknown> | null | undefined,
  summaryRows: Array<Record<string, unknown>>
): {
  ach: number | null;
  mom: number | null;
  gap: number;
} | null {
  // 优先：drilldown.summary（含真实 plan_premium / achievement_rate）
  if (drilldownSummary) {
    const ach =
      drilldownSummary.achievement_rate == null
        ? null
        : Number(drilldownSummary.achievement_rate);
    const mom =
      drilldownSummary.growth_rate == null
        ? null
        : Number(drilldownSummary.growth_rate);
    const premium = Number(drilldownSummary.premium ?? 0);
    const plan =
      drilldownSummary.plan_premium == null
        ? null
        : Number(drilldownSummary.plan_premium);
    const gap = plan != null && plan > premium ? plan - premium : 0;
    if (ach != null || mom != null) {
      return { ach, mom, gap };
    }
  }
  // 回落：summary.rows 整体行（仅 growth_rate 可用）
  const overall =
    summaryRows.find((r) => String(r.row_label ?? '') === '整体') ??
    summaryRows.find((r) => String(r.coverage_combination ?? '') === '整体');
  if (!overall) return null;
  const ach = overall.achievement_rate == null ? null : Number(overall.achievement_rate);
  const mom = overall.growth_rate == null ? null : Number(overall.growth_rate);
  const premium = Number(overall.premium ?? 0);
  const plan = overall.plan_premium == null ? null : Number(overall.plan_premium);
  const gap = plan != null && plan > premium ? plan - premium : 0;
  return { ach, mom, gap };
}

/**
 * 找"最弱险别组合"（排除"整体"行）。
 *
 * 优先按 achievement_rate 升序找最差；当 achievement_rate 全为 null（未配置计划），
 * 回落按 growth_rate 升序找环比下跌最多的（最负=最异常）。两者都缺则返回 null。
 */
function extractWeakestCoverage(rows: Array<Record<string, unknown>>): {
  name: string;
  ach: number | null;
  mom: number | null;
  gap: number;
} | null {
  const nonOverall = rows.filter(
    (r) =>
      String(r.row_label ?? '') !== '整体' &&
      String(r.coverage_combination ?? '') !== '整体'
  );
  // 优先：achievement_rate 可比较时按 ach 升序
  const withAch = nonOverall
    .filter((r) => r.achievement_rate != null)
    .map((r) => ({
      name: String(r.row_label ?? r.coverage_combination ?? ''),
      ach: Number(r.achievement_rate),
      mom: r.growth_rate == null ? null : Number(r.growth_rate),
      premium: Number(r.premium ?? 0),
      plan: r.plan_premium == null ? null : Number(r.plan_premium),
    }))
    .filter((r) => r.name);
  if (withAch.length > 0) {
    withAch.sort((a, b) => a.ach - b.ach);
    const w = withAch[0];
    return {
      name: w.name,
      ach: w.ach,
      mom: w.mom,
      gap: w.plan != null && w.plan > w.premium ? w.plan - w.premium : 0,
    };
  }
  // 回落：按 growth_rate 升序（最负=最差）
  const withMom = nonOverall
    .filter((r) => r.growth_rate != null)
    .map((r) => ({
      name: String(r.row_label ?? r.coverage_combination ?? ''),
      mom: Number(r.growth_rate),
      premium: Number(r.premium ?? 0),
      plan: r.plan_premium == null ? null : Number(r.plan_premium),
    }))
    .filter((r) => r.name);
  if (withMom.length === 0) return null;
  withMom.sort((a, b) => a.mom - b.mom);
  const w = withMom[0];
  return {
    name: w.name,
    ach: null,
    mom: w.mom,
    gap: w.plan != null && w.plan > w.premium ? w.plan - w.premium : 0,
  };
}

/** 通用：从行集合中找 achievement_rate 最低、件数 > 0 的一行 */
function extractWorstByAch(
  rows: Array<Record<string, unknown>>,
  nameKeys: string[]
): { name: string; ach: number; mom: number | null } | null {
  const candidates = rows
    .filter((r) => r.achievement_rate != null && Number(r.auto_count ?? 0) > 0)
    .map((r) => {
      let rawName = '';
      for (const k of nameKeys) {
        if (r[k] != null && String(r[k]).length > 0) {
          rawName = String(r[k]);
          break;
        }
      }
      return {
        name: rawName,
        ach: Number(r.achievement_rate),
        mom: r.growth_rate == null ? null : Number(r.growth_rate),
      };
    })
    .filter((r) => r.name);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.ach - b.ach);
  return candidates[0];
}

export const PerformanceFocusStrip: React.FC<PerformanceFocusStripProps> = ({
  filters,
  segmentTag,
  timePeriod,
  growthMode,
  expandDims,
}) => {
  const { bundle, loading, error } = usePerformanceBundle({
    filters,
    segmentTag,
    timePeriod,
    growthMode,
    expandDims,
    // Bundle 路由开关：与 Panel / PremiumDashboard / useCrossSellAnalysis 一致。
    // 关闭时不发起请求，组件后续在 render 阶段返回 null（见下方 disabled 短路）。
    enabled: ENABLE_BUNDLE_ROUTES,
  });

  const tiles = useMemo<FocusTile[] | null>(() => {
    if (!bundle) return null;

    const overall = extractOverall(bundle.drilldown?.summary, bundle.summary?.rows ?? []);
    const weakestCov = extractWeakestCoverage(bundle.summary?.rows ?? []);
    const worstDrill = extractWorstByAch(bundle.drilldown?.rows ?? [], [
      'dimension_name',
      'group_name',
      'org_level_3',
      'salesman_name',
      'customer_category',
    ]);
    const worstSalesman = extractWorstByAch(bundle.topSalesman?.rows ?? [], [
      'dimension_name',
      'salesman_name',
    ]);

    const built: FocusTile[] = [];

    // Tile 1：整体达成进度（无 ach 时显示环比走势）
    if (overall) {
      if (overall.ach != null) {
        const tone = achTone(overall.ach);
        built.push({
          label: '整体达成进度',
          value: overall.ach.toFixed(1),
          unit: '%',
          sub:
            overall.gap > 0
              ? `缺口 ${formatPremiumWan(overall.gap)} 万 · 阈值 99`
              : '达成 · 阈值 99',
          tone: tone.text,
          dot: tone.dot,
        });
      } else if (overall.mom != null) {
        // 计划未配置时展示整体环比走势
        const negative = overall.mom < 0;
        built.push({
          label: '整体环比',
          value: `${overall.mom > 0 ? '+' : ''}${overall.mom.toFixed(1)}`,
          unit: '%',
          sub: '本周期保费同口径对比 · 计划未配置',
          tone: negative ? colorClasses.text.danger : colorClasses.text.success,
          dot: negative ? 'bg-danger' : 'bg-success',
        });
      }
    }

    // Tile 2：异常险别组合
    if (weakestCov) {
      const tone =
        weakestCov.ach != null
          ? achTone(weakestCov.ach)
          : weakestCov.mom != null && weakestCov.mom < 0
            ? { text: colorClasses.text.danger, dot: 'bg-danger' }
            : { text: colorClasses.text.neutralBlack, dot: 'bg-neutral-400' };
      const subParts: string[] = [];
      // backend 的 achievement_rate 已是百分比（3.2 = 3.2%），用 formatPercent 不再 ×100
      if (weakestCov.ach != null) subParts.push(`达成 ${formatPercent(weakestCov.ach)}`);
      if (weakestCov.mom != null) {
        subParts.push(`环比 ${weakestCov.mom > 0 ? '+' : ''}${weakestCov.mom.toFixed(1)}`);
      }
      if (weakestCov.gap > 0) subParts.push(`缺口 ${formatPremiumWan(weakestCov.gap)} 万`);
      built.push({
        label: '异常险别组合',
        value: weakestCov.name,
        sub: subParts.join(' · ') || '-',
        tone: tone.text,
        dot: tone.dot,
      });
    }

    // Tile 3：落后下钻维度（机构 / 业务员 / 客户类别 视当前 groupBy 而定）
    if (worstDrill) {
      const tone = achTone(worstDrill.ach);
      const momLabel =
        worstDrill.mom == null
          ? ''
          : ` · 环比 ${worstDrill.mom > 0 ? '+' : ''}${worstDrill.mom.toFixed(1)}`;
      built.push({
        label: '落后维度',
        value: formatSalesmanName(worstDrill.name),
        sub: `达成 ${formatPercent(worstDrill.ach)}${momLabel}`,
        tone: tone.text,
        dot: tone.dot,
      });
    }

    // Tile 4：掉队业务员（topSalesman 已按 ach 升序，取首位等价 worstByAch）
    if (worstSalesman) {
      const tone = achTone(worstSalesman.ach);
      built.push({
        label: '掉队业务员',
        value: formatSalesmanName(worstSalesman.name),
        sub: `达成 ${formatPercent(worstSalesman.ach)}`,
        tone: tone.text,
        dot: tone.dot,
      });
    }

    return built;
  }, [bundle]);

  // Bundle 路由开关关闭（legacy 部署）：本组件依赖 bundle，整体不渲染。
  // 主 Panel 已有 legacy 回退路径，业绩分析页其余区块照常工作。
  if (!ENABLE_BUNDLE_ROUTES) {
    return null;
  }

  // 加载态：4 个骨架卡片占位（保留 grid 结构防布局跳动）
  if (loading && !tiles) {
    return (
      <section
        aria-label="今日焦点（加载中）"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn(cardStyles.base, 'p-3.5 min-h-[88px]')}>
            <div className="h-3 w-20 rounded bg-neutral-100 dark:bg-white/5 mb-2" />
            <div className="h-6 w-24 rounded bg-neutral-100 dark:bg-white/5 mb-2" />
            <div className="h-3 w-32 rounded bg-neutral-100 dark:bg-white/5" />
          </div>
        ))}
      </section>
    );
  }

  // 错误态：仅显示一行错误提示（轻量，不阻塞页面其余区块）
  if (error) {
    return (
      <section
        aria-label="今日焦点（加载失败）"
        className={cn(
          cardStyles.base,
          'p-3 border-danger-border bg-danger-bg flex items-center gap-2 text-sm'
        )}
      >
        <span className={cn('w-2 h-2 rounded-full bg-danger shrink-0')} aria-hidden />
        <span className={colorClasses.text.dangerDark}>今日焦点加载失败：{error}</span>
      </section>
    );
  }

  // 空态：bundle 已返回但解析不出任何 tile（罕见，但要给出反馈）
  if (!tiles || tiles.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="今日焦点"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      data-testid="performance-focus-strip"
    >
      {tiles.map((t, i) => (
        <div
          key={`${t.label}-${i}`}
          className={cn(cardStyles.base, 'p-3.5')}
          data-tone={t.tone}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className={cn('w-1.5 h-1.5 rounded-full', t.dot)} aria-hidden />
            <span className={cn('text-xs', colorClasses.text.neutralLight)}>
              {t.label}
            </span>
          </div>
          <div
            className={cn(
              numericStyles.kpiSecondary,
              fontStyles.kpi,
              t.tone,
              'truncate'
            )}
            title={t.value}
          >
            {t.value}
            {t.unit && <span className="text-lg ml-0.5">{t.unit}</span>}
          </div>
          <p
            className={cn(
              'text-xs mt-1.5 font-numeric tabular-nums',
              colorClasses.text.neutralLight
            )}
          >
            {t.sub}
          </p>
        </div>
      ))}
    </section>
  );
};
