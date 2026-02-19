/**
 * 保费达成下钻面板（营销战报版）
 *
 * 复用 premium-report 模块的完整实现（六级下钻 + KPI + 达成率分布）。
 * planYear 由全局筛选器 filters.analysis_year 控制。
 */

import React from 'react';
import { PremiumPlanPanel as PremiumPlanImpl } from '../../premium-report/components/PremiumPlanPanel';

interface PremiumPlanPanelProps {
  planYear: number;
}

export const PremiumPlanPanel: React.FC<PremiumPlanPanelProps> = () => {
  return <PremiumPlanImpl />;
};
