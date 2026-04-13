import React, { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { AdvancedFilterPanel } from '../../features/filters/AdvancedFilterPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { ChevronDown, ChevronRight, Filter } from 'lucide-react';
import type { FilterPresetName } from '../../shared/types/filters';

/**
 * 路由 → 筛选器预设映射
 *
 * 每个页面使用不同的筛选器预设，控制哪些筛选字段可见。
 * null 表示该页面不需要筛选器。
 */
const ROUTE_PRESET_MAP: Record<string, FilterPresetName | null> = {
  '/': null,                    // 首页 - 无筛选器
  '/dashboard': 'full',         // 仪表盘 - 完整筛选
  '/performance-analysis': 'performance', // 业绩分析
  '/premium-report': 'report',  // 旧路由兼容
  '/truck': 'full',             // 营业货车
  '/renewal': 'renewalDetail',  // 续保分析
  '/cross-sell': 'full',        // 车驾意推介率
  '/growth': 'full',            // 增长分析
  '/cost': 'cost',              // 成本分析
  '/comparison': 'full',        // 数据对比
  '/templates': null,           // 报表模板 - 无筛选器
  '/login': null,               // 登录 - 无筛选器
};

/**
 * 根据当前路由获取筛选器预设
 */
const getPresetForRoute = (pathname: string): FilterPresetName | null => {
  // 精确匹配
  if (ROUTE_PRESET_MAP[pathname] !== undefined) {
    return ROUTE_PRESET_MAP[pathname];
  }
  // 前缀匹配（处理子路由）
  for (const [route, preset] of Object.entries(ROUTE_PRESET_MAP)) {
    if (route !== '/' && pathname.startsWith(route)) {
      return preset;
    }
  }
  return null;
};

const STORAGE_KEY = 'sidebar-filter-collapsed';

/**
 * 侧边栏筛选器面板
 *
 * 集成在左侧导航侧边栏中，根据当前路由自动切换筛选器预设。
 * 筛选状态通过 FilterContext 在所有页面间共享。
 */
export const SidebarFilterPanel: React.FC = () => {
  const location = useLocation();
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
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === null ? true : saved === 'true'; // 默认隐藏
    } catch {
      return true;
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

  const preset = getPresetForRoute(location.pathname);

  // 不需要筛选器的页面不渲染
  if (preset === null) {
    return null;
  }

  return (
    <div className="border-t border-neutral-200 dark:border-subtle">
      {/* 折叠/展开头部 */}
      <button
        onClick={toggleCollapsed}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider hover:bg-neutral-50 dark:hover:bg-white/8 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Filter size={14} aria-hidden="true" />
          筛选条件
        </span>
        {collapsed ? (
          <ChevronRight size={14} aria-hidden="true" />
        ) : (
          <ChevronDown size={14} aria-hidden="true" />
        )}
      </button>

      {/* 筛选器内容 */}
      {!collapsed && (
        <div className="px-3 pb-3">
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
              availableSalesmen,
            }}
          />
        </div>
      )}
    </div>
  );
};
