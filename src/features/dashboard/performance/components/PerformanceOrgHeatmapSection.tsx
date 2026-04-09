/**
 * @deprecated Use PerformanceOrgHeatmapV2 instead.
 * This file is kept for backward compatibility during transition.
 * Original: Performance Org Heatmap - extracted from PerformanceAnalysisPanel.tsx
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '@/shared/ui/Tabs';
import type { TabItem } from '@/shared/ui/Tabs';
import { StickyTableFrame } from '@/shared/ui';
import { formatPercent } from '@/shared/utils/formatters';
import { cardStyles, cn, colorClasses, colors, stickyTableStyles, textStyles } from '@/shared/styles';
import { formatWanAdaptive } from '@/shared/utils/formatters';
import type { PerformanceOrgHeatmapRow } from '../../hooks/usePerformanceOrgHeatmap';
import type { PerformanceGrowthMode, PerformanceTimePeriod } from '../../hooks/usePerformanceSummary';

// ==================== Constants & Helpers ====================

type HeatmapMetric = 'growth' | 'achievement' | 'premium';
type HeatmapState = 'excellent' | 'healthy' | 'abnormal' | 'danger' | 'unknown';

const getHeatmapMetricTabs = (growthMode: PerformanceGrowthMode): TabItem[] => [
  { key: 'growth', label: growthMode === 'mom' ? '周环比增长率' : '年同比增长率' },
  { key: 'achievement', label: '计划达成率' },
  { key: 'premium', label: '保费规模' },
];

function getHeatmapStateColor(state: HeatmapState): string {
  switch (state) {
    case 'excellent':
      return colors.success.bg;
    case 'healthy':
      return colors.primary.bg;
    case 'abnormal':
      return colors.warning.bg;
    case 'danger':
      return colors.danger.bg;
    default:
      return colors.neutral[100];
  }
}

function classifyAchievementState(rate: number | null): HeatmapState {
  if (rate === null || Number.isNaN(rate)) return 'unknown';
  if (rate >= 105) return 'excellent';
  if (rate >= 100) return 'healthy';
  if (rate >= 95) return 'abnormal';
  return 'danger';
}

function classifyGrowthState(rate: number | null): HeatmapState {
  if (rate === null || Number.isNaN(rate)) return 'unknown';
  if (rate >= 15) return 'excellent';
  if (rate >= 10) return 'healthy';
  if (rate >= 5) return 'abnormal';
  return 'danger';
}

function getWeekdayKey(dateText: string): number {
  const date = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(date.getTime()) ? -1 : date.getDay();
}

function getMonthKey(dateText: string): string {
  return dateText.slice(5, 7);
}

function formatPremiumWanDisplay(value: number | null | undefined): string {
  return formatWanAdaptive(value);
}

const BRANCH_SUMMARY_ROW_LABEL = '分公司';

function buildPerformanceBranchSummaryRow(
  date: string,
  dateRows: PerformanceOrgHeatmapRow[]
): PerformanceOrgHeatmapRow | null {
  if (dateRows.length === 0) {
    return null;
  }

  const premium = dateRows.reduce((sum, row) => sum + row.premium, 0);
  const planRows = dateRows.filter((row) => row.planPremium !== null);
  const planPremium = planRows.length > 0
    ? planRows.reduce((sum, row) => sum + (row.planPremium ?? 0), 0)
    : null;
  const achievementRate = planPremium !== null && planPremium > 0
    ? (premium / planPremium) * 100
    : null;

  const prevMomPremium = dateRows.reduce((sum, row) => sum + row.prevMomPremium, 0);
  const prevYoyPremium = dateRows.reduce((sum, row) => sum + row.prevYoyPremium, 0);
  const momGrowthRate = prevMomPremium > 0
    ? ((premium - prevMomPremium) / prevMomPremium) * 100
    : null;
  const yoyGrowthRate = prevYoyPremium > 0
    ? ((premium - prevYoyPremium) / prevYoyPremium) * 100
    : null;

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
    policyCount: 0,
    avgPricingCoefficient: 0,
    premiumShare: 0,
    perPolicyPremium: 0,
  };
}

// ==================== Component ====================

interface PerformanceOrgHeatmapProps {
  rows: PerformanceOrgHeatmapRow[];
  loading: boolean;
  error: string | null;
  growthMode: PerformanceGrowthMode;
  timePeriod: PerformanceTimePeriod;
  dimensionLabel?: string;
  onCellClick?: (payload: { org: string; date: string }) => void;
  onRowClick?: (org: string) => void;
}

export function PerformanceOrgHeatmapSection({
  rows,
  loading,
  error,
  growthMode,
  timePeriod,
  dimensionLabel = '三级机构',
  onCellClick,
  onRowClick,
}: PerformanceOrgHeatmapProps) {
  const [metric, setMetric] = useState<HeatmapMetric>('growth');
  const [activeCell, setActiveCell] = useState<{ org: string; date: string } | null>(null);
  const [hoverCell, setHoverCell] = useState<{ org: string; date: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const orgRows = useMemo(() => {
    const dateSet = new Set<string>();
    const orgMap = new Map<string, Map<string, PerformanceOrgHeatmapRow>>();

    rows.forEach((row) => {
      dateSet.add(row.policyDate);
      const orgLine = orgMap.get(row.orgLevel3) || new Map<string, PerformanceOrgHeatmapRow>();
      orgLine.set(row.policyDate, row);
      orgMap.set(row.orgLevel3, orgLine);
    });

    const dates = [...dateSet].sort((a, b) => a.localeCompare(b));
    const latestDate = dates.length > 0 ? dates[dates.length - 1] : '';

    const getOrgSortValue = (org: string): number => {
      const latestRow = orgMap.get(org)?.get(latestDate);
      if (!latestRow) return -Infinity;
      if (metric === 'premium') return latestRow.premium ?? -Infinity;
      if (metric === 'achievement') return latestRow.achievementRate ?? -Infinity;
      const rate = growthMode === 'mom' ? latestRow.momGrowthRate : latestRow.yoyGrowthRate;
      return rate ?? -Infinity;
    };
    const baseOrganizations = [...orgMap.keys()].sort((a, b) => getOrgSortValue(b) - getOrgSortValue(a));
    const branchSummaryLine = new Map<string, PerformanceOrgHeatmapRow>();
    dates.forEach((date) => {
      const dateRows = baseOrganizations
        .map((org) => orgMap.get(org)?.get(date))
        .filter((row): row is PerformanceOrgHeatmapRow => Boolean(row));
      const summary = buildPerformanceBranchSummaryRow(date, dateRows);
      if (summary) {
        branchSummaryLine.set(date, summary);
      }
    });

    if (branchSummaryLine.size > 0) {
      orgMap.set(BRANCH_SUMMARY_ROW_LABEL, branchSummaryLine);
    }
    const organizations = branchSummaryLine.size > 0
      ? [BRANCH_SUMMARY_ROW_LABEL, ...baseOrganizations]
      : baseOrganizations;

    return {
      dates,
      organizations,
      matrix: orgMap,
    };
  }, [rows, metric, growthMode]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, [orgRows.dates.length, timePeriod]);

  const focusDate = activeCell?.date ?? hoverCell?.date ?? null;
  const focusWeekday = focusDate && timePeriod === 'day' ? getWeekdayKey(focusDate) : null;
  const focusMonth = focusDate && timePeriod === 'month' ? getMonthKey(focusDate) : null;

  const renderCell = (
    org: string,
    date: string,
    row: PerformanceOrgHeatmapRow | undefined,
    isBranchSummaryRow = false
  ) => {
    const canInteract = !isBranchSummaryRow;
    const isSelected = canInteract && activeCell?.org === org && activeCell?.date === date;
    const isSameWeekday = focusWeekday !== null && focusWeekday >= 0 && getWeekdayKey(date) === focusWeekday;
    const isSameMonth = focusMonth !== null && getMonthKey(date) === focusMonth;
    const isFocusRelated = isSelected || (timePeriod === 'day' ? isSameWeekday : false) || (timePeriod === 'month' ? isSameMonth : false);
    const degradeOpacity = (activeCell || hoverCell) && !isFocusRelated ? 'opacity-40' : '';
    const ringClass = isSelected ? 'ring-2 border' : '';

    if (!row) {
      return (
        <button
          type="button"
          onClick={() => {
            if (!canInteract) return;
            setActiveCell({ org, date });
            onCellClick?.({ org, date });
          }}
          onMouseEnter={() => {
            if (!canInteract) return;
            setHoverCell({ org, date });
          }}
          onMouseLeave={() => {
            if (!canInteract) return;
            setHoverCell(null);
          }}
          className={cn(
            'w-full rounded px-1 py-1 text-center text-xs transition-all',
            colorClasses.text.neutralMuted,
            isBranchSummaryRow ? 'font-semibold cursor-default' : '',
            degradeOpacity,
            ringClass
          )}
        >
          -
        </button>
      );
    }

    if (metric === 'premium') {
      return (
        <button
          type="button"
          onClick={() => {
            if (!canInteract) return;
            setActiveCell({ org, date });
            onCellClick?.({ org, date });
          }}
          onMouseEnter={() => {
            if (!canInteract) return;
            setHoverCell({ org, date });
          }}
          onMouseLeave={() => {
            if (!canInteract) return;
            setHoverCell(null);
          }}
          className={cn(
            'w-full rounded px-1 py-1 text-center transition-all',
            textStyles.numeric,
            colorClasses.text.neutralDark,
            isBranchSummaryRow ? 'font-semibold cursor-default' : '',
            degradeOpacity,
            ringClass
          )}
          style={{
            backgroundColor: colors.neutral[100],
            borderColor: isSelected ? colors.primary.DEFAULT : 'transparent',
            boxShadow: isSelected ? `0 0 0 2px ${colors.primary.bg}` : 'none',
          }}
        >
          {formatPremiumWanDisplay(row.premium)}
        </button>
      );
    }

    if (metric === 'achievement') {
      const state = classifyAchievementState(row.achievementRate);
      return (
        <button
          type="button"
          onClick={() => {
            if (!canInteract) return;
            setActiveCell({ org, date });
            onCellClick?.({ org, date });
          }}
          onMouseEnter={() => {
            if (!canInteract) return;
            setHoverCell({ org, date });
          }}
          onMouseLeave={() => {
            if (!canInteract) return;
            setHoverCell(null);
          }}
          className={cn(
            'w-full rounded px-1 py-1 text-center transition-all',
            textStyles.numeric,
            colorClasses.text.neutralDark,
            isBranchSummaryRow ? 'font-semibold cursor-default' : '',
            degradeOpacity,
            ringClass
          )}
          style={{
            backgroundColor: getHeatmapStateColor(state),
            borderColor: isSelected ? colors.primary.DEFAULT : 'transparent',
            boxShadow: isSelected ? `0 0 0 2px ${colors.primary.bg}` : 'none',
          }}
        >
          {row.achievementRate === null ? '-' : formatPercent(row.achievementRate)}
        </button>
      );
    }

    const majorRate = growthMode === 'mom' ? row.momGrowthRate : row.yoyGrowthRate;
    const state = classifyGrowthState(majorRate);
    return (
      <button
        type="button"
        onClick={() => {
          if (!canInteract) return;
          setActiveCell({ org, date });
          onCellClick?.({ org, date });
        }}
        onMouseEnter={() => {
          if (!canInteract) return;
          setHoverCell({ org, date });
        }}
        onMouseLeave={() => {
          if (!canInteract) return;
          setHoverCell(null);
        }}
        className={cn(
          'w-full rounded px-1 py-1 text-center transition-all',
          textStyles.numeric,
          colorClasses.text.neutralDark,
          isBranchSummaryRow ? 'font-semibold cursor-default' : '',
          degradeOpacity,
          ringClass
        )}
        style={{
          backgroundColor: getHeatmapStateColor(state),
          borderColor: isSelected ? colors.primary.DEFAULT : 'transparent',
          boxShadow: isSelected ? `0 0 0 2px ${colors.primary.bg}` : 'none',
        }}
      >
        <div>{majorRate === null ? '-' : formatPercent(majorRate)}</div>
      </button>
    );
  };

  return (
    <section className={cn(cardStyles.standard, 'space-y-3')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          items={getHeatmapMetricTabs(growthMode)}
          activeKey={metric}
          onChange={(key) => setMetric(key as HeatmapMetric)}
          variant="pills"
          size="small"
        />
        <p className={cn(textStyles.caption, colorClasses.text.neutralMuted)}>
          {timePeriod === 'day' && '增长率环比按同星期几对比（周环比），同比按上年同日对比；点选单元格后将高亮同星期几列。'}
          {timePeriod === 'week' && '每列为一个自然周的汇总保费，环比按上一周对比，同比按上年同周对比。'}
          {timePeriod === 'month' && '每列为一个自然月的汇总保费，环比按上一月对比，同比按上年同月对比；点选后高亮同月列。'}
          {timePeriod === 'quarter' && '每列为一个季度的汇总保费，环比按上一季度对比，同比按上年同季对比。'}
        </p>
      </div>
      {error && <p className={cn(textStyles.body, colorClasses.text.danger)}>加载失败: {error}</p>}
      {!error && (
        <StickyTableFrame ref={scrollRef} maxHeight={560}>
          <table className="w-full text-xs border-separate border-spacing-1" style={{ minWidth: `${100 + orgRows.dates.length * 72}px` }}>
            <thead>
              <tr>
                <th className={cn('px-2 py-2 text-left', stickyTableStyles.firstColumnHeader, colorClasses.text.neutralDark)}>{dimensionLabel}</th>
                {orgRows.dates.map((date) => {
                  let headerLabel: string;
                  if (timePeriod === 'month') {
                    headerLabel = date.slice(0, 7);
                  } else if (timePeriod === 'quarter') {
                    const month = parseInt(date.slice(5, 7), 10);
                    const q = Math.ceil(month / 3);
                    headerLabel = `${date.slice(0, 4)}-Q${q}`;
                  } else if (timePeriod === 'week') {
                    headerLabel = `${date.slice(5)}周`;
                  } else {
                    headerLabel = date.slice(5);
                  }
                  return (
                    <th key={date} className={cn('px-2 py-2 text-center', stickyTableStyles.header, colorClasses.text.neutralMuted)}>{headerLabel}</th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={orgRows.dates.length + 1} className={cn('px-3 py-6 text-center', colorClasses.text.neutralMuted)}>
                    数据加载中...
                  </td>
                </tr>
              )}
              {!loading && orgRows.organizations.length === 0 && (
                <tr>
                  <td colSpan={orgRows.dates.length + 1} className={cn('px-3 py-6 text-center', colorClasses.text.neutralMuted)}>
                    暂无热力图数据
                  </td>
                </tr>
              )}
              {!loading && orgRows.organizations.map((org) => {
                const orgLine = orgRows.matrix.get(org);
                const isBranchSummaryRow = org === BRANCH_SUMMARY_ROW_LABEL;
                const canRowClick = Boolean(onRowClick) && !isBranchSummaryRow;
                return (
                  <tr key={org}>
                    <td
                      className={cn(
                        stickyTableStyles.firstColumn,
                        'px-2 py-1 z-10 whitespace-nowrap',
                        colorClasses.text.neutralDark,
                        isBranchSummaryRow ? 'font-semibold' : '',
                        canRowClick ? 'cursor-pointer hover:text-primary hover:underline' : ''
                      )}
                      onClick={canRowClick ? () => onRowClick?.(org) : undefined}
                      title={canRowClick ? `点击下钻 ${org}` : undefined}
                    >{org}</td>
                    {orgRows.dates.map((date) => (
                      <td key={`${org}-${date}`} className="p-0.5 min-w-[84px]">
                        {renderCell(org, date, orgLine?.get(date), isBranchSummaryRow)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StickyTableFrame>
      )}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'excellent', label: '优秀', color: getHeatmapStateColor('excellent') },
          { key: 'healthy', label: '健康', color: getHeatmapStateColor('healthy') },
          { key: 'abnormal', label: '异常', color: getHeatmapStateColor('abnormal') },
          { key: 'danger', label: '危险', color: getHeatmapStateColor('danger') },
        ].map((item) => (
          <span
            key={item.key}
            className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs', colorClasses.text.neutralDark)}
            style={{ backgroundColor: item.color }}
          >
            {item.label}
          </span>
        ))}
      </div>
    </section>
  );
}
