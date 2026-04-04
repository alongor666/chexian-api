import React from 'react';
import type { ViewPerspective } from '../../shared/types';
import { PERSPECTIVE_OPTIONS, getPerspectiveConfig } from '../../shared/types';
import { colorClasses } from '../../shared/styles';

/**
 * 视角切换器组件
 *
 * 功能：允许用户在不同分析视角之间切换
 * - 保费视角：按保费金额聚合分析
 * - 商业险件数视角：按商业险保单数量聚合分析
 * - 交强险件数视角：按交强险保单数量聚合分析
 *
 * @example
 * ```tsx
 * <PerspectiveSwitcher
 *   value="premium"
 *   onChange={(value) => setPerspective(value)}
 * />
 * ```
 */

interface PerspectiveSwitcherProps {
  /** 当前选择的视角 */
  value: ViewPerspective;
  /** 视角变更回调 */
  onChange: (value: ViewPerspective) => void;
  /** 是否禁用（可选，默认false） */
  disabled?: boolean;
  /** 是否显示描述文本（可选，默认false） */
  showDescription?: boolean;
  /** 自定义标签（可选） */
  label?: string;
  /** 是否使用紧凑模式（可选，默认false，使用shortLabel） */
  compact?: boolean;
}

export const PerspectiveSwitcher: React.FC<PerspectiveSwitcherProps> = ({
  value,
  onChange,
  disabled = false,
  showDescription = false,
  label = '分析视角',
  compact = false,
}) => {
  const options = PERSPECTIVE_OPTIONS.map((perspectiveType) => {
    const config = getPerspectiveConfig(perspectiveType);
    return {
      value: perspectiveType,
      label: compact ? config.shortLabel : config.label,
      description: config.description,
    };
  });

  return (
    <div className="flex items-center space-x-3">
      <label className={`text-sm font-medium flex-shrink-0 ${colorClasses.text.neutralDark}`}>
        {label}：
      </label>
      <div
        className="inline-flex rounded-md shadow-sm"
        role="group"
        aria-label="视角选择"
      >
        {options.map((option, index) => {
          const isFirst = index === 0;
          const isLast = index === options.length - 1;
          const isSelected = value === option.value;

          const baseClasses = [
            'relative inline-flex items-center px-4 py-2 text-sm font-medium',
            'focus:z-10 focus:outline-none focus:ring-2 focus:ring-blue-500',
            'transition-colors duration-150',
          ];

          // 边框圆角
          if (isFirst) {
            baseClasses.push('rounded-l-md');
          }
          if (isLast) {
            baseClasses.push('rounded-r-md');
          }
          if (!isFirst && !isLast) {
            baseClasses.push('rounded-none');
          }

          // 边框样式
          if (isFirst) {
            baseClasses.push('border border-neutral-300');
          } else {
            baseClasses.push('border border-l-0 border-neutral-300');
          }

          // 选中状态样式
          if (isSelected) {
            baseClasses.push(
              'bg-primary text-white border-primary hover:bg-primary-dark'
            );
          } else {
            baseClasses.push(
              `bg-white ${colorClasses.text.neutralDark} hover:bg-neutral-50`
            );
          }

          // 禁用状态样式
          if (disabled) {
            baseClasses.push('opacity-50 cursor-not-allowed');
          } else {
            baseClasses.push('cursor-pointer');
          }

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => !disabled && onChange(option.value)}
              disabled={disabled}
              className={baseClasses.join(' ')}
              aria-pressed={isSelected}
              title={showDescription ? option.description : option.label}
            >
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      {showDescription && (
        <span className={`text-xs ml-2 ${colorClasses.text.neutralLight}`}>
          {getPerspectiveConfig(value).description}
        </span>
      )}
    </div>
  );
};
