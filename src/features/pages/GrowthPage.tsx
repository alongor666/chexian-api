import React from 'react';
import { GrowthAnalysisPanel } from '../growth/components/GrowthAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';

/**
 * 增长分析页面
 *
 * 筛选器统一在侧边栏中管理（SidebarFilterPanel），使用 full preset。
 */
export const GrowthPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <div className="p-4">
      <GrowthAnalysisPanel filters={filters} />
    </div>
  );
};
