/**
 * 赔案明细快捷筛选栏
 *
 * 替代冗余的常驻筛选区，提供紧凑摘要 + 一键快捷组合。
 * 快捷组合涵盖：客户类别、能源类型、险别组合、过户车。
 */
import React from 'react';
import { cn, colorClasses } from '@/shared/styles';

export interface QuickFilters {
  customerCategory?: string;
  isNev?: string;          // '1'=新能源, '0'=传统燃油
  coverageCombination?: string;
  isTransfer?: string;     // 'true'=过户车
}

interface Props {
  filters: QuickFilters;
  onChange: (filters: QuickFilters) => void;
  /** 当前筛选摘要（如 "2026年 | 起保日期 | 01-01 ~ 03-31"）*/
  summary: string;
}

interface ChipGroup {
  label: string;
  key: keyof QuickFilters;
  options: { label: string; value: string }[];
}

const CHIP_GROUPS: ChipGroup[] = [
  {
    label: '类别',
    key: 'customerCategory',
    options: [
      { label: '摩托车', value: '摩托车' },
      { label: '营业货车', value: '营业货车' },
      { label: '家自车', value: '非营业个人客车' },
    ],
  },
  {
    label: '特征',
    key: 'isTransfer',
    options: [
      { label: '过户车', value: 'true' },
    ],
  },
  {
    label: '能源',
    key: 'isNev',
    options: [
      { label: '新能源', value: '1' },
      { label: '传统燃油', value: '0' },
    ],
  },
  {
    label: '险别',
    key: 'coverageCombination',
    options: [
      { label: '主全', value: '主全' },
      { label: '交三', value: '交三' },
      { label: '单交', value: '单交' },
    ],
  },
];

const chipBase = 'px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors select-none';
const chipActive = 'bg-primary text-white';
const chipInactive = 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600';

export const QuickFilterBar: React.FC<Props> = ({ filters, onChange, summary }) => {
  const toggle = (key: keyof QuickFilters, value: string) => {
    onChange({
      ...filters,
      [key]: filters[key] === value ? undefined : value,
    });
  };

  return (
    <div className="space-y-2 mb-4">
      {/* 摘要行 */}
      <div className={cn('text-sm', colorClasses.text.neutralMuted)}>
        {summary}
      </div>

      {/* 快捷组合 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CHIP_GROUPS.map((group, gi) => (
          <React.Fragment key={group.key}>
            {gi > 0 && <span className="w-px h-4 bg-neutral-300 dark:bg-neutral-600 mx-1" />}
            {group.options.map(opt => (
              <button
                key={opt.value}
                onClick={() => toggle(group.key, opt.value)}
                className={cn(chipBase, filters[group.key] === opt.value ? chipActive : chipInactive)}
              >
                {opt.label}
              </button>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
