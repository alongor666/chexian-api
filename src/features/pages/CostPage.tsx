import React, { useState } from 'react';
import { CostAnalysisPanel } from '../cost/components/CostAnalysisPanel';
import { AdvancedFilterPanel } from '../filters/AdvancedFilterPanel';
import { PageWithRightFilter } from '../../shared/ui/PageWithRightFilter';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import type { CostSubTab } from '../cost/types/costTypes';

/**
 * 成本分析页面
 *
 * 独立页面组件，包含：
 * - 筛选面板（右侧边栏，根据子Tab条件显示）
 * - 成本分析面板
 * - 查询助理（悬浮按钮 + 侧边面板）
 *
 * 筛选器行为说明：
 * - 日期口径：锁定为起保日期（不可选）
 * - 分析年度：当年和上一年
 * - 赔付率/费用率/综合费用率/变动成本率 tab：显示筛选器
 * - 已赚保费 tab：隐藏全局筛选器（使用36个月滚动窗口，有独立的截止月份选择器）
 */
export const CostPage: React.FC = () => {
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

  // 追踪当前激活的子Tab，用于决定是否显示筛选器
  const [activeSubTab, setActiveSubTab] = useState<CostSubTab>('claim');

  // 已赚保费tab不需要筛选器
  const showFilter = activeSubTab !== 'earned';

  const filterPanel = showFilter ? (
    <AdvancedFilterPanel
      filters={filters}
      onChange={setFilters}
      collapsed={isFilterCollapsed}
      onToggleCollapse={toggleFilterCollapsed}
      availableYears={availableYears}
      maxDataDate={maxDataDate}
      preset="cost"
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
  ) : (
    <div className="text-sm text-gray-500 p-2">
      已赚保费分析使用独立的时间窗口设置
    </div>
  );

  return (
    <PageWithRightFilter
      filterPanel={filterPanel}
      isFilterCollapsed={isFilterCollapsed}
      onToggleCollapse={toggleFilterCollapsed}
      filterWidth={280}
    >
      <CostAnalysisPanel filters={filters} maxDataDate={maxDataDate} onSubTabChange={setActiveSubTab} />

    </PageWithRightFilter>
  );
};
