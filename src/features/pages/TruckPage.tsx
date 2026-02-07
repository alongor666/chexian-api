import React, { useState } from 'react';
import { TruckAnalysisPanel } from '../dashboard/TruckAnalysisPanel';
import { AdvancedFilterPanel } from '../filters/AdvancedFilterPanel';
import { PageWithRightFilter } from '../../shared/ui/PageWithRightFilter';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import type { ViewPerspective } from '../../shared/types';

/**
 * 营业货车分析页面
 *
 * 独立页面组件，包含：
 * - 筛选面板（右侧边栏，使用全局筛选器状态）
 * - 营业货车分析面板
 * - 查询助理（悬浮按钮 + 侧边面板）
 */
export const TruckPage: React.FC = () => {
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

  const [perspective, setPerspective] = useState<ViewPerspective>('premium');

  const filterPanel = (
    <AdvancedFilterPanel
      filters={filters}
      onChange={setFilters}
      collapsed={isFilterCollapsed}
      onToggleCollapse={toggleFilterCollapsed}
      availableYears={availableYears}
      maxDataDate={maxDataDate}
      preset="full"
      compact={true}
      options={{
        org_level_3: filterOptions.org_level_3,
        salesman_name: filterOptions.salesman_name,
        customer_category: filterOptions.customer_category,
        coverage_combination: filterOptions.coverage_combination,
        renewal_mode: filterOptions.renewal_mode,
        availableSalesmen,
      }}
    />
  );

  return (
    <PageWithRightFilter
      filterPanel={filterPanel}
      isFilterCollapsed={isFilterCollapsed}
      onToggleCollapse={toggleFilterCollapsed}
      filterWidth={280}
    >
      <TruckAnalysisPanel
        filters={filters}
        perspective={perspective}
        setPerspective={setPerspective}
      />

    </PageWithRightFilter>
  );
};
