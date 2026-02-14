import React, { useState } from 'react';
import { TruckAnalysisPanel } from '../dashboard/TruckAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import type { ViewPerspective } from '../../shared/types';

/**
 * 营业货车分析页面
 *
 * 筛选器统一在侧边栏中管理（SidebarFilterPanel），使用 full preset。
 */
export const TruckPage: React.FC = () => {
  const { filters } = useGlobalFilters();
  const [perspective, setPerspective] = useState<ViewPerspective>('premium');

  return (
    <div className="p-4">
      <TruckAnalysisPanel
        filters={filters}
        perspective={perspective}
        setPerspective={setPerspective}
      />
    </div>
  );
};
