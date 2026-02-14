import React from 'react';
import { MarketingReportPanel } from '../marketing-report';

/**
 * 营销战报页面
 *
 * 筛选器统一在侧边栏中管理（SidebarFilterPanel），使用 marketingReport preset。
 */
export const MarketingReportPage: React.FC = () => {
  return (
    <div className="p-4">
      <MarketingReportPanel />
    </div>
  );
};
