/**
 * 对比快捷预设按钮组件
 *
 * 提供一键切换对比模式：
 * - 同比（YoY）：本期 vs 去年同期
 * - 环比(月)（MoM）：本月 vs 上月
 * - 环比(周)（WoW）：本周 vs 上周
 * - 自定义：用户手动选择日期范围
 *
 * @module ComparisonQuickPresets
 * @author @claude
 * @since 2026-01-14
 */

import React from 'react';
import {
  type ComparisonPreset,
  type ComparisonPeriods,
  PRESET_CONFIGS,
  calculatePresetPeriods,
  formatPeriodDisplay
} from '../utils/comparisonPresets';
import { fontStyles } from '../../../shared/styles';

/** 组件Props */
export interface ComparisonQuickPresetsProps {
  /** 当前选中的预设 */
  activePreset: ComparisonPreset;
  /** 预设变更回调 */
  onPresetChange: (preset: ComparisonPreset, periods: ComparisonPeriods | null) => void;
  /** 基准日期（数据最大日期，DC-002规范：必须从外部传入） */
  baseDate: string;
  /** 紧凑模式 */
  compact?: boolean;
  /** 禁用状态 */
  disabled?: boolean;
}

/** 预设按钮顺序 */
const PRESET_ORDER: ComparisonPreset[] = ['yoy', 'mom', 'wow', 'custom'];

/**
 * 对比快捷预设按钮组件
 */
export const ComparisonQuickPresets: React.FC<ComparisonQuickPresetsProps> = ({
  activePreset,
  onPresetChange,
  baseDate,
  compact = false,
  disabled = false
}) => {
  /** 处理预设点击 */
  const handlePresetClick = (preset: ComparisonPreset) => {
    if (disabled) return;

    const periods = calculatePresetPeriods(preset, baseDate);
    onPresetChange(preset, periods);
  };

  /** 获取按钮样式 */
  const getButtonClassName = (preset: ComparisonPreset): string => {
    const isActive = activePreset === preset;
    const baseClasses = compact
      ? 'px-2 py-1 text-xs rounded'
      : 'px-3 py-1.5 text-sm rounded-md';

    if (disabled) {
      return `${baseClasses} bg-neutral-100 dark:bg-white/5 text-neutral-400 cursor-not-allowed`;
    }

    if (isActive) {
      return `${baseClasses} bg-primary text-white font-medium shadow-sm`;
    }

    return `${baseClasses} bg-neutral-100 dark:bg-white/8 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-white/12 transition-colors`;
  };

  /** 获取当前预设的期间显示 */
  const currentPeriods = activePreset !== 'custom'
    ? calculatePresetPeriods(activePreset, baseDate)
    : null;

  return (
    <div className="space-y-2">
      {/* 预设按钮组 */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-neutral-500 mr-1">对比模式：</span>
        {PRESET_ORDER.map((preset) => {
          const config = PRESET_CONFIGS[preset];
          return (
            <button
              key={preset}
              type="button"
              onClick={() => handlePresetClick(preset)}
              className={getButtonClassName(preset)}
              disabled={disabled}
              title={config.description}
            >
              {compact ? config.shortLabel : config.label}
            </button>
          );
        })}
      </div>

      {/* 期间预览（非自定义模式） */}
      {!compact && currentPeriods && (
        <div className="text-xs text-neutral-500 pl-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="w-12 text-neutral-400">当期：</span>
            <span className={fontStyles.numeric}>{formatPeriodDisplay(currentPeriods.current)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 text-neutral-400">基期：</span>
            <span className={fontStyles.numeric}>{formatPeriodDisplay(currentPeriods.previous)}</span>
          </div>
        </div>
      )}

      {/* 自定义模式提示 */}
      {!compact && activePreset === 'custom' && (
        <div className="text-xs text-neutral-400 pl-1">
          请在下方手动选择对比期间
        </div>
      )}
    </div>
  );
};

export default ComparisonQuickPresets;
