import React from 'react';
import { PerspectiveSwitcher } from '../../../widgets/filters/PerspectiveSwitcher';
import type { ViewPerspective } from '../../../shared/types';

export type GrowthAnalysisType = 'org' | 'salesman' | 'kpi' | 'comparison';
export type GrowthRateType = 'yoy' | 'mom' | 'ytd';
export type GrowthTimeView = 'monthly' | 'quarterly';
export type GrowthComparisonGroupBy = 'org_level_3' | 'salesman_name';

interface GrowthAnalysisControlPanelProps {
  analysisType: GrowthAnalysisType;
  onAnalysisTypeChange: (next: GrowthAnalysisType) => void;
  growthType: GrowthRateType;
  onGrowthTypeChange: (next: GrowthRateType) => void;
  timeView: GrowthTimeView;
  onTimeViewChange: (next: GrowthTimeView) => void;
  comparisonGroupBy: GrowthComparisonGroupBy;
  onComparisonGroupByChange: (next: GrowthComparisonGroupBy) => void;
  perspective: ViewPerspective;
  onPerspectiveChange: (next: ViewPerspective) => void;
}

export function GrowthAnalysisControlPanel(props: GrowthAnalysisControlPanelProps): React.ReactElement {
  return (
    <div
      className="control-panel"
      style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '24px',
        padding: '16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
      }}
    >
      <div>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>分析类型</label>
        <select
          value={props.analysisType}
          onChange={e => props.onAnalysisTypeChange(e.target.value as GrowthAnalysisType)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd' }}
        >
          <option value="org">机构分析</option>
          <option value="salesman">业务员分析</option>
          <option value="kpi">KPI分析</option>
          <option value="comparison">📊 对比分析</option>
        </select>
      </div>

      {props.analysisType !== 'comparison' && (
        <>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>增长率类型</label>
            <select
              value={props.growthType}
              onChange={e => props.onGrowthTypeChange(e.target.value as GrowthRateType)}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd' }}
            >
              <option value="yoy">同比增长</option>
              <option value="mom">环比增长</option>
              <option value="ytd">年累计增长</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>时间维度</label>
            <select
              value={props.timeView}
              onChange={e => props.onTimeViewChange(e.target.value as GrowthTimeView)}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd' }}
            >
              <option value="monthly">月度</option>
              <option value="quarterly">季度</option>
            </select>
          </div>
        </>
      )}

      {props.analysisType === 'comparison' && (
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>分组维度</label>
          <select
            value={props.comparisonGroupBy}
            onChange={e => props.onComparisonGroupByChange(e.target.value as GrowthComparisonGroupBy)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd' }}
          >
            <option value="org_level_3">按机构</option>
            <option value="salesman_name">按业务员</option>
          </select>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'end' }}>
        <PerspectiveSwitcher
          value={props.perspective}
          onChange={props.onPerspectiveChange}
          disabled={props.analysisType === 'kpi' || props.analysisType === 'comparison'}
          compact
        />
      </div>
    </div>
  );
}
