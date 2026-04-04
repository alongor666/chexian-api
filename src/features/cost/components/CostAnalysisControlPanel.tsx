/**
 * 成本分析控制面板
 * Cost Analysis Control Panel
 *
 * 提供：
 * - 子Tab切换（变动成本率/赔付率/费用率/综合费用率）
 * - 维度选择器（客户类别/三级机构/险别组合）
 * - 截止日期选择器
 */

import React from 'react';
import type { CostSubTab, CostAnalysisControlPanelProps, CostDimension } from '../types/costTypes';
import { COST_SUB_TAB_CONFIG, MONTH_END_OPTIONS, DIMENSION_LABELS } from '../types/costTypes';
import { colorClasses, cn } from '../../../shared/styles';

/** 维度选项配置 */
const DIMENSION_OPTIONS: {
  value: CostDimension;
  label: string;
  enabled: boolean;
}[] = [
  { value: 'customer_category', label: '客户类别', enabled: true },
  { value: 'org_level_3', label: '三级机构', enabled: true },
  { value: 'coverage_combination', label: '险别组合', enabled: true },
  { value: 'org_customer', label: '机构+客户类别', enabled: false }, // 预留
  { value: 'org_coverage', label: '机构+险别组合', enabled: false }, // 预留
];

/**
 * 成本分析控制面板组件
 */
export const CostAnalysisControlPanel: React.FC<
  CostAnalysisControlPanelProps
> = ({
  activeSubTab,
  onSubTabChange,
  dimension,
  onDimensionChange,
  cutoffDate,
  onCutoffDateChange,
  monthEndOptions,
}) => {
  const subTabs = Object.entries(COST_SUB_TAB_CONFIG).filter(
    ([, config]) => config.enabled
  );

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
      {/* 子Tab切换 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {subTabs.map(([key, config]) => (
          <button
            key={key}
            onClick={() => onSubTabChange(key as CostSubTab)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              activeSubTab === key
                ? 'bg-blue-500 text-white shadow-md'
                : cn(colorClasses.bg.neutralLight, colorClasses.text.neutral, 'hover:bg-neutral-200')
            )}
          >
            {config.label}
          </button>
        ))}
      </div>

      {/* 控制选项行 */}
      <div className="flex flex-wrap items-center gap-4">
        {/* 维度选择器（已赚保费/新口径已赚保费时隐藏） */}
        {activeSubTab !== 'earned' && activeSubTab !== 'earned-new' && (
          <div className="flex items-center gap-2">
            <label className={cn('text-sm font-medium', colorClasses.text.neutral)}>分析维度:</label>
            <select
              value={dimension}
              onChange={(e) => onDimensionChange(e.target.value as CostDimension)}
              className={cn('px-3 py-1.5 rounded-md text-sm border focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent', colorClasses.border.neutral)}
            >
              {DIMENSION_OPTIONS.filter((opt) => opt.enabled).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 截止日期选择器（新口径已赚保费时隐藏，使用固定年度） */}
        {activeSubTab !== 'earned-new' && (
          <div className="flex items-center gap-2">
            <label className={cn('text-sm font-medium', colorClasses.text.neutral)}>
              统计截止日:
            </label>
            {activeSubTab === 'earned' ? (
              // 已赚保费使用月末下拉选择器
              <select
                value={cutoffDate}
                onChange={(e) => onCutoffDateChange(e.target.value)}
                className={cn('px-3 py-1.5 rounded-md text-sm border focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent', colorClasses.border.neutral)}
              >
                {(monthEndOptions ?? MONTH_END_OPTIONS).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              // 其他标签页使用日期输入框
              <input
                type="date"
                value={cutoffDate}
                onChange={(e) => onCutoffDateChange(e.target.value)}
                className={cn('px-3 py-1.5 rounded-md text-sm border focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent', colorClasses.border.neutral)}
              />
            )}
          </div>
        )}

        {/* 当前维度标签 */}
        <div className={cn('ml-auto text-sm', colorClasses.text.neutralLight)}>
          当前视图:{' '}
          <span className={cn('font-medium', colorClasses.text.neutralDark)}>
            {activeSubTab === 'earned'
              ? '三级机构×险类×起保年月'
              : activeSubTab === 'earned-new'
              ? '2025/2026年度×起保月'
              : DIMENSION_LABELS[dimension]}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CostAnalysisControlPanel;
