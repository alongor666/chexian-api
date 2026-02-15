import React from 'react';
import { MarketingReportPanel } from '../marketing-report';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';

export const MarketingReportPage: React.FC = () => {
  return (
    <PageFilterPanel preset="marketingReport">
      <div className="p-4">
        <MarketingReportPanel />
      </div>
    </PageFilterPanel>
  );
};
