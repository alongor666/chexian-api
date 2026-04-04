import React from 'react';
import { DateCriteria } from '../../shared/types/data';
import { colorClasses } from '../../shared/styles';

/**
 * DC-001: 日期口径选择器组件
 *
 * 功能：允许用户选择按"签单日期"或"起保日期"进行数据分析
 *
 * @example
 * ```tsx
 * <DateCriteriaSelector
 *   value="policy_date"
 *   onChange={(value) => setFilters({ ...filters, dateCriteria: value })}
 * />
 * ```
 */

interface DateCriteriaSelectorProps {
  /** 当前选择的日期口径 */
  value: DateCriteria;
  /** 日期口径变更回调 */
  onChange: (value: DateCriteria) => void;
  /** 是否禁用（可选，默认false） */
  disabled?: boolean;
  /** 紧凑模式（垂直布局，适用于侧边栏） */
  compact?: boolean;
}

export const DateCriteriaSelector: React.FC<DateCriteriaSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  compact = false,
}) => {
  const options: Array<{ value: DateCriteria; label: string; description: string; shortLabel: string }> = [
    {
      value: 'policy_date',
      label: '按签单日期',
      shortLabel: '签单日期',
      description: '(统计签单时间)',
    },
    {
      value: 'insurance_start_date',
      label: '按起保日期',
      shortLabel: '起保日期',
      description: '(统计起保时间)',
    },
  ];

  // 紧凑模式：垂直布局
  if (compact) {
    return (
      <div className="flex items-center justify-between">
        <label className={`text-xs font-medium ${colorClasses.text.neutral}`}>统计口径</label>
        <div className="flex gap-1" role="group" aria-label="日期口径选择">
          {options.map((option) => {
            const isSelected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => !disabled && onChange(option.value)}
                disabled={disabled}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  isSelected
                    ? 'bg-primary text-white'
                    : `${colorClasses.bg.neutral} ${colorClasses.text.neutral} hover:bg-neutral-200`
                } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                aria-pressed={isSelected}
                title={option.description}
              >
                {option.shortLabel}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-3">
      <label className={`text-sm font-medium flex-shrink-0 whitespace-nowrap ${colorClasses.text.neutral}`}>
        统计口径：
      </label>
      <div
        className="inline-flex rounded-md shadow-sm"
        role="group"
        aria-label="日期口径选择"
      >
        {options.map((option, index) => {
          const isFirst = index === 0;
          const isLast = index === options.length - 1;
          const isSelected = value === option.value;

          const baseClasses = [
            'px-4 py-2 text-sm font-medium border',
            'focus:z-10 focus:ring-2 focus:ring-primary focus:border-primary',
            'transition-colors duration-200',
            'whitespace-nowrap',
          ];

          const positionClasses = isFirst
            ? 'rounded-l-lg'
            : isLast
              ? 'rounded-r-lg -ml-px'
              : '-ml-px border-l-0';

          const stateClasses = isSelected
            ? 'bg-primary text-white border-primary hover:bg-primary-solid'
            : `bg-white dark:bg-neutral-800 ${colorClasses.text.neutral} border-neutral-300 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-700`;

          const disabledClasses = disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer';

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => !disabled && onChange(option.value)}
              disabled={disabled}
              className={`${baseClasses.join(' ')} ${positionClasses} ${stateClasses} ${disabledClasses}`}
              aria-pressed={isSelected}
              title={option.description}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * 默认导出（便于动态导入）
 */
export default DateCriteriaSelector;
