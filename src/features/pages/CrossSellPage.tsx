import React from 'react';
import { CrossSellAnalysisPanel } from '../dashboard/CrossSellAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';

/**
 * 车驾意推介率分析页面
 *
 * 筛选器统一在侧边栏中管理（SidebarFilterPanel），使用 full preset。
 */
export const CrossSellPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <div className="p-4">
      <CrossSellAnalysisPanel filters={filters} />
    </div>
  );
};
