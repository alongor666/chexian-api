import React from 'react';
import { PerspectiveSwitcher } from '../../../widgets/filters/PerspectiveSwitcher';
import { cardStyles } from '../../../shared/styles';
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

const selectClass = 'px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100';
const labelClass = 'block mb-1 font-medium text-sm text-neutral-700 dark:text-neutral-300';

export function GrowthAnalysisControlPanel(props: GrowthAnalysisControlPanelProps): React.ReactElement {
  return (
    <div className={`${cardStyles.base} flex gap-4 mb-6 p-4`}>
      <div>
        <label className={labelClass}>分析类型</label>
        <select
          value={props.analysisType}
          onChange={e => props.onAnalysisTypeChange(e.target.value as GrowthAnalysisType)}
          className={selectClass}
        >
          <option value="org">机构分析</option>
          <option value="salesman">业务员分析</option>
          <option value="kpi">KPI分析</option>
          <option value="comparison">对比分析</option>
        </select>
      </div>

      {props.analysisType !== 'comparison' && (
        <>
          <div>
            <label className={labelClass}>增长率类型</label>
            <select
              value={props.growthType}
              onChange={e => props.onGrowthTypeChange(e.target.value as GrowthRateType)}
              className={selectClass}
            >
              <option value="yoy">同比增长</option>
              <option value="mom">环比增长</option>
              <option value="ytd">年累计增长</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>时间维度</label>
            <select
              value={props.timeView}
              onChange={e => props.onTimeViewChange(e.target.value as GrowthTimeView)}
              className={selectClass}
            >
              <option value="monthly">月度</option>
              <option value="quarterly">季度</option>
            </select>
          </div>
        </>
      )}

      {props.analysisType === 'comparison' && (
        <div>
          <label className={labelClass}>分组维度</label>
          <select
            value={props.comparisonGroupBy}
            onChange={e => props.onComparisonGroupByChange(e.target.value as GrowthComparisonGroupBy)}
            className={selectClass}
          >
            <option value="org_level_3">按机构</option>
            <option value="salesman_name">按业务员</option>
          </select>
        </div>
      )}

      <div className="flex items-end">
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
