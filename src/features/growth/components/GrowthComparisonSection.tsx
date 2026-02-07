import React from 'react';
import { DualYAxisComparisonChart } from '../../../widgets/charts/DualYAxisComparisonChart';
import { ComparisonQuickPresets } from './ComparisonQuickPresets';
import type { DualMetricComparisonData } from '../hooks/useGrowthAnalysis';
import type { ComparisonPeriods, ComparisonPreset } from '../utils/comparisonPresets';
import { formatPeriodDisplay } from '../utils/comparisonPresets';
import { formatCount, formatPremiumWan } from '../../../shared/utils/formatters';
import { formatPercent1 } from '../utils/format';

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
      <div
        style={{
          marginBottom: '24px',
          padding: '16px',
          backgroundColor: '#f0f9ff',
          borderRadius: '8px',
          border: '1px solid #bae6fd',
        }}
      >
        <ComparisonQuickPresets
          activePreset={props.comparisonPreset}
          onPresetChange={props.onPresetChange}
          baseDate={props.baseDate}
          disabled={props.loading}
        />
        {props.comparisonPeriods && (
          <div style={{ marginTop: '12px', fontSize: '13px', color: '#0369a1' }}>
            <strong>当前对比：</strong>
            <span style={{ marginLeft: '8px' }}>
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
              style={{
                padding: '6px 12px',
                backgroundColor: '#fff',
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              📥 下载数据
            </button>
          </div>
          <div style={{ overflow: 'auto', border: '1px solid #ddd', borderRadius: '6px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    {props.comparisonGroupBy === 'org_level_3' ? '机构' : '业务员'}
                  </th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>当期保费</th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>基期保费</th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>保费增长率</th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>当期件数</th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>基期件数</th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>件数增长率</th>
                </tr>
              </thead>
              <tbody>
                {props.comparisonData.slice(0, 15).map((item, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '12px', fontWeight: '500' }}>{item.dim_key}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatPremiumWan(item.current_premium)}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatPremiumWan(item.previous_premium)}</td>
                    <td
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                        color:
                          item.premium_growth_rate && item.premium_growth_rate > 0
                            ? '#28a745'
                            : item.premium_growth_rate && item.premium_growth_rate < 0
                              ? '#dc3545'
                              : '#666',
                        fontWeight: '500',
                      }}
                    >
                      {formatPercent1(item.premium_growth_rate)}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatCount(item.current_count)}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatCount(item.previous_count)}</td>
                    <td
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                        color:
                          item.count_growth_rate && item.count_growth_rate > 0
                            ? '#28a745'
                            : item.count_growth_rate && item.count_growth_rate < 0
                              ? '#dc3545'
                              : '#666',
                        fontWeight: '500',
                      }}
                    >
                      {formatPercent1(item.count_growth_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

