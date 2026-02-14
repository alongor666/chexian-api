import React from 'react';
import { CoefficientMonitorPanel } from '../coefficient/components/CoefficientMonitorPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';

/**
 * 系数监控页面
 *
 * 筛选器统一在侧边栏中管理（SidebarFilterPanel），使用 coefficient preset。
 */
export const CoefficientPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <div className="p-4">
      <CoefficientMonitorPanel filters={filters} />
    </div>
  );
};
