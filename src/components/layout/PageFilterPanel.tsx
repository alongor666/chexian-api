import React, { useState, useCallback, useEffect } from 'react';
import { AdvancedFilterPanel } from '../../features/filters/AdvancedFilterPanel';
import { PageHeaderBar } from '../../features/filters/PageHeaderBar';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { Filter, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { FilterPresetName } from '../../shared/types/filters';

const STORAGE_KEY = 'page-filter-collapsed';

interface PageFilterPanelProps {
  preset: FilterPresetName;
  children: React.ReactNode;
  /** 页面基础标题（如"保费分析"），会根据筛选范围自动添加前缀 */
  title?: string;
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

  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('right-sidebar-width');
      return saved ? parseInt(saved, 10) : 280;
    } catch {
      return 280;
    }
  });
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('right-sidebar-width', rightSidebarWidth.toString());
    } catch { }
  }, [rightSidebarWidth]);

  return (
    <div className="flex flex-col h-full w-full bg-neutral-50/50">
      {/* 顶部固定标题区域 */}
      {title && (
        <div className="flex-none z-20 sticky top-0 bg-white border-b border-neutral-100 shadow-sm w-full">
          <PageHeaderBar
            baseTitle={title}
            filters={filters}
            allOrgCount={filterOptions.org_level_3?.length || 0}
          />
        </div>
      )}

      {/* 下方内容与侧边栏的横向包裹区 */}
      <div className="flex flex-1 flex-row min-h-0 w-full overflow-hidden relative">
        {/* 左侧主内容区（独立滚动） */}
        <div className="flex-1 overflow-y-auto min-w-0 p-4 relative">
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
          className={`lg:hidden fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] bg-white shadow-xl transform transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : 'translate-x-full'
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
        <div
          className={`hidden lg:flex relative flex-shrink-0 border-l border-neutral-200 bg-white flex-col h-full overflow-hidden ${!isDraggingRight ? 'transition-all duration-300' : ''} ${collapsed ? 'w-10 items-center justify-start pt-4' : ''}`}
          style={!collapsed ? { width: `${rightSidebarWidth}px` } : undefined}
        >
          {/* 拖拽把手 - 拉左侧边缘 */}
          {!collapsed && (
            <div
              className="absolute top-0 bottom-0 left-0 w-1 cursor-col-resize hover:bg-blue-400 z-50 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDraggingRight(true);
                const startX = e.clientX;
                const startWidth = rightSidebarWidth;

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  let newWidth = startWidth - (moveEvent.clientX - startX); // 向左拉是增加宽度
                  if (newWidth < 240) newWidth = 240;
                  if (newWidth > 500) newWidth = 500;
                  setRightSidebarWidth(newWidth);
                };

                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                  document.body.style.cursor = '';
                  document.body.style.userSelect = '';
                  setIsDraggingRight(false);
                };

                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            />
          )}

          {collapsed ? (
            /* 折叠态内容 */
            <>
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
            </>
          ) : (
            /* 展开态内容 */
            <>
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
              <div className="px-3 py-3 overflow-y-auto flex-1 h-0">
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
