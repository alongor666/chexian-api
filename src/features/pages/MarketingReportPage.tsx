import React from 'react';
import { MarketingReportPanel } from '../marketing-report';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';

export const MarketingReportPage: React.FC = () => {
  return (
    <PageFilterPanel
      preset="marketingReport"
      title="营销战报"
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <div className="p-4">
        <MarketingReportPanel />
      </div>
    </PageFilterPanel>
  );
};
