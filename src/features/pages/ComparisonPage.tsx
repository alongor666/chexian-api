import React from 'react';
import { ComparisonAnalysisPanel } from '../growth/components/ComparisonAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';

/**
 * 数据对比页面
 *
 * 筛选器统一在侧边栏中管理（SidebarFilterPanel），使用 full preset。
 */
export const ComparisonPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <div className="p-4">
      <ComparisonAnalysisPanel filters={filters} />
    </div>
  );
};
