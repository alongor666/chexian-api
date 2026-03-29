import React from 'react';
import { PremiumReportPanel } from '../premium-report';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';

export const ReportsPage: React.FC = () => {
  return (
    <PageFilterPanel
      preset="report"
      title="保费达成"
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <div className="p-4">
        <PremiumReportPanel />
      </div>
    </PageFilterPanel>
  );
};
