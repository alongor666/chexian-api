import React from 'react';
import { DualYAxisComparisonChart } from '../../../widgets/charts/DualYAxisComparisonChart';
import { ComparisonQuickPresets } from './ComparisonQuickPresets';
import type { DualMetricComparisonData } from '../hooks/useGrowthAnalysis';
import type { ComparisonPeriods, ComparisonPreset } from '../utils/comparisonPresets';
import { formatPeriodDisplay } from '../utils/comparisonPresets';
import { formatCount, formatPremiumWan } from '../../../shared/utils/formatters';
import { formatPercent1 } from '../utils/format';
import { StickyTableFrame } from '../../../shared/ui';
import { cn, getTrendColorClass, stickyTableStyles } from '../../../shared/styles';

interface GrowthComparisonSectionProps {
  baseDate: string;
  comparisonPreset: ComparisonPreset;
  comparisonPeriods: ComparisonPeriods | null;
  comparisonData: DualMetricComparisonData[];
  comparisonGroupBy: 'org_level_3' | 'salesman_name';
  loading: boolean;
  onPresetChange: (preset: ComparisonPreset, periods: ComparisonPeriods | null) => void;
  onDownload: () => void;
}

export function GrowthComparisonSection(props: GrowthComparisonSectionProps): React.ReactElement {
  return (
    <div style={{ marginBottom: '24px' }}>
      <div className="mb-6 p-4 bg-primary-bg border border-primary-border rounded-lg">
        <ComparisonQuickPresets
          activePreset={props.comparisonPreset}
          onPresetChange={props.onPresetChange}
          baseDate={props.baseDate}
          disabled={props.loading}
        />
        {props.comparisonPeriods && (
          <div className="mt-3 text-xs text-primary">
            <strong>当前对比：</strong>
            <span className="ml-2">
              当期 {formatPeriodDisplay(props.comparisonPeriods.current)} vs 基期 {formatPeriodDisplay(props.comparisonPeriods.previous)}
            </span>
          </div>
        )}
      </div>

      <DualYAxisComparisonChart
        data={props.comparisonData}
        loading={props.loading}
        title={`${props.comparisonGroupBy === 'org_level_3' ? '分机构' : '分业务员'}保费与件数对比`}
        currentLabel="当期"
        previousLabel="基期"
        height={450}
      />

      {props.comparisonData.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>对比详细数据 (Top 15)</h3>
            <button
              onClick={props.onDownload}
              className="px-3 py-1.5 bg-white dark:bg-surface-1 border border-neutral-300 dark:border-subtle rounded cursor-pointer text-sm flex items-center gap-1 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-surface-2 transition-colors"
            >
              📥 下载数据
            </button>
          </div>
          <StickyTableFrame maxHeight={520}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr className="bg-neutral-50 dark:bg-surface-2">
                  <th className={cn(stickyTableStyles.firstColumnHeader)} style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid var(--border-default, #ddd)' }}>
                    {props.comparisonGroupBy === 'org_level_3' ? '机构' : '业务员'}
                  </th>
                  <th className={cn(stickyTableStyles.header)} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-default, #ddd)' }}>当期保费</th>
                  <th className={cn(stickyTableStyles.header)} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-default, #ddd)' }}>基期保费</th>
                  <th className={cn(stickyTableStyles.header)} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-default, #ddd)' }}>保费增长率</th>
                  <th className={cn(stickyTableStyles.header)} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-default, #ddd)' }}>当期件数</th>
                  <th className={cn(stickyTableStyles.header)} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-default, #ddd)' }}>基期件数</th>
                  <th className={cn(stickyTableStyles.header)} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-default, #ddd)' }}>件数增长率</th>
                </tr>
              </thead>
              <tbody>
                {props.comparisonData.slice(0, 15).map((item, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid var(--border-subtle, #eee)' }}>
                    <td className={cn(stickyTableStyles.firstColumn)} style={{ padding: '12px', fontWeight: '500' }}>{item.dim_key}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatPremiumWan(item.current_premium)}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatPremiumWan(item.previous_premium)}</td>
                    <td
                      className={cn(getTrendColorClass(item.premium_growth_rate || 0, 'positive'), 'font-medium')}
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                      }}
                    >
                      {formatPercent1(item.premium_growth_rate)}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatCount(item.current_count)}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatCount(item.previous_count)}</td>
                    <td
                      className={cn(getTrendColorClass(item.count_growth_rate || 0, 'positive'), 'font-medium')}
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                      }}
                    >
                      {formatPercent1(item.count_growth_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StickyTableFrame>
        </div>
      )}
    </div>
  );
}
