/**
 * useHeatmapDerivedData — 矩阵计算 + 摘要统计
 *
 * 迁移自 PerformanceAnalysisPanel 内嵌版的 useMemo，
 * 增加 summaryStats（异常数/连续异常/改善最快）和 weekendDates。
 */

import { useMemo } from 'react';
import { formatSalesmanName, formatTeamName } from '@/shared/utils/formatters';
import type { PerformanceOrgHeatmapRow } from '../../../hooks/usePerformanceOrgHeatmap';
import type { HeatmapDimension } from '../../../hooks/usePerformanceOrgHeatmap';
import type { PerformanceGrowthMode, PerformanceTimePeriod } from '../../../hooks/usePerformanceSummary';
import type { HeatmapDerivedData, HeatmapMetric, HeatmapSummaryStats } from '../types';
import { BRANCH_SUMMARY_ROW_LABEL, getWeekdayKey, THRESHOLD_MAP } from '../config';

// ==================== Branch Summary Row ====================

function buildBranchSummaryRow(
  date: string,
  dateRows: PerformanceOrgHeatmapRow[],
): PerformanceOrgHeatmapRow | null {
  if (dateRows.length === 0) return null;

  const premium = dateRows.reduce((sum, r) => sum + r.premium, 0);
  const planRows = dateRows.filter((r) => r.planPremium !== null);
  const planPremium = planRows.length > 0
    ? planRows.reduce((sum, r) => sum + (r.planPremium ?? 0), 0)
    : null;
  const achievementRate =
    planPremium !== null && planPremium > 0 ? (premium / planPremium) * 100 : null;

  const prevMomPremium = dateRows.reduce((sum, r) => sum + r.prevMomPremium, 0);
  const prevYoyPremium = dateRows.reduce((sum, r) => sum + r.prevYoyPremium, 0);
  const momGrowthRate =
    prevMomPremium > 0 ? ((premium - prevMomPremium) / prevMomPremium) * 100 : null;
  const yoyGrowthRate =
    prevYoyPremium > 0 ? ((premium - prevYoyPremium) / prevYoyPremium) * 100 : null;

  return {
    orgLevel3: BRANCH_SUMMARY_ROW_LABEL,
    policyDate: date,
    premium,
    planPremium,
    prevMomPremium,
    prevYoyPremium,
    achievementRate,
    momGrowthRate,
    yoyGrowthRate,
  };
}

// ==================== Summary Stats ====================

function computeSummaryStats(
  organizations: readonly string[],
  dates: readonly string[],
  matrix: ReadonlyMap<string, ReadonlyMap<string, PerformanceOrgHeatmapRow>>,
  growthMode: PerformanceGrowthMode,
): HeatmapSummaryStats {
  const growthThresholds = THRESHOLD_MAP.growth;
  const weakMin = growthThresholds.tiers.find((t) => t.tier === 'weak')?.min ?? -5;

  const latestDate = dates.length > 0 ? dates[dates.length - 1] : '';
  const baseOrgs = organizations.filter((o) => o !== BRANCH_SUMMARY_ROW_LABEL);

  // 最新一期异常机构数
  let abnormalOrgCount = 0;
  for (const org of baseOrgs) {
    const row = matrix.get(org)?.get(latestDate);
    if (!row) continue;
    const rate = growthMode === 'mom' ? row.momGrowthRate : row.yoyGrowthRate;
    if (rate !== null && rate < weakMin) abnormalOrgCount++;
  }

  // 连续异常最长
  let maxConsecutiveDanger: { org: string; days: number } | null = null;
  for (const org of baseOrgs) {
    const orgLine = matrix.get(org);
    if (!orgLine) continue;
    let streak = 0;
    // 从最新日期向前计算连续异常
    for (let i = dates.length - 1; i >= 0; i--) {
      const row = orgLine.get(dates[i]);
      const rate = row ? (growthMode === 'mom' ? row.momGrowthRate : row.yoyGrowthRate) : null;
      if (rate !== null && rate < weakMin) {
        streak++;
      } else {
        break;
      }
    }
    if (streak > 0 && (!maxConsecutiveDanger || streak > maxConsecutiveDanger.days)) {
      maxConsecutiveDanger = { org, days: streak };
    }
  }

  // 改善最快（最新两期增长率变化最大的正向变化）
  let fastestImprovement: { org: string; delta: number } | null = null;
  if (dates.length >= 2) {
    const prevDate = dates[dates.length - 2];
    for (const org of baseOrgs) {
      const orgLine = matrix.get(org);
      if (!orgLine) continue;
      const curr = orgLine.get(latestDate);
      const prev = orgLine.get(prevDate);
      if (!curr || !prev) continue;
      const currRate = growthMode === 'mom' ? curr.momGrowthRate : curr.yoyGrowthRate;
      const prevRate = growthMode === 'mom' ? prev.momGrowthRate : prev.yoyGrowthRate;
      if (currRate === null || prevRate === null) continue;
      const delta = currRate - prevRate;
      if (delta > 0 && (!fastestImprovement || delta > fastestImprovement.delta)) {
        fastestImprovement = { org, delta };
      }
    }
  }

  return { abnormalOrgCount, maxConsecutiveDanger, fastestImprovement };
}

// ==================== Main Hook ====================

interface UseHeatmapDerivedDataProps {
  readonly rows: PerformanceOrgHeatmapRow[];
  readonly metric: HeatmapMetric;
  readonly growthMode: PerformanceGrowthMode;
  readonly timePeriod: PerformanceTimePeriod;
  readonly groupByDimension?: HeatmapDimension;
}

export function useHeatmapDerivedData({
  rows,
  metric,
  growthMode,
  timePeriod,
  groupByDimension = 'org_level_3',
}: UseHeatmapDerivedDataProps): HeatmapDerivedData {
  return useMemo(() => {
    const dateSet = new Set<string>();
    const orgMap = new Map<string, Map<string, PerformanceOrgHeatmapRow>>();

    for (const row of rows) {
      dateSet.add(row.policyDate);
      let orgLine = orgMap.get(row.orgLevel3);
      if (!orgLine) {
        orgLine = new Map();
        orgMap.set(row.orgLevel3, orgLine);
      }
      orgLine.set(row.policyDate, row);
    }

    const allDates = [...dateSet].sort((a, b) => a.localeCompare(b));

    // 季/年视图：过滤掉所有机构都无数据的日期
    const dates =
      timePeriod === 'quarter' || timePeriod === 'year'
        ? allDates.filter((date) =>
            [...orgMap.values()].some((orgLine) => {
              const row = orgLine.get(date);
              return row && row.premium > 0;
            }),
          )
        : allDates;

    const latestDate = dates.length > 0 ? dates[dates.length - 1] : '';

    // 排序：按当前指标最新一期值降序
    const getOrgSortValue = (org: string): number => {
      const latestRow = orgMap.get(org)?.get(latestDate);
      if (!latestRow) return -Infinity;
      if (metric === 'premium') return latestRow.premium ?? -Infinity;
      if (metric === 'achievement') return latestRow.achievementRate ?? -Infinity;
      const rate = growthMode === 'mom' ? latestRow.momGrowthRate : latestRow.yoyGrowthRate;
      return rate ?? -Infinity;
    };

    const baseOrganizations = [...orgMap.keys()].sort(
      (a, b) => getOrgSortValue(b) - getOrgSortValue(a),
    );

    // 构建汇总行
    const branchSummaryLine = new Map<string, PerformanceOrgHeatmapRow>();
    for (const date of dates) {
      const dateRows = baseOrganizations
        .map((org) => orgMap.get(org)?.get(date))
        .filter((r): r is PerformanceOrgHeatmapRow => Boolean(r));
      const summary = buildBranchSummaryRow(date, dateRows);
      if (summary) branchSummaryLine.set(date, summary);
    }

    if (branchSummaryLine.size > 0) {
      orgMap.set(BRANCH_SUMMARY_ROW_LABEL, branchSummaryLine);
    }

    const organizations =
      branchSummaryLine.size > 0
        ? [BRANCH_SUMMARY_ROW_LABEL, ...baseOrganizations]
        : baseOrganizations;

    // 周末日期集合
    const weekendDates = new Set<string>();
    for (const date of dates) {
      const day = getWeekdayKey(date);
      if (day === 0 || day === 6) weekendDates.add(date);
    }

    // 摘要统计
    const summaryStats = computeSummaryStats(organizations, dates, orgMap, growthMode);

    return {
      dates,
      organizations,
      matrix: orgMap,
      summaryStats,
      weekendDates,
    };
  }, [rows, metric, growthMode, timePeriod, groupByDimension]);
}

/** 格式化维度标签（业务员名缩短、团队名缩短） */
export function formatDimensionLabel(
  value: string,
  groupByDimension: HeatmapDimension,
): string {
  if (value === BRANCH_SUMMARY_ROW_LABEL) return value;
  if (groupByDimension === 'salesman') return formatSalesmanName(value);
  if (groupByDimension === 'team') return formatTeamName(value);
  return value;
}
