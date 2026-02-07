/**
 * 营销战报页面
 *
 * 假日营销分析功能：
 * - 机构战报（各机构假日营销数据汇总）
 * - 业务员明细（业务员假日签单情况）
 *
 * @module features/pages/MarketingReportPage
 */

import React from 'react';
import { MarketingReportPanel } from '../marketing-report';
import { AdvancedFilterPanel } from '../filters/AdvancedFilterPanel';
import { PageWithRightFilter } from '../../shared/ui/PageWithRightFilter';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';

/**
 * 营销战报页面组件
 *
 * 独立页面组件，包含：
 * - 筛选面板（右侧边栏，使用 marketingReport preset）
 * - 营销战报主面板
 * - 查询助理（悬浮按钮 + 侧边面板）
 *
 * 筛选器行为说明：
 * - 日期口径：锁定为签单日期（不可选）
 * - 分析年度：仅当年
 * - 业务员：不显示（报表不支持业务员筛选）
 * - 客户类别/险别组合：不显示（报表不支持）
 */
export const MarketingReportPage: React.FC = () => {
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
      preset="marketingReport"
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
      {/* 营销战报主面板 */}
      <MarketingReportPanel />

    </PageWithRightFilter>
  );
};
