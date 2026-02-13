import React from 'react';
import { CrossSellAnalysisPanel } from '../dashboard/CrossSellAnalysisPanel';
import { AdvancedFilterPanel } from '../filters/AdvancedFilterPanel';
import { PageWithRightFilter } from '../../shared/ui/PageWithRightFilter';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';

/**
 * 车驾意推介率分析页面
 *
 * 独立页面组件，包含：
 * - 筛选面板（右侧边栏）
 * - 车驾意推介率分析面板（第一层汇总 + 可选维度下钻）
 */
export const CrossSellPage: React.FC = () => {
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
      <CrossSellAnalysisPanel filters={filters} />
    </PageWithRightFilter>
  );
};
