import React from 'react';
import { CoefficientMonitorPanel } from '../coefficient/components/CoefficientMonitorPanel';
import { AdvancedFilterPanel } from '../filters/AdvancedFilterPanel';
import { PageWithRightFilter } from '../../shared/ui/PageWithRightFilter';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';

/**
 * 系数监控页面
 *
 * 独立页面组件，包含：
 * - 筛选面板（右侧边栏，使用 coefficient preset）
 * - 系数监控面板
 * - 查询助理（悬浮按钮 + 侧边面板）
 *
 * 筛选器行为说明（B079）：
 * - 日期范围起始：不显示（完全忽略）
 * - 日期范围结束：由 CoefficientMonitorPanel 内部的截止日期选择器控制
 * - 机构/业务员：不显示（完全忽略）
 */
export const CoefficientPage: React.FC = () => {
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
      preset="coefficient"
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
      <CoefficientMonitorPanel filters={filters} />

    </PageWithRightFilter>
  );
};
