import React, { useState } from 'react';
import { CostAnalysisPanel } from '../cost/components/CostAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import type { CostSubTab } from '../cost/types/costTypes';

/**
 * 成本分析页面
 *
 * 独立页面组件，包含：
 * - 成本分析面板
 *
 * 筛选器统一在侧边栏中管理（SidebarFilterPanel），使用 cost preset。
 */
export const CostPage: React.FC = () => {
  const { filters, maxDataDate } = useGlobalFilters();

  return (
    <div className="p-4">
      <CostAnalysisPanel filters={filters} maxDataDate={maxDataDate} />
    </div>
  );
};
