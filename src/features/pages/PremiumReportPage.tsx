import React from 'react';
import { PremiumReportPanel } from '../premium-report';

/**
 * 保费报表页面
 *
 * 筛选器统一在侧边栏中管理（SidebarFilterPanel），使用 report preset。
 */
export const PremiumReportPage: React.FC = () => {
  return (
    <div className="p-4">
      <PremiumReportPanel />
    </div>
  );
};
