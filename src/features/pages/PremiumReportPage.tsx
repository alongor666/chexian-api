/**
 * 保费报表页面
 *
 * 保费分析报表功能：
 * - 机构保费报表（各机构保费数据汇总）
 * - 业务员保费报表（业务员保费明细）
 *
 * @module features/pages/PremiumReportPage
 */

import React from 'react';
import { PremiumReportPanel } from '../premium-report';
import { AdvancedFilterPanel } from '../filters/AdvancedFilterPanel';
import { PageWithRightFilter } from '../../shared/ui/PageWithRightFilter';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';

/**
 * 保费报表页面组件
 *
 * 独立页面组件，包含：
 * - 筛选面板（右侧边栏，使用 report preset）
 * - 保费报表主面板
 * - 查询助理（悬浮按钮 + 侧边面板）
 *
 * 筛选器行为说明（B079）：
 * - 业务员：不显示（报表不支持业务员筛选）
 * - 客户类别/险别组合：不显示（报表不支持）
 */
export const PremiumReportPage: React.FC = () => {
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
      preset="report"
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
      {/* 保费报表主面板 */}
      <PremiumReportPanel />

    </PageWithRightFilter>
  );
};
