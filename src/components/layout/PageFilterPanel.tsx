import React, { useState, useCallback } from 'react';
import { AdvancedFilterPanel } from '../../features/filters/AdvancedFilterPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FilterPresetName } from '../../shared/types/filters';

const STORAGE_KEY = 'page-filter-collapsed';

interface PageFilterPanelProps {
  preset: FilterPresetName;
  children: React.ReactNode;
}

/**
 * 页面级筛选器布局组件
 *
 * 包裹页面内容，在右侧提供可折叠的筛选器面板。
 * 筛选状态通过 FilterContext 在所有页面间共享。
 */
export const PageFilterPanel: React.FC<PageFilterPanelProps> = ({
  preset,
  children,
}) => {
  const {
    filters,
    setFilters,
    filterOptions,
    isFilterCollapsed,
    toggleFilterCollapsed,
    availableSalesmen,
    maxDataDate,
    availableYears,
  } = useGlobalFilters();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-full">
      {/* 主内容区 */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>

      {/* 右侧筛选器 */}
      {collapsed ? (
        /* 折叠态：窄条 + 展开按钮 */
        <div className="w-10 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col items-center pt-4">
          <button
            onClick={toggleCollapsed}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="展开筛选器"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="mt-2">
            <Filter size={16} className="text-gray-400" />
          </div>
        </div>
      ) : (
        /* 展开态：筛选器面板 */
        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Filter size={14} />
              筛选条件
            </span>
            <button
              onClick={toggleCollapsed}
              className="p-1 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              title="收起筛选器"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="px-3 py-3">
            <AdvancedFilterPanel
              filters={filters}
              onChange={setFilters}
              collapsed={isFilterCollapsed}
              onToggleCollapse={toggleFilterCollapsed}
              availableYears={availableYears}
              maxDataDate={maxDataDate}
              preset={preset}
              compact={true}
              options={{
                org_level_3: filterOptions.org_level_3,
                salesman_name: filterOptions.salesman_name,
                customer_category: filterOptions.customer_category,
                coverage_combination: filterOptions.coverage_combination,
                renewal_mode: filterOptions.renewal_mode,
                insurance_grade: filterOptions.insurance_grade,
                small_truck_score: filterOptions.small_truck_score,
                large_truck_score: filterOptions.large_truck_score,
                availableSalesmen,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
