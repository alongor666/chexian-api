import React from 'react';
import { cn } from '../../shared/styles';

interface CoverageTabSelectorProps {
  options: Array<{ value: string; count?: number }>;
  selectedValues: string[];
  onChange: (values: string[]) => void;
}

/**
 * 险别组合 Tab 多选组件 — 横向按钮组，支持同时选中 1-3 个
 *
 * 空选（`[]`）等同于"全部"。
 */
export const CoverageTabSelector: React.FC<CoverageTabSelectorProps> = ({
  options,
  selectedValues,
  onChange,
}) => {
  const isAllSelected = selectedValues.length === 0;

  const handleToggle = (value: string) => {
    const next = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];
    onChange(next);
  };

  const handleSelectAll = () => {
    onChange([]);
  };

  const tabBase = 'flex-1 py-1.5 text-xs font-medium transition-colors text-center';
  const tabActive = 'bg-primary text-white';
  const tabInactive = 'bg-white text-neutral-600 hover:bg-neutral-50';

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-neutral-600">险别组合</span>
      <div className="flex rounded-md border border-neutral-200 overflow-hidden divide-x divide-neutral-200">
        <button
          type="button"
          onClick={handleSelectAll}
          className={cn(tabBase, isAllSelected ? tabActive : tabInactive)}
        >
          全部
        </button>
        {options.map(opt => {
          const isSelected = selectedValues.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleToggle(opt.value)}
              className={cn(tabBase, !isAllSelected && isSelected ? tabActive : tabInactive)}
            >
              {opt.value}
            </button>
          );
        })}
      </div>
    </div>
  );
};
