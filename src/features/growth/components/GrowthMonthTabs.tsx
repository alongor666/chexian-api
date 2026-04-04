import React from 'react';
import { cn } from '@/shared/styles';

interface GrowthMonthTabsProps {
  selectedMonth: number;
  onSelectMonth: (month: number) => void;
}

export function GrowthMonthTabs(props: GrowthMonthTabsProps): React.ReactElement {
  return (
    <div className="mb-4 border-b border-neutral-200 dark:border-subtle">
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
          const isActive = props.selectedMonth === month;
          return (
            <button
              key={month}
              onClick={() => props.onSelectMonth(month)}
              className={cn(
                'px-4 py-2 rounded-t-md border-none cursor-pointer font-medium text-sm transition-colors',
                isActive
                  ? 'bg-primary text-white font-semibold'
                  : 'bg-transparent text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/8 hover:text-neutral-700 dark:hover:text-neutral-300'
              )}
            >
              {month}月
            </button>
          );
        })}
      </div>
    </div>
  );
}
