import React from 'react';
import { PremiumReportPanel } from '../premium-report';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';

export const PremiumReportPage: React.FC = () => {
  return (
    <PageFilterPanel
      preset="report"
      title="保费报表"
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <div className="p-4">
        <PremiumReportPanel />
      </div>
    </PageFilterPanel>
  );
};
