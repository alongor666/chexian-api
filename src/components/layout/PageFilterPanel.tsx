import React, { useState, useCallback } from 'react';
import { AdvancedFilterPanel } from '../../features/filters/AdvancedFilterPanel';
import { PageHeaderBar } from '../../features/filters/PageHeaderBar';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { Filter, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { FilterPresetName } from '../../shared/types/filters';

const STORAGE_KEY = 'page-filter-collapsed';

interface PageFilterPanelProps {
  preset: FilterPresetName;
  children: React.ReactNode;
  title?: string; // 页面标题，用于置顶显示
}

/**
 * 页面级筛选器布局组件
 *
 * 包裹页面内容，在右侧提供可折叠的筛选器面板。
 * 筛选状态通过 FilterContext 在所有页面间共享。
 *
 * 响应式设计：
 * - 移动端（<lg）：筛选器为浮动抽屉，点击按钮显示
 * - 桌面端（≥lg）：筛选器固定在右侧
 */
export const PageFilterPanel: React.FC<PageFilterPanelProps> = ({
  preset,
  children,
  title,
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

  // 移动端筛选器显示状态
  const [mobileOpen, setMobileOpen] = useState(false);

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
    <div className="flex h-full relative">
      {/* 主内容区 */}
      <div className="flex-1 overflow-auto">
        {title && <PageHeaderBar title={title} filters={filters} />}
        {children}
      </div>

      {/* 移动端筛选器按钮 */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 z-40 p-3 bg-primary text-white rounded-full shadow-lg hover:bg-primary-dark transition-colors"
        title="打开筛选器"
      >
        <Filter size={20} />
      </button>

      {/* 移动端筛选器遮罩 */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* 移动端筛选器抽屉 */}
      <div
        className={`lg:hidden fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] bg-white shadow-xl transform transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <span className="text-sm font-semibold text-neutral-700 flex items-center gap-2">
            <Filter size={16} />
            筛选条件
          </span>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1 rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-56px)] p-4">
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

      {/* 桌面端右侧筛选器 */}
      {collapsed ? (
        /* 折叠态：窄条 + 展开按钮 */
        <div className="hidden lg:flex w-10 flex-shrink-0 border-l border-neutral-200 bg-white flex-col items-center pt-4">
          <button
            onClick={toggleCollapsed}
            className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
            title="展开筛选器"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="mt-2">
            <Filter size={16} className="text-neutral-400" />
          </div>
        </div>
      ) : (
        /* 展开态：筛选器面板 */
        <div className="hidden lg:block w-72 flex-shrink-0 border-l border-neutral-200 bg-white overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-100">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider flex items-center gap-1.5">
              <Filter size={14} />
              筛选条件
            </span>
            <button
              onClick={toggleCollapsed}
              className="p-1 rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors"
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
