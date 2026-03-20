/**
 * Performance Summary Table — extracted from PerformanceAnalysisPanel.tsx
 * Shows coverage combination performance with expandable child rows.
 */

import React, { useMemo, useState, useEffect } from 'react';
import type { TabItem } from '@/shared/ui/Tabs';
import { Tabs } from '@/shared/ui/Tabs';
import { StickyTableFrame } from '@/shared/ui';
import { formatCount, formatPercent, formatWanAdaptive } from '@/shared/utils/formatters';
import { cardStyles, cn, colorClasses, stickyTableStyles, textStyles } from '@/shared/styles';
import {
  classifyAchievementBand,
  classifyGrowthBand,
  getAchievementTextClass,
  getGrowthTextClass,
} from '../performanceStatus';
import type {
  PerformanceSummaryExpandDims,
  PerformanceSummaryRow,
} from '../hooks/usePerformanceSummary';

// ==================== Types ====================

export interface PerformanceSummaryTableProps {
  rows: PerformanceSummaryRow[];
  loading: boolean;
  error: string | null;
  expandDims: PerformanceSummaryExpandDims;
  onExpandDimsChange: (dims: PerformanceSummaryExpandDims) => void;
  segmentTag: string;
  timePeriod: string;
  growthMode: string;
}

// ==================== Constants ====================

const SUMMARY_ORDER = ['整体', '主全', '交三', '单交'];

const EXPAND_DIMS_TABS: TabItem[] = [
  { key: 'none', label: '不展开' },
  { key: 'energy', label: '油电' },
  { key: 'business_nature', label: '新转续' },
  { key: 'energy_business_nature', label: '油电+新转续' },
];

// ==================== Helpers ====================

function formatPremiumWanDisplay(value: number | null | undefined): string {
  return formatWanAdaptive(value);
}

function formatAvgPremiumDisplay(value: number): string {
  return `${formatCount(value)}元`;
}

function getRateTextClass(field: 'achievement' | 'growth', value: number | null): string {
  if (field === 'achievement') {
    return cn(getAchievementTextClass(classifyAchievementBand(value)), 'font-semibold');
  }
  return cn(getGrowthTextClass(classifyGrowthBand(value)), 'font-semibold');
}

// ==================== Component ====================

export function PerformanceSummaryTable({
  rows,
  loading,
  error,
  expandDims,
  onExpandDimsChange,
  segmentTag: _segmentTag,
  timePeriod: _timePeriod,
  growthMode: _growthMode,
}: PerformanceSummaryTableProps) {
  const [expandedCoverage, setExpandedCoverage] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedCoverage({});
  }, [expandDims, _segmentTag, _timePeriod, _growthMode]);

  const parentSummaryRows = useMemo(() => {
    const filtered = rows.filter((row) => row.row_level === 0);
    const rowMap = new Map(filtered.map((row) => [row.coverage_combination, row]));
    const ordered = SUMMARY_ORDER
      .map((key) => rowMap.get(key))
      .filter((item): item is PerformanceSummaryRow => Boolean(item));
    const rest = filtered.filter((row) => !SUMMARY_ORDER.includes(row.coverage_combination));
    return [...ordered, ...rest];
  }, [rows]);

  const childSummaryMap = useMemo(() => {
    const map = new Map<string, PerformanceSummaryRow[]>();
    rows
      .filter((row) => row.row_level === 1)
      .forEach((row) => {
        const list = map.get(row.coverage_combination) || [];
        list.push(row);
        map.set(row.coverage_combination, list);
      });
    return map;
  }, [rows]);

  const toggleCoverageExpand = (coverage: string) => {
    setExpandedCoverage((prev) => ({ ...prev, [coverage]: !prev[coverage] }));
  };

  return (
    <section className={cn(cardStyles.standard, 'p-0 overflow-hidden')}>
      <div className="px-4 pt-3">
        <Tabs
          items={EXPAND_DIMS_TABS}
          activeKey={expandDims}
          onChange={(key) => onExpandDimsChange(key as PerformanceSummaryExpandDims)}
          variant="pills"
          size="small"
        />
      </div>
      {error ? (
        <div className={cn('p-4', colorClasses.text.danger)}>加载失败: {error}</div>
      ) : (
        <StickyTableFrame maxHeight={620}>
          <table className="w-full text-sm">
            <thead className={cn('bg-neutral-50 border-b border-neutral-200', stickyTableStyles.header)}>
              <tr>
                <th className="px-4 py-3 text-left font-medium text-neutral-600">险别组合</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">车险保费(万元)</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">车险计划(万元)</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">车险件数</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">件均保费</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">达成率</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">增长率</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">新能源占比</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">续保占比</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">转保占比</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">新保占比</th>
                <th className="px-4 py-3 text-right font-medium text-neutral-600">过户转保占比</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-neutral-400">数据加载中...</td>
                </tr>
              )}
              {!loading && parentSummaryRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-neutral-400">暂无数据</td>
                </tr>
              )}
              {!loading && parentSummaryRows.map((row, index) => {
                const childRows = childSummaryMap.get(row.coverage_combination) || [];
                const canExpand = expandDims !== 'none' && childRows.length > 0;
                const isExpanded = Boolean(expandedCoverage[row.coverage_combination]);
                return (
                  <React.Fragment key={`${row.coverage_combination}-${index}`}>
                    <tr className="border-b border-neutral-100">
                      <td
                        className={cn('px-4 py-3 font-medium text-neutral-800', canExpand && 'cursor-pointer')}
                        onClick={() => canExpand && toggleCoverageExpand(row.coverage_combination)}
                      >
                        {canExpand ? `${isExpanded ? '▾' : '▸'} ` : ''}{row.row_label}
                      </td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.premium)}</td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.plan_premium)}</td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatCount(row.auto_count)}</td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatAvgPremiumDisplay(row.avg_premium)}</td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric, getRateTextClass('achievement', row.achievement_rate))}>
                        {row.achievement_rate === null ? '-' : formatPercent(row.achievement_rate)}
                      </td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric, getGrowthTextClass(classifyGrowthBand(row.growth_rate)), 'font-semibold')}>
                        {row.growth_rate === null ? '-' : formatPercent(row.growth_rate)}
                      </td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.nev_rate)}</td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.renewal_rate)}</td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.transfer_business_rate)}</td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.new_car_rate)}</td>
                      <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.transfer_rate)}</td>
                    </tr>
                    {isExpanded && childRows.map((child) => (
                      <tr key={`${row.coverage_combination}-${child.expand_key}`} className="border-b border-neutral-100 bg-neutral-50/40">
                        <td className={cn('px-4 py-2 pl-8', colorClasses.text.neutralDark)}>{child.row_label}</td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(child.premium)}</td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(child.plan_premium)}</td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatCount(child.auto_count)}</td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatAvgPremiumDisplay(child.avg_premium)}</td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric, getRateTextClass('achievement', child.achievement_rate))}>
                          {child.achievement_rate === null ? '-' : formatPercent(child.achievement_rate)}
                        </td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric, getGrowthTextClass(classifyGrowthBand(child.growth_rate)), 'font-semibold')}>
                          {child.growth_rate === null ? '-' : formatPercent(child.growth_rate)}
                        </td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.nev_rate)}</td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.renewal_rate)}</td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.transfer_business_rate)}</td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.new_car_rate)}</td>
                        <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.transfer_rate)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </StickyTableFrame>
      )}
    </section>
  );
}
