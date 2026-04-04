import React from 'react';
import { colorClasses } from '../../shared/styles';

/**
 * DC-001: 分析年度选择器组件
 *
 * 功能：允许用户选择分析的年度（基于当前日期口径的可用年份）
 *
 * @example
 * ```tsx
 * <AnalysisYearSelector
 *   value={2026}
 *   onChange={(year) => setFilters({ ...filters, analysisYear: year })}
 *   availableYears={[2026, 2025, 2024]}
 *   currentYear={2026}
 * />
 * ```
 */

interface AnalysisYearSelectorProps {
  /** 当前选择的年度 */
  value: number;
  /** 年度变更回调 */
  onChange: (year: number) => void;
  /** 可选年度列表（基于当前日期口径的元数据） */
  availableYears: number[];
  /** 当前自然年度（用于标记"当前年度"） */
  currentYear?: number;
  /** 是否禁用（可选，默认false） */
  disabled?: boolean;
  /** 紧凑模式（垂直布局，适用于侧边栏） */
  compact?: boolean;
}

export const AnalysisYearSelector: React.FC<AnalysisYearSelectorProps> = ({
  value,
  onChange,
  availableYears,
  currentYear: _currentYear, // 预留：将来可用于标记"当前年度"
  disabled = false,
  compact = false,
}) => {
  const handleYearChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedYear = Number(event.target.value);
    onChange(selectedYear);
  };

  // 验证：如果没有可用年份，显示警告
  if (!availableYears || availableYears.length === 0) {
    if (compact) {
      return (
        <div className="flex items-center justify-between">
          <label className={`text-xs font-medium ${colorClasses.text.neutral}`}>分析年度</label>
          <span className={`text-xs ${colorClasses.text.warning}`}>无可用年份</span>
        </div>
      );
    }
    return (
      <div className="flex items-center space-x-2">
        <label className={`text-sm font-medium flex-shrink-0 ${colorClasses.text.neutral}`}>
          分析年度：
        </label>
        <div className={`text-sm px-3 py-2 rounded border ${colorClasses.text.warning} ${colorClasses.bg.warning} ${colorClasses.border.warning}`}>
          ⚠️ 无可用年份（请先加载数据）
        </div>
      </div>
    );
  }

  // 验证：如果当前选择的年份不在可用列表中，使用第一个可用年份
  const selectedYear = availableYears.includes(value)
    ? value
    : availableYears[0];

  // 紧凑模式：垂直布局
  if (compact) {
    return (
      <div className="flex items-center justify-between">
        <label className={`text-xs font-medium ${colorClasses.text.neutral}`}>分析年度</label>
        <select
          value={selectedYear}
          onChange={handleYearChange}
          disabled={disabled}
          className={`px-2 py-1 text-xs border rounded ${colorClasses.border.neutral} ${
            disabled ? 'opacity-50 cursor-not-allowed bg-neutral-100' : 'bg-white cursor-pointer'
          }`}
          aria-label="选择分析年度"
        >
          {availableYears.map((year) => (
            <option key={year} value={year}>
              {year}年
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-3">
      <label
        htmlFor="analysis-year-select"
        className={`text-sm font-medium flex-shrink-0 whitespace-nowrap ${colorClasses.text.neutral}`}
      >
        分析年度：
      </label>
      <select
        id="analysis-year-select"
        value={selectedYear}
        onChange={handleYearChange}
        disabled={disabled}
        className={`
          block w-32 px-3 py-2 text-sm
          border border-neutral-300 rounded-md
          shadow-sm focus:outline-none
          focus:ring-2 focus:ring-blue-500 focus:border-blue-500
          transition-colors duration-200
          whitespace-nowrap
          ${disabled ? 'opacity-50 cursor-not-allowed bg-neutral-100' : 'bg-white cursor-pointer'}
        `}
        aria-label="选择分析年度"
      >
        {availableYears.map((year) => {
          return (
            <option
              key={year}
              value={year}
            >
              {year}年
            </option>
          );
        })}
      </select>
    </div>
  );
};

/**
 * 默认导出（便于动态导入）
 */
export default AnalysisYearSelector;
