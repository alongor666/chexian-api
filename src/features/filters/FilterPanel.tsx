/**
 * FilterPanel 组件
 * 基础筛选面板，用于简单的文本筛选
 *
 * 使用统一设计系统：
 * - 卡片样式：bg-white rounded-lg border border-neutral-200 shadow-sm
 * - 标签样式：text-xs font-semibold text-neutral-700
 * - 输入框样式：统一的边框和圆角
 */
import { memo } from 'react';

export interface FilterState {
  org_level_3?: string;
  salesman_name?: string;
}

interface FilterPanelProps {
  filters: FilterState;
  onChange: (newFilters: FilterState) => void;
}

export const FilterPanel = memo(function FilterPanel({
  filters,
  onChange,
}: FilterPanelProps) {
  const handleChange = (key: keyof FilterState, value: string) => {
    onChange({ ...filters, [key]: value || undefined });
  };

  return (
    <div className="bg-white dark:bg-neutral-800 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-sm mb-4 flex gap-4 items-end">
      <div>
        <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
          三级机构
        </label>
        <input
          type="text"
          className="border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-1.5 text-sm w-40 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary transition-colors"
          placeholder="输入机构名称"
          value={filters.org_level_3 || ''}
          onChange={(e) => handleChange('org_level_3', e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
          业务员
        </label>
        <input
          type="text"
          className="border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-1.5 text-sm w-40 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary transition-colors"
          placeholder="输入业务员姓名"
          value={filters.salesman_name || ''}
          onChange={(e) => handleChange('salesman_name', e.target.value)}
        />
      </div>
    </div>
  );
});
