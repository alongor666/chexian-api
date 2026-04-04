import React from 'react';
import { cn } from '../../shared/styles';

interface TagSelectorProps {
  title: string;
  options: string[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}

/**
 * 标签点选组件 — 一行横向 chip，支持多选
 *
 * 空选（`[]`）等同于"全部"。
 */
export const TagSelector: React.FC<TagSelectorProps> = ({
  title,
  options,
  selectedValues,
  onChange,
  disabled = false,
}) => {
  const isAllSelected = selectedValues.length === 0;

  const handleToggle = (value: string) => {
    if (disabled) return;
    const next = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];
    onChange(next);
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onChange([]);
  };

  const chipBase = 'px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer select-none';
  const chipActive = 'bg-primary text-white border-primary';
  const chipInactive = 'text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-700 hover:border-neutral-300';
  const chipDisabled = 'cursor-not-allowed opacity-40 bg-neutral-100 dark:bg-neutral-700 text-neutral-400 border-neutral-200 dark:border-neutral-600';

  return (
    <div className="space-y-1">
      <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{title}</span>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={handleSelectAll}
          disabled={disabled}
          className={cn(chipBase, disabled ? chipDisabled : isAllSelected ? chipActive : chipInactive)}
        >
          全部
        </button>
        {options.map(opt => {
          const isSelected = selectedValues.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => handleToggle(opt)}
              disabled={disabled}
              className={cn(chipBase, disabled ? chipDisabled : isSelected ? chipActive : chipInactive)}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
};
